import { Role, VerificationStatus, ConsultationMode } from '@prisma/client';
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

export interface SubmitDoctorProfileInput {
  fullName: string;
  licenseNumber: string;
  specializations: string[];
  qualifications: string[];
  experienceYears: number;
  consultationFee: number;
  supportedModes: ConsultationMode[];
  languages: string[];
  bio?: string;
}

export interface UpdateDoctorProfileInput {
  fullName?: string;
  specializations?: string[];
  qualifications?: string[];
  experienceYears?: number;
  consultationFee?: number;
  supportedModes?: ConsultationMode[];
  languages?: string[];
  bio?: string;
}

export interface QueryDoctorDirectoryInput {
  specialization?: string;
  mode?: ConsultationMode;
  language?: string;
  minFee?: number;
  maxFee?: number;
  sortBy?: 'experienceYears' | 'consultationFee' | 'createdAt' | 'fullName';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export class DoctorsService {
  /**
   * Submits a new doctor profile for administrator verification.
   * Public registration creates only PATIENT accounts; submitting a profile
   * leaves the profile in PENDING status until an administrator approves it.
   */
  public static async submitProfile(
    userId: string,
    data: SubmitDoctorProfileInput,
    context?: RequestContext
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User account not found');
    }

    const existingProfile = await prisma.doctorProfile.findUnique({
      where: { userId },
    });
    if (existingProfile) {
      throw new ConflictError('A doctor profile already exists for this account');
    }

    const normalizedLicense = data.licenseNumber.trim().toUpperCase();
    const existingLicense = await prisma.doctorProfile.findUnique({
      where: { licenseNumber: normalizedLicense },
    });
    if (existingLicense) {
      throw new ConflictError('This medical license number is already registered to another doctor');
    }

    return prisma.$transaction(async (tx) => {
      const profile = await tx.doctorProfile.create({
        data: {
          userId,
          fullName: data.fullName.trim(),
          licenseNumber: normalizedLicense,
          specializations: data.specializations,
          qualifications: data.qualifications,
          experienceYears: data.experienceYears,
          consultationFee: data.consultationFee,
          supportedModes: data.supportedModes,
          languages: data.languages,
          bio: data.bio?.trim() || null,
          verificationStatus: VerificationStatus.PENDING,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'DOCTOR_PROFILE_SUBMITTED',
          resourceType: 'DOCTOR_PROFILE',
          resourceId: profile.id,
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      logger.info({
        msg: 'Doctor profile submitted for verification',
        doctorId: profile.id,
        userId,
        licenseNumber: normalizedLicense,
        correlationId: context?.correlationId,
      });

      return profile;
    });
  }

  /**
   * Retrieves the authenticated doctor's own profile.
   */
  public static async getMyProfile(userId: string) {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundError('Doctor profile not found for this account');
    }

    return profile;
  }

  /**
   * Updates permitted doctor profile fields.
   * Mass assignment of role, license, or verification fields is strictly prevented.
   */
  public static async updateMyProfile(
    userId: string,
    data: UpdateDoctorProfileInput,
    context?: RequestContext
  ) {
    const existing = await prisma.doctorProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundError('Doctor profile not found for this account');
    }

    const updatePayload: any = {};
    if (data.fullName !== undefined) updatePayload.fullName = data.fullName.trim();
    if (data.specializations !== undefined) updatePayload.specializations = data.specializations;
    if (data.qualifications !== undefined) updatePayload.qualifications = data.qualifications;
    if (data.experienceYears !== undefined) updatePayload.experienceYears = data.experienceYears;
    if (data.consultationFee !== undefined) updatePayload.consultationFee = data.consultationFee;
    if (data.supportedModes !== undefined) updatePayload.supportedModes = data.supportedModes;
    if (data.languages !== undefined) updatePayload.languages = data.languages;
    if (data.bio !== undefined) updatePayload.bio = data.bio?.trim() || null;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.doctorProfile.update({
        where: { id: existing.id },
        data: updatePayload,
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DOCTOR_PROFILE_UPDATED',
          resourceType: 'DOCTOR_PROFILE',
          resourceId: existing.id,
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      return updated;
    });
  }

  /**
   * Public doctor directory search with pagination, filtering, and stable sorting.
   * Only approved (VERIFIED) doctors are returned.
   */
  public static async getPublicDirectory(query: QueryDoctorDirectoryInput) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {
      verificationStatus: VerificationStatus.VERIFIED,
    };

    if (query.specialization) {
      where.specializations = { has: query.specialization };
    }

    if (query.mode) {
      where.supportedModes = { has: query.mode };
    }

    if (query.language) {
      where.languages = { has: query.language };
    }

    if (query.minFee !== undefined || query.maxFee !== undefined) {
      where.consultationFee = {};
      if (query.minFee !== undefined) where.consultationFee.gte = query.minFee;
      if (query.maxFee !== undefined) where.consultationFee.lte = query.maxFee;
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    const [total, doctors] = await Promise.all([
      prisma.doctorProfile.count({ where }),
      prisma.doctorProfile.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          specializations: true,
          qualifications: true,
          experienceYears: true,
          consultationFee: true,
          supportedModes: true,
          languages: true,
          bio: true,
          verificationStatus: true,
          verifiedAt: true,
          createdAt: true,
        },
        orderBy: [
          { [sortBy]: sortOrder },
          { id: 'asc' }, // Stable secondary sort
        ],
        skip,
        take: limit,
      }),
    ]);

    return {
      data: doctors,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Public retrieval of a single approved doctor profile by ID.
   */
  public static async getPublicDoctorById(doctorId: string) {
    const doctor = await prisma.doctorProfile.findFirst({
      where: {
        id: doctorId,
        verificationStatus: VerificationStatus.VERIFIED,
      },
      select: {
        id: true,
        fullName: true,
        specializations: true,
        qualifications: true,
        experienceYears: true,
        consultationFee: true,
        supportedModes: true,
        languages: true,
        bio: true,
        verificationStatus: true,
        verifiedAt: true,
        createdAt: true,
      },
    });

    if (!doctor) {
      throw new NotFoundError('Doctor not found or profile is not currently verified');
    }

    return doctor;
  }

  /**
   * Admin endpoint: Retrieve profiles awaiting verification.
   */
  public static async adminGetPendingProfiles(page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const where = { verificationStatus: VerificationStatus.PENDING };

    const [total, profiles] = await Promise.all([
      prisma.doctorProfile.count({ where }),
      prisma.doctorProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              role: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: safeLimit,
      }),
    ]);

    return {
      data: profiles,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Admin endpoint: Approve doctor profile and assign Role.DOCTOR.
   * Enforces rule: A doctor must not approve their own profile.
   */
  public static async adminApproveDoctor(
    adminUserId: string,
    doctorProfileId: string,
    context?: RequestContext
  ) {
    const profile = await prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
      include: { user: true },
    });

    if (!profile) {
      throw new NotFoundError('Doctor profile not found');
    }

    // Security guardrail: A doctor must not approve their own profile
    if (profile.userId === adminUserId) {
      throw new ForbiddenError('Administrators cannot approve their own doctor profile');
    }

    if (profile.verificationStatus === VerificationStatus.VERIFIED) {
      throw new BadRequestError('Doctor profile is already verified');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.doctorProfile.update({
        where: { id: doctorProfileId },
        data: {
          verificationStatus: VerificationStatus.VERIFIED,
          verifiedAt: new Date(),
          verifiedBy: adminUserId,
          rejectionReason: null,
        },
      });

      // Promote user account to DOCTOR role
      await tx.user.update({
        where: { id: profile.userId },
        data: { role: Role.DOCTOR },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'DOCTOR_PROFILE_APPROVED',
          resourceType: 'DOCTOR_PROFILE',
          resourceId: doctorProfileId,
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      logger.info({
        msg: 'Doctor profile approved by admin',
        doctorProfileId,
        doctorId: profile.userId,
        adminUserId,
      });

      return updated;
    });
  }

  /**
   * Admin endpoint: Reject doctor profile with a mandatory reason.
   * Enforces rule: A doctor must not reject their own profile.
   */
  public static async adminRejectDoctor(
    adminUserId: string,
    doctorProfileId: string,
    reason: string,
    context?: RequestContext
  ) {
    const profile = await prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
    });

    if (!profile) {
      throw new NotFoundError('Doctor profile not found');
    }

    if (profile.userId === adminUserId) {
      throw new ForbiddenError('Administrators cannot reject their own doctor profile');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.doctorProfile.update({
        where: { id: doctorProfileId },
        data: {
          verificationStatus: VerificationStatus.REJECTED,
          rejectionReason: reason.trim(),
          verifiedBy: adminUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'DOCTOR_PROFILE_REJECTED',
          resourceType: 'DOCTOR_PROFILE',
          resourceId: doctorProfileId,
          changeset: { reason: reason.trim() },
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      logger.info({
        msg: 'Doctor profile rejected by admin',
        doctorProfileId,
        adminUserId,
        reason: reason.trim(),
      });

      return updated;
    });
  }
}
