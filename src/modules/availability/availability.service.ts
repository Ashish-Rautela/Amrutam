import { Role, SlotStatus, VerificationStatus, ConsultationStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import { logger } from '../../common/observability/logger.js';

interface RequestContext {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface SlotInput {
  startTime: string;
  endTime: string;
}

export class AvailabilityService {
  /**
   * Helper to verify that the requesting user is a verified doctor.
   */
  private static async getVerifiedDoctor(userId: string) {
    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId },
    });

    if (!doctor) {
      throw new ForbiddenError('Doctor profile not found for this user account');
    }

    if (doctor.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ForbiddenError(
        'Only verified doctors are permitted to publish or manage availability slots'
      );
    }

    return doctor;
  }

  /**
   * Creates one or more availability slots for the authenticated verified doctor.
   * Enforces:
   * 1. Start time must precede end time.
   * 2. Slot cannot be scheduled in the past.
   * 3. Minimum slot duration of 10 minutes, maximum of 4 hours.
   * 4. Batch self-overlap prevention.
   * 5. PostgreSQL-level exclusion constraint preventing overlapping slots for the same doctor.
   */
  public static async createSlots(
    userId: string,
    input: { startTime?: string; endTime?: string; slots?: SlotInput[] },
    context?: RequestContext
  ) {
    const doctor = await this.getVerifiedDoctor(userId);

    const rawSlots: SlotInput[] = [];
    if (input.slots && input.slots.length > 0) {
      rawSlots.push(...input.slots);
    } else if (input.startTime && input.endTime) {
      rawSlots.push({ startTime: input.startTime, endTime: input.endTime });
    } else {
      throw new BadRequestError('Either provide startTime and endTime, or an array of slots');
    }

    const now = new Date();
    // 5-minute grace buffer for network clock skew
    const earliestAllowed = new Date(now.getTime() - 5 * 60 * 1000);

    const normalizedSlots = rawSlots.map((s, index) => {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestError(`Slot at index ${index} contains an invalid ISO 8601 date string`);
      }

      if (start >= end) {
        throw new BadRequestError(`Slot at index ${index}: end time must be strictly after start time`);
      }

      if (start < earliestAllowed) {
        throw new BadRequestError(
          `Slot at index ${index}: cannot schedule availability slots in the past`
        );
      }

      const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      if (durationMinutes < 10) {
        throw new BadRequestError(
          `Slot at index ${index}: slot duration must be at least 10 minutes (provided: ${durationMinutes.toFixed(1)} mins)`
        );
      }

      if (durationMinutes > 240) {
        throw new BadRequestError(
          `Slot at index ${index}: slot duration cannot exceed 4 hours (provided: ${durationMinutes.toFixed(1)} mins)`
        );
      }

      return {
        doctorId: doctor.id,
        startTime: start,
        endTime: end,
        status: SlotStatus.AVAILABLE,
      };
    });

    // Check for internal overlaps within the request batch itself
    normalizedSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < normalizedSlots.length - 1; i++) {
      const current = normalizedSlots[i];
      const next = normalizedSlots[i + 1];

      if (current.endTime.getTime() > next.startTime.getTime()) {
        throw new BadRequestError(
          `Batch contains overlapping slots: [${current.startTime.toISOString()} - ${current.endTime.toISOString()}] overlaps with [${next.startTime.toISOString()} - ${next.endTime.toISOString()}]`
        );
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const createdSlots = await Promise.all(
          normalizedSlots.map((slotData) =>
            tx.availabilitySlot.create({
              data: slotData,
            })
          )
        );

        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorRole: Role.DOCTOR,
            action: 'AVAILABILITY_SLOTS_CREATED',
            resourceType: 'AVAILABILITY_SLOT',
            resourceId: doctor.id,
            changeset: { count: createdSlots.length },
            ipAddress: context?.ip,
            userAgent: context?.userAgent,
            correlationId: context?.correlationId,
          },
        });

        logger.info({
          msg: 'Availability slots created successfully',
          doctorId: doctor.id,
          count: createdSlots.length,
          correlationId: context?.correlationId,
        });

        return createdSlots;
      });
    } catch (err: any) {
      // Check for PostgreSQL exclusion constraint error (23P01 or constraint name no_overlapping_doctor_slots)
      if (
        err.message?.includes('no_overlapping_doctor_slots') ||
        err.message?.includes('23P01') ||
        err.code === '23P01' ||
        err.code === 'P2002' ||
        err.code === 'P2010'
      ) {
        throw new ConflictError(
          'One or more availability slots overlap with an existing slot in your schedule'
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves the authenticated doctor's own slots with optional filtering.
   */
  public static async getMySlots(
    userId: string,
    query: {
      startDate?: string;
      endDate?: string;
      status?: SlotStatus;
      page?: number;
      limit?: number;
    }
  ) {
    const doctor = await this.getVerifiedDoctor(userId);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const where: any = {
      doctorId: doctor.id,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.startTime = {};
      if (query.startDate) where.startTime.gte = new Date(query.startDate);
      if (query.endDate) where.startTime.lte = new Date(query.endDate);
    }

    const [total, slots] = await Promise.all([
      prisma.availabilitySlot.count({ where }),
      prisma.availabilitySlot.findMany({
        where,
        orderBy: { startTime: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: slots,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Public retrieval of available slots for an approved doctor.
   */
  public static async getDoctorPublicAvailability(
    doctorId: string,
    startDate?: string,
    endDate?: string
  ) {
    const doctor = await prisma.doctorProfile.findUnique({
      where: { id: doctorId },
    });

    if (!doctor || doctor.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new NotFoundError('Doctor not found or not currently verified');
    }

    const now = new Date();
    const where: any = {
      doctorId,
      status: SlotStatus.AVAILABLE,
      startTime: { gte: now },
    };

    if (startDate) {
      const parsedStart = new Date(startDate);
      if (parsedStart > now) {
        where.startTime.gte = parsedStart;
      }
    }

    if (endDate) {
      where.startTime.lte = new Date(endDate);
    }

    const slots = await prisma.availabilitySlot.findMany({
      where,
      select: {
        id: true,
        doctorId: true,
        startTime: true,
        endTime: true,
        status: true,
      },
      orderBy: { startTime: 'asc' },
    });

    return slots;
  }

  /**
   * Updates an existing availability slot.
   * Enforces:
   * 1. Doctor owns the slot.
   * 2. Slot is not cancelled.
   * 3. Slot has no active booked consultation.
   * 4. Time boundaries and non-overlap constraint.
   */
  public static async updateSlot(
    userId: string,
    slotId: string,
    input: { startTime?: string; endTime?: string; status?: SlotStatus },
    context?: RequestContext
  ) {
    const doctor = await this.getVerifiedDoctor(userId);

    const slot = await prisma.availabilitySlot.findUnique({
      where: { id: slotId },
      include: { consultation: true },
    });

    if (!slot) {
      throw new NotFoundError('Availability slot not found');
    }

    if (slot.doctorId !== doctor.id) {
      throw new ForbiddenError('You do not have permission to modify this availability slot');
    }

    if (slot.status === SlotStatus.CANCELLED) {
      throw new BadRequestError('Cannot modify an already cancelled availability slot');
    }

    // Do not permit modifications if slot is associated with an active consultation
    if (slot.consultation && slot.consultation.status !== ConsultationStatus.CANCELLED) {
      throw new ConflictError(
        'Cannot modify this availability slot because it is already booked for an active consultation'
      );
    }

    const newStart = input.startTime ? new Date(input.startTime) : slot.startTime;
    const newEnd = input.endTime ? new Date(input.endTime) : slot.endTime;

    if (newStart >= newEnd) {
      throw new BadRequestError('Slot end time must be strictly after start time');
    }

    const now = new Date();
    if (newStart < new Date(now.getTime() - 5 * 60 * 1000)) {
      throw new BadRequestError('Cannot reschedule an availability slot to the past');
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.availabilitySlot.update({
          where: { id: slotId },
          data: {
            startTime: newStart,
            endTime: newEnd,
            status: input.status !== undefined ? input.status : slot.status,
            version: { increment: 1 },
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorRole: Role.DOCTOR,
            action: 'AVAILABILITY_SLOT_UPDATED',
            resourceType: 'AVAILABILITY_SLOT',
            resourceId: slotId,
            changeset: {
              previous: { startTime: slot.startTime, endTime: slot.endTime, status: slot.status },
              updated: { startTime: newStart, endTime: newEnd, status: updated.status },
            },
            ipAddress: context?.ip,
            userAgent: context?.userAgent,
            correlationId: context?.correlationId,
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (
        err.message?.includes('no_overlapping_doctor_slots') ||
        err.message?.includes('23P01') ||
        err.code === '23P01' ||
        err.code === 'P2002' ||
        err.code === 'P2010'
      ) {
        throw new ConflictError(
          'Updated time interval overlaps with an existing slot in your schedule'
        );
      }
      throw err;
    }
  }

  /**
   * Cancels an availability slot.
   * Slot status transitions to CANCELLED.
   * Cancelling removes it from active overlap constraints in PostgreSQL.
   */
  public static async cancelSlot(
    userId: string,
    slotId: string,
    context?: RequestContext
  ) {
    const doctor = await this.getVerifiedDoctor(userId);

    const slot = await prisma.availabilitySlot.findUnique({
      where: { id: slotId },
      include: { consultation: true },
    });

    if (!slot) {
      throw new NotFoundError('Availability slot not found');
    }

    if (slot.doctorId !== doctor.id) {
      throw new ForbiddenError('You do not have permission to cancel this availability slot');
    }

    if (slot.status === SlotStatus.CANCELLED) {
      return { message: 'Slot is already cancelled', slot };
    }

    if (slot.consultation && slot.consultation.status !== ConsultationStatus.CANCELLED) {
      throw new ConflictError(
        'Cannot cancel an availability slot that is already booked for an active consultation'
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.availabilitySlot.update({
        where: { id: slotId },
        data: {
          status: SlotStatus.CANCELLED,
          version: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: Role.DOCTOR,
          action: 'AVAILABILITY_SLOT_CANCELLED',
          resourceType: 'AVAILABILITY_SLOT',
          resourceId: slotId,
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      logger.info({
        msg: 'Availability slot cancelled by doctor',
        slotId,
        doctorId: doctor.id,
      });

      return {
        message: 'Availability slot successfully cancelled',
        slot: updated,
      };
    });
  }
}
