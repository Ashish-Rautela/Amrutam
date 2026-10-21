import { z } from 'zod';
import { ConsultationMode } from '@prisma/client';

export const submitDoctorProfileSchema = z.object({
  body: z.object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must be at least 2 characters')
      .max(100, 'Full name cannot exceed 100 characters'),
    licenseNumber: z
      .string()
      .trim()
      .min(3, 'License number must be at least 3 characters')
      .max(50, 'License number cannot exceed 50 characters')
      .regex(/^[A-Za-z0-9\-\/]+$/, 'License number must contain only alphanumeric characters, hyphens, and slashes'),
    specializations: z
      .array(z.string().trim().min(2).max(50))
      .min(1, 'At least one specialization is required')
      .max(10, 'Maximum 10 specializations allowed'),
    qualifications: z
      .array(z.string().trim().min(2).max(50))
      .min(1, 'At least one qualification is required')
      .max(10, 'Maximum 10 qualifications allowed'),
    experienceYears: z
      .coerce
      .number()
      .int()
      .min(0, 'Experience years must be >= 0')
      .max(70, 'Experience years cannot exceed 70'),
    consultationFee: z
      .coerce
      .number()
      .min(0, 'Consultation fee must be >= 0')
      .max(100000, 'Consultation fee cannot exceed 100,000'),
    supportedModes: z
      .array(z.nativeEnum(ConsultationMode))
      .min(1, 'At least one consultation mode is required'),
    languages: z
      .array(z.string().trim().min(2).max(50))
      .min(1, 'At least one language is required')
      .default(['English', 'Hindi']),
    bio: z.string().trim().max(2000, 'Bio cannot exceed 2000 characters').optional(),
  }),
});

export const updateDoctorProfileSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(100).optional(),
    specializations: z.array(z.string().trim().min(2).max(50)).min(1).max(10).optional(),
    qualifications: z.array(z.string().trim().min(2).max(50)).min(1).max(10).optional(),
    experienceYears: z.coerce.number().int().min(0).max(70).optional(),
    consultationFee: z.coerce.number().min(0).max(100000).optional(),
    supportedModes: z.array(z.nativeEnum(ConsultationMode)).min(1).optional(),
    languages: z.array(z.string().trim().min(2).max(50)).min(1).optional(),
    bio: z.string().trim().max(2000).optional(),
  }),
});

export const queryDoctorDirectorySchema = z.object({
  query: z.object({
    specialization: z.string().trim().optional(),
    mode: z.nativeEnum(ConsultationMode).optional(),
    language: z.string().trim().optional(),
    minFee: z.coerce.number().min(0).optional(),
    maxFee: z.coerce.number().min(0).optional(),
    sortBy: z.enum(['experienceYears', 'consultationFee', 'createdAt', 'fullName']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
});

export const adminRejectDoctorSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(5, 'Rejection reason must be at least 5 characters')
      .max(500, 'Rejection reason cannot exceed 500 characters'),
  }),
});

export const adminQueryPendingDoctorsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
});
