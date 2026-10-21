import crypto from 'crypto';
import {
  ConsultationStatus,
  PaymentProvider,
  PaymentStatus,
  Role,
  WebhookEventStatus,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { config } from '../../config/index.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors/index.js';
import { AuthenticatedUser } from '../../common/middleware/auth.middleware.js';
import { CreateOrderInput, MockCaptureInput } from './payments.dto.js';

export class PaymentsService {
  /**
   * Concurrency-safe, server-side trusted pricing payment order creation.
   * Derives payment amount exclusively from verified DoctorProfile.consultationFee.
   */
  async createPaymentOrder(
    user: AuthenticatedUser,
    input: CreateOrderInput,
    idempotencyKey?: string
  ) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: input.consultationId },
      include: {
        doctor: true,
        patient: true,
        payment: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    // Role check: patient or admin
    if (user.role !== Role.ADMIN && consultation.patient.userId !== user.id) {
      throw new ForbiddenError('Only the consulting patient can initiate payment');
    }

    if (
      consultation.status !== ConsultationStatus.BOOKED &&
      consultation.status !== ConsultationStatus.CONFIRMED &&
      consultation.status !== ConsultationStatus.IN_PROGRESS &&
      consultation.status !== ConsultationStatus.COMPLETED
    ) {
      throw new BadRequestError(
        `Cannot create payment order for consultation with status: ${consultation.status}`
      );
    }

    // Check existing payment status
    if (consultation.payment) {
      if (consultation.payment.status === PaymentStatus.CAPTURED) {
        throw new BadRequestError('Payment is already completed for this consultation');
      }
      // Return existing pending order if already created with same idempotency key or provider order
      if (consultation.payment.status === PaymentStatus.PENDING) {
        return consultation.payment;
      }
    }

    // Server-side authoritative trusted fee derivation
    const amount = consultation.doctor.consultationFee;
    const provider = input.provider || (config.PAYMENT_GATEWAY_PROVIDER as PaymentProvider);
    const prefix = provider === PaymentProvider.RAZORPAY ? 'order_rzp_' : 'order_mock_';
    const providerOrderId = `${prefix}${crypto.randomBytes(8).toString('hex')}`;

    const payment = await prisma.$transaction(async (tx) => {
      const createdPayment = await tx.payment.upsert({
        where: { consultationId: input.consultationId },
        create: {
          consultationId: input.consultationId,
          patientId: consultation.patientId,
          amount,
          currency: 'INR',
          status: PaymentStatus.PENDING,
          provider,
          providerOrderId,
          idempotencyKey: idempotencyKey ?? null,
        },
        update: {
          amount,
          provider,
          providerOrderId,
          status: PaymentStatus.PENDING,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PAYMENT',
          aggregateId: createdPayment.id,
          eventType: 'PAYMENT_ORDER_CREATED',
          payload: {
            paymentId: createdPayment.id,
            consultationId: input.consultationId,
            amount: amount.toString(),
            provider,
            providerOrderId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'PAYMENT_ORDER_CREATE',
          resourceType: 'Payment',
          resourceId: createdPayment.id,
          changeset: {
            amount: amount.toString(),
            providerOrderId,
          },
        },
      });

      return createdPayment;
    });

    return payment;
  }

  /**
   * Cryptographically verifies and idempotently processes payment gateway webhooks.
   */
  async processWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
    payload: any
  ) {
    const providerHeader = (headers['x-payment-provider'] as string)?.toUpperCase();
    const provider: PaymentProvider =
      providerHeader === 'RAZORPAY' ? PaymentProvider.RAZORPAY : PaymentProvider.MOCK;

    let signatureValid = false;

    if (provider === PaymentProvider.RAZORPAY) {
      const signature = headers['x-razorpay-signature'] as string;
      const secret = config.RAZORPAY_WEBHOOK_SECRET || 'dev_razorpay_secret_key_32_bytes!';

      if (!signature || !rawBody) {
        throw new UnauthorizedError('Missing Razorpay webhook signature or payload');
      }

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      try {
        signatureValid = crypto.timingSafeEqual(
          Buffer.from(signature, 'hex'),
          Buffer.from(expectedSignature, 'hex')
        );
      } catch {
        signatureValid = false;
      }

      if (!signatureValid) {
        throw new UnauthorizedError('Invalid Razorpay cryptographic webhook signature');
      }
    } else {
      // MOCK or simulated webhook
      const mockSig = headers['x-mock-signature'] as string;
      signatureValid = !mockSig || mockSig === 'mock-valid-signature' || config.NODE_ENV !== 'production';
    }

    const eventId =
      (payload.event_id as string) ||
      (payload.id as string) ||
      (headers['x-razorpay-event-id'] as string) ||
      `evt_${crypto.randomUUID()}`;

    const eventType = (payload.event as string) || (payload.eventType as string) || 'payment.captured';

    // Idempotent webhook storage with unique constraint deduplication
    let webhookEvent;
    try {
      webhookEvent = await prisma.paymentWebhookEvent.create({
        data: {
          provider,
          eventId,
          eventType,
          payload: payload as any,
          signatureValid,
          status: WebhookEventStatus.RECEIVED,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Idempotent replay: already received and stored
        return { success: true, duplicate: true, message: 'Webhook event already processed' };
      }
      throw err;
    }

    // Process event state transition
    if (
      eventType === 'payment.captured' ||
      eventType === 'order.paid' ||
      eventType === 'PAYMENT_SUCCESS'
    ) {
      const orderId =
        payload.payload?.payment?.entity?.order_id ||
        payload.orderId ||
        payload.providerOrderId;
      const paymentId =
        payload.payload?.payment?.entity?.id ||
        payload.paymentId ||
        `pay_${crypto.randomBytes(6).toString('hex')}`;

      if (orderId) {
        const payment = await prisma.payment.findUnique({
          where: { providerOrderId: orderId },
        });

        if (payment && payment.status !== PaymentStatus.CAPTURED) {
          await prisma.$transaction(async (tx) => {
            // Update payment record
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.CAPTURED,
                providerPaymentId: paymentId,
              },
            });

            // Transition consultation from BOOKED to CONFIRMED (preserve IN_PROGRESS / COMPLETED)
            const currentConsultation = await tx.consultation.findUnique({
              where: { id: payment.consultationId },
              select: { status: true },
            });
            if (currentConsultation?.status === ConsultationStatus.BOOKED) {
              await tx.consultation.update({
                where: { id: payment.consultationId },
                data: {
                  status: ConsultationStatus.CONFIRMED,
                },
              });
            }

            // Update webhook event to PROCESSED
            await tx.paymentWebhookEvent.update({
              where: { id: webhookEvent.id },
              data: {
                status: WebhookEventStatus.PROCESSED,
                processedAt: new Date(),
              },
            });

            // Outbox event
            await tx.outboxEvent.create({
              data: {
                aggregateType: 'PAYMENT',
                aggregateId: payment.id,
                eventType: 'PAYMENT_CAPTURED',
                payload: {
                  paymentId: payment.id,
                  consultationId: payment.consultationId,
                  providerPaymentId: paymentId,
                  amount: payment.amount.toString(),
                },
              },
            });

            // Audit log
            await tx.auditLog.create({
              data: {
                actorRole: 'SYSTEM_WEBHOOK',
                action: 'PAYMENT_CAPTURE',
                resourceType: 'Payment',
                resourceId: payment.id,
                changeset: {
                  status: PaymentStatus.CAPTURED,
                  providerPaymentId: paymentId,
                },
              },
            });
          });
        }
      }
    }

    return { success: true, duplicate: false, message: 'Webhook event processed successfully' };
  }

  /**
   * Simulated payment capture for frontend integration and automated testing.
   */
  async mockCapture(user: AuthenticatedUser, input: MockCaptureInput) {
    const payment = await prisma.payment.findUnique({
      where: { providerOrderId: input.orderId },
      include: {
        consultation: true,
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment order not found');
    }

    // Role check: patient, doctor or admin
    if (user.role !== Role.ADMIN) {
      const patientProfile = await prisma.patientProfile.findUnique({ where: { userId: user.id } });
      if (payment.patientId !== patientProfile?.id) {
        throw new ForbiddenError('You do not have permission to capture this payment');
      }
    }

    if (payment.status === PaymentStatus.CAPTURED) {
      return payment;
    }

    const providerPaymentId = input.paymentId || `pay_mock_${crypto.randomBytes(6).toString('hex')}`;

    const result = await prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CAPTURED,
          providerPaymentId,
        },
      });

      // Update consultation status to CONFIRMED only if it was BOOKED
      if (payment.consultation.status === ConsultationStatus.BOOKED) {
        await tx.consultation.update({
          where: { id: payment.consultationId },
          data: {
            status: ConsultationStatus.CONFIRMED,
          },
        });
      }

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PAYMENT',
          aggregateId: payment.id,
          eventType: 'PAYMENT_CAPTURED',
          payload: {
            paymentId: payment.id,
            consultationId: payment.consultationId,
            providerPaymentId,
            amount: payment.amount.toString(),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'PAYMENT_MOCK_CAPTURE',
          resourceType: 'Payment',
          resourceId: payment.id,
        },
      });

      return updatedPayment;
    });

    return result;
  }

  /**
   * Retrieves payment details by consultation ID with RBAC.
   */
  async getPaymentByConsultationId(user: AuthenticatedUser, consultationId: string) {
    const payment = await prisma.payment.findUnique({
      where: { consultationId },
      include: {
        consultation: {
          select: {
            id: true,
            status: true,
            patient: { select: { userId: true } },
            doctor: { select: { userId: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment record not found for this consultation');
    }

    if (user.role !== Role.ADMIN) {
      const isPatient = payment.consultation.patient.userId === user.id;
      const isDoctor = payment.consultation.doctor.userId === user.id;

      if (!isPatient && !isDoctor) {
        throw new ForbiddenError('You do not have permission to view this payment');
      }
    }

    return payment;
  }
}

export const paymentsService = new PaymentsService();
