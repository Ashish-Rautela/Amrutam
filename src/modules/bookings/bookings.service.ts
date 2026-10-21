import crypto from 'crypto';
import {
  ConsultationMode,
  ConsultationStatus,
  PaymentStatus,
  Role,
  SlotStatus,
  VerificationStatus,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import { AuthenticatedUser } from '../../common/middleware/auth.middleware.js';
import { CreateBookingInput, CancelBookingInput, ListBookingsQuery } from './bookings.dto.js';

export class BookingsService {
  /**
   * Concurrency-safe atomic appointment booking.
   * Ensures doctor verification, prevents self-booking, atomically claims the slot,
   * creates the consultation, publishes an outbox event, and writes an audit log.
   */
  async createBooking(user: AuthenticatedUser, input: CreateBookingInput) {
    // 1. Resolve patient profile
    const patientProfile = await prisma.patientProfile.findUnique({
      where: { userId: user.id },
    });

    if (!patientProfile) {
      throw new BadRequestError('Active patient profile required to book an appointment');
    }

    // 2. Fetch slot with doctor verification details
    const slot = await prisma.availabilitySlot.findUnique({
      where: { id: input.slotId },
      include: {
        doctor: true,
      },
    });

    if (!slot) {
      throw new NotFoundError('Availability slot not found');
    }

    // 3. Prevent self-booking (doctor booking their own slot)
    if (slot.doctor.userId === user.id) {
      throw new BadRequestError('Doctors cannot book consultations with themselves');
    }

    // 4. Verify doctor status
    if (slot.doctor.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new BadRequestError('Doctor is not currently verified to accept bookings');
    }

    // 5. Check slot status and validity
    if (slot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictError('Availability slot is no longer available');
    }

    if (slot.startTime <= new Date()) {
      throw new BadRequestError('Cannot book an availability slot in the past');
    }

    // 6. Execute atomic booking inside a serializable/isolated transaction
    const result = await prisma.$transaction(async (tx) => {
      // Atomic conditional update to prevent race conditions
      const updateResult = await tx.availabilitySlot.updateMany({
        where: {
          id: input.slotId,
          status: SlotStatus.AVAILABLE,
        },
        data: {
          status: SlotStatus.BOOKED,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictError('Availability slot is no longer available or was booked concurrently');
      }

      // Generate meeting room details if teleconsultation
      const isTelehealth = input.mode === ConsultationMode.VIDEO || input.mode === ConsultationMode.AUDIO;
      const meetingRoomId = isTelehealth ? `room-${crypto.randomUUID()}` : null;
      const meetingToken = isTelehealth ? crypto.randomBytes(24).toString('hex') : null;

      // Create consultation
      const consultation = await tx.consultation.create({
        data: {
          slotId: input.slotId,
          patientId: patientProfile.id,
          doctorId: slot.doctorId,
          status: ConsultationStatus.BOOKED,
          mode: input.mode,
          meetingRoomId,
          meetingToken,
        },
        include: {
          slot: true,
          doctor: {
            select: {
              id: true,
              fullName: true,
              specializations: true,
              consultationFee: true,
            },
          },
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      });

      // Write transactional outbox event
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultation.id,
          eventType: 'BOOKING_CREATED',
          payload: {
            consultationId: consultation.id,
            slotId: consultation.slotId,
            patientId: consultation.patientId,
            doctorId: consultation.doctorId,
            mode: consultation.mode,
            startTime: slot.startTime.toISOString(),
            endTime: slot.endTime.toISOString(),
          },
        },
      });

      // Audit log entry
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'BOOKING_CREATE',
          resourceType: 'Consultation',
          resourceId: consultation.id,
          changeset: {
            slotId: input.slotId,
            mode: input.mode,
          },
        },
      });

      return consultation;
    });

    return result;
  }

  /**
   * Retrieves booking / consultation details by ID with role-based access checks.
   */
  async getBookingById(user: AuthenticatedUser, bookingId: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: bookingId },
      include: {
        slot: true,
        doctor: {
          select: {
            id: true,
            fullName: true,
            specializations: true,
            consultationFee: true,
            userId: true,
          },
        },
        patient: {
          select: {
            id: true,
            fullName: true,
            userId: true,
          },
        },
        payment: true,
        consent: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Booking not found');
    }

    // Role-based authorization
    if (user.role !== Role.ADMIN) {
      const isPatient = consultation.patient.userId === user.id;
      const isDoctor = consultation.doctor.userId === user.id;

      if (!isPatient && !isDoctor) {
        throw new ForbiddenError('You do not have permission to view this booking');
      }
    }

    return consultation;
  }

  /**
   * Lists bookings filtered by role, doctor, patient, status, and pagination.
   */
  async listBookings(user: AuthenticatedUser, query: ListBookingsQuery) {
    const { status, doctorId, patientId, page, limit } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (user.role === Role.PATIENT) {
      const profile = await prisma.patientProfile.findUnique({ where: { userId: user.id } });
      if (!profile) return { data: [], total: 0, page, limit };
      where.patientId = profile.id;
    } else if (user.role === Role.DOCTOR) {
      const profile = await prisma.doctorProfile.findUnique({ where: { userId: user.id } });
      if (!profile) return { data: [], total: 0, page, limit };
      where.doctorId = profile.id;
    } else if (user.role === Role.ADMIN) {
      if (doctorId) where.doctorId = doctorId;
      if (patientId) where.patientId = patientId;
    }

    const [total, data] = await Promise.all([
      prisma.consultation.count({ where }),
      prisma.consultation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          slot: true,
          doctor: {
            select: {
              id: true,
              fullName: true,
              specializations: true,
              consultationFee: true,
            },
          },
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
          payment: {
            select: {
              status: true,
              amount: true,
            },
          },
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Concurrency-safe booking cancellation.
   * Updates consultation status to CANCELLED, releases slot, produces outbox event, and records audit.
   */
  async cancelBooking(user: AuthenticatedUser, bookingId: string, input: CancelBookingInput) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: bookingId },
      include: {
        slot: true,
        doctor: true,
        patient: true,
        payment: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Booking not found');
    }

    // Role check
    if (user.role !== Role.ADMIN) {
      const isPatient = consultation.patient.userId === user.id;
      const isDoctor = consultation.doctor.userId === user.id;

      if (!isPatient && !isDoctor) {
        throw new ForbiddenError('You do not have permission to cancel this booking');
      }
    }

    // Valid state transitions for cancellation
    if (
      consultation.status !== ConsultationStatus.BOOKED &&
      consultation.status !== ConsultationStatus.CONFIRMED
    ) {
      throw new BadRequestError(
        `Cannot cancel consultation in ${consultation.status} status. Only BOOKED or CONFIRMED consultations can be cancelled.`
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update consultation status
      const updatedConsultation = await tx.consultation.update({
        where: { id: bookingId },
        data: {
          status: ConsultationStatus.CANCELLED,
          cancellationReason: input.cancellationReason,
          cancelledBy: user.id,
        },
      });

      // Update slot status to CANCELLED
      await tx.availabilitySlot.update({
        where: { id: consultation.slotId },
        data: {
          status: SlotStatus.CANCELLED,
          version: { increment: 1 },
        },
      });

      // Maintain consistency across payment state
      if (consultation.payment) {
        if (consultation.payment.status === PaymentStatus.CAPTURED) {
          await tx.payment.update({
            where: { id: consultation.payment.id },
            data: { status: PaymentStatus.REFUNDED },
          });

          await tx.outboxEvent.create({
            data: {
              aggregateType: 'PAYMENT',
              aggregateId: consultation.payment.id,
              eventType: 'PAYMENT_REFUNDED',
              payload: {
                paymentId: consultation.payment.id,
                consultationId: consultation.id,
                amount: consultation.payment.amount.toString(),
                reason: input.cancellationReason,
              },
            },
          });
        } else if (consultation.payment.status === PaymentStatus.PENDING) {
          await tx.payment.update({
            where: { id: consultation.payment.id },
            data: { status: PaymentStatus.FAILED },
          });
        }
      }

      // Outbox event
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultation.id,
          eventType: 'BOOKING_CANCELLED',
          payload: {
            consultationId: consultation.id,
            slotId: consultation.slotId,
            cancellationReason: input.cancellationReason,
            cancelledBy: user.id,
          },
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'BOOKING_CANCEL',
          resourceType: 'Consultation',
          resourceId: consultation.id,
          changeset: {
            status: ConsultationStatus.CANCELLED,
            cancellationReason: input.cancellationReason,
          },
        },
      });

      return updatedConsultation;
    });

    return result;
  }
}

export const bookingsService = new BookingsService();
