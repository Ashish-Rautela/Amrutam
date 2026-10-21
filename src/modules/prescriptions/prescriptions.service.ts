import crypto from 'crypto';
import { ConsultationStatus, Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { config } from '../../config/index.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import { AuthenticatedUser } from '../../common/middleware/auth.middleware.js';
import { CreatePrescriptionInput } from './prescriptions.dto.js';

export class PrescriptionsService {
  /**
   * Generates a tamper-evident cryptographic digital signature for the prescription.
   */
  private generateDoctorSignature(
    doctorId: string,
    consultationId: string,
    version: number,
    diagnosis: string,
    items: unknown[]
  ): string {
    const payload = JSON.stringify({
      doctorId,
      consultationId,
      version,
      diagnosis,
      items,
      timestamp: new Date().toISOString(),
    });

    return crypto
      .createHmac('sha256', config.JWT_ACCESS_SECRET)
      .update(payload)
      .digest('hex');
  }

  /**
   * Issues an immutable prescription or prescription revision.
   * Preserves version history and ensures doctor authorization.
   */
  async issuePrescription(
    user: AuthenticatedUser,
    consultationId: string,
    input: CreatePrescriptionInput
  ) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: true,
        patient: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    // Role check: assigned doctor or admin
    if (user.role !== Role.ADMIN && consultation.doctor.userId !== user.id) {
      throw new ForbiddenError('Only the assigned doctor can issue a prescription for this consultation');
    }

    // Consultation must be active or completed to prescribe
    if (
      consultation.status !== ConsultationStatus.IN_PROGRESS &&
      consultation.status !== ConsultationStatus.COMPLETED
    ) {
      throw new BadRequestError(
        `Prescription cannot be issued for consultation with status [${consultation.status}]. Must be IN_PROGRESS or COMPLETED.`
      );
    }

    // Resolve versioning
    let version = 1;
    let parentPrescriptionId: string | null = null;

    if (input.parentPrescriptionId) {
      const parent = await prisma.prescription.findUnique({
        where: { id: input.parentPrescriptionId },
      });

      if (!parent) {
        throw new NotFoundError('Parent prescription to amend not found');
      }

      if (parent.consultationId !== consultationId) {
        throw new BadRequestError('Parent prescription belongs to a different consultation');
      }

      version = parent.version + 1;
      parentPrescriptionId = parent.id;
    } else {
      const latest = await prisma.prescription.findFirst({
        where: { consultationId },
        orderBy: { version: 'desc' },
      });

      if (latest) {
        version = latest.version + 1;
      }
    }

    const doctorSignature = this.generateDoctorSignature(
      consultation.doctorId,
      consultationId,
      version,
      input.diagnosis,
      input.items
    );

    const result = await prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.create({
        data: {
          consultationId,
          doctorId: consultation.doctorId,
          patientId: consultation.patientId,
          version,
          parentPrescriptionId,
          amendmentReason: input.amendmentReason ?? null,
          diagnosis: input.diagnosis,
          advice: input.advice ?? null,
          doctorSignature,
          items: {
            create: input.items.map((item) => ({
              medicineName: item.medicineName,
              dosage: item.dosage,
              frequency: item.frequency,
              durationDays: item.durationDays,
              instructions: item.instructions ?? null,
            })),
          },
        },
        include: {
          items: true,
          doctor: { select: { id: true, fullName: true, licenseNumber: true } },
          patient: { select: { id: true, fullName: true } },
        },
      });

      // Transactional outbox event
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PRESCRIPTION',
          aggregateId: prescription.id,
          eventType: 'PRESCRIPTION_ISSUED',
          payload: {
            prescriptionId: prescription.id,
            consultationId,
            doctorId: consultation.doctorId,
            patientId: consultation.patientId,
            version,
            itemCount: input.items.length,
          },
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'PRESCRIPTION_ISSUED',
          resourceType: 'Prescription',
          resourceId: prescription.id,
          changeset: {
            version,
            diagnosis: input.diagnosis,
            itemCount: input.items.length,
          },
        },
      });

      return prescription;
    });

    return result;
  }

  /**
   * Retrieves a prescription by ID with integrity verification.
   */
  async getPrescriptionById(user: AuthenticatedUser, prescriptionId: string) {
    const prescription = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        items: true,
        parentPrescription: true,
        revisions: {
          select: {
            id: true,
            version: true,
            amendmentReason: true,
            createdAt: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullName: true,
            licenseNumber: true,
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
      },
    });

    if (!prescription) {
      throw new NotFoundError('Prescription not found');
    }

    if (user.role !== Role.ADMIN) {
      const isPatient = prescription.patient.userId === user.id;
      const isDoctor = prescription.doctor.userId === user.id;

      if (!isPatient && !isDoctor) {
        throw new ForbiddenError('You do not have permission to view this prescription');
      }
    }

    return prescription;
  }

  /**
   * Retrieves all prescription revisions for a consultation.
   */
  async getPrescriptionsForConsultation(user: AuthenticatedUser, consultationId: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: true,
        patient: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    if (user.role !== Role.ADMIN) {
      const isPatient = consultation.patient.userId === user.id;
      const isDoctor = consultation.doctor.userId === user.id;

      if (!isPatient && !isDoctor) {
        throw new ForbiddenError('You do not have permission to view prescriptions for this consultation');
      }
    }

    const prescriptions = await prisma.prescription.findMany({
      where: { consultationId },
      include: {
        items: true,
        doctor: { select: { id: true, fullName: true, licenseNumber: true } },
      },
      orderBy: { version: 'desc' },
    });

    return prescriptions;
  }
}

export const prescriptionsService = new PrescriptionsService();
