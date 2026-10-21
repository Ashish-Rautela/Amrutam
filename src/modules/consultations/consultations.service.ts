import { ConsultationStatus, Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import { AuthenticatedUser } from '../../common/middleware/auth.middleware.js';
import {
  RecordConsentInput,
  CompleteConsultationInput,
} from './consultations.dto.js';

export class ConsultationsService {
  /**
   * Records mandatory patient teleconsultation consent.
   * Telemedicine Practice Guidelines (2020) mandate documented patient consent before care delivery.
   */
  async recordConsent(
    user: AuthenticatedUser,
    consultationId: string,
    input: RecordConsentInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        patient: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    // Only the patient or admin can provide patient consent
    if (user.role !== Role.ADMIN && consultation.patient.userId !== user.id) {
      throw new ForbiddenError('Only the consulting patient can provide informed consent');
    }

    if (consultation.status === ConsultationStatus.CANCELLED || consultation.status === ConsultationStatus.COMPLETED) {
      throw new BadRequestError(`Cannot record consent for consultation with status: ${consultation.status}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Upsert consent record
      const consent = await tx.consultationConsent.upsert({
        where: { consultationId },
        create: {
          consultationId,
          patientId: consultation.patientId,
          consentType: input.consentType,
          version: input.version,
          granted: true,
          timestamp: new Date(),
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
        update: {
          consentType: input.consentType,
          version: input.version,
          granted: true,
          timestamp: new Date(),
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      // Update consultation flag
      const updatedConsultation = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          consentRecorded: true,
          consentTimestamp: new Date(),
        },
        include: {
          consent: true,
          doctor: { select: { id: true, fullName: true } },
          patient: { select: { id: true, fullName: true } },
        },
      });

      // Transactional outbox event
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultationId,
          eventType: 'CONSULTATION_CONSENT_RECORDED',
          payload: {
            consultationId,
            patientId: consultation.patientId,
            consentType: input.consentType,
            version: input.version,
            timestamp: consent.timestamp.toISOString(),
          },
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'CONSULTATION_CONSENT_RECORDED',
          resourceType: 'ConsultationConsent',
          resourceId: consent.id,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return updatedConsultation;
    });

    return result;
  }

  /**
   * Starts consultation session.
   * Strictly enforces that patient consent has been recorded prior to commencing care.
   */
  async startConsultation(user: AuthenticatedUser, consultationId: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    // Role check: assigned doctor or admin
    if (user.role !== Role.ADMIN && consultation.doctor.userId !== user.id) {
      throw new ForbiddenError('Only the assigned doctor can commence this consultation');
    }

    // Explicit statutory check: Telemedicine Practice Guidelines
    if (!consultation.consentRecorded) {
      throw new BadRequestError(
        'Explicit patient consent must be recorded prior to commencing telemedicine consultation'
      );
    }

    if (
      consultation.status !== ConsultationStatus.BOOKED &&
      consultation.status !== ConsultationStatus.CONFIRMED
    ) {
      throw new BadRequestError(
        `Cannot start consultation in ${consultation.status} status. Only BOOKED or CONFIRMED consultations can be started.`
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          status: ConsultationStatus.IN_PROGRESS,
        },
        include: {
          slot: true,
          patient: { select: { id: true, fullName: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultationId,
          eventType: 'CONSULTATION_STARTED',
          payload: {
            consultationId,
            doctorId: consultation.doctorId,
            patientId: consultation.patientId,
          },
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Completes consultation and saves clinical notes.
   */
  async completeConsultation(
    user: AuthenticatedUser,
    consultationId: string,
    input: CompleteConsultationInput
  ) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    if (user.role !== Role.ADMIN && consultation.doctor.userId !== user.id) {
      throw new ForbiddenError('Only the assigned doctor can complete this consultation');
    }

    if (consultation.status !== ConsultationStatus.IN_PROGRESS) {
      throw new BadRequestError(
        `Cannot complete consultation in ${consultation.status} status. Only IN_PROGRESS consultations can be completed.`
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          status: ConsultationStatus.COMPLETED,
          clinicalNotes: input.clinicalNotes,
        },
        include: {
          patient: { select: { id: true, fullName: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultationId,
          eventType: 'CONSULTATION_COMPLETED',
          payload: {
            consultationId,
            doctorId: consultation.doctorId,
            patientId: consultation.patientId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'CONSULTATION_COMPLETED',
          resourceType: 'Consultation',
          resourceId: consultationId,
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Marks a consultation as NO_SHOW if the patient does not attend.
   */
  async markNoShow(user: AuthenticatedUser, consultationId: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    if (user.role !== Role.ADMIN && consultation.doctor.userId !== user.id) {
      throw new ForbiddenError('Only the assigned doctor or an administrator can mark a no-show');
    }

    if (
      consultation.status !== ConsultationStatus.BOOKED &&
      consultation.status !== ConsultationStatus.CONFIRMED
    ) {
      throw new BadRequestError(
        `Cannot mark consultation with status ${consultation.status} as NO_SHOW. Only BOOKED or CONFIRMED can be marked NO_SHOW.`
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          status: ConsultationStatus.NO_SHOW,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultationId,
          eventType: 'CONSULTATION_NO_SHOW',
          payload: {
            consultationId,
            doctorId: consultation.doctorId,
            patientId: consultation.patientId,
          },
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Fetches consultation with full clinical context.
   */
  async getConsultationById(user: AuthenticatedUser, consultationId: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        slot: true,
        patient: { select: { id: true, fullName: true, userId: true } },
        doctor: {
          select: {
            id: true,
            fullName: true,
            specializations: true,
            consultationFee: true,
            userId: true,
          },
        },
        consent: true,
        prescriptions: {
          include: {
            items: true,
          },
          orderBy: { version: 'desc' },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            status: true,
            provider: true,
            createdAt: true,
          },
        },
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    if (user.role !== Role.ADMIN) {
      const isPatient = consultation.patient.userId === user.id;
      const isDoctor = consultation.doctor.userId === user.id;

      if (!isPatient && !isDoctor) {
        throw new ForbiddenError('You do not have permission to view this consultation');
      }
    }

    return consultation;
  }
}

export const consultationsService = new ConsultationsService();
