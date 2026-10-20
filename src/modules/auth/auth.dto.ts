import { z } from 'zod';

export const registerPatientSchema = z.object({
  body: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Valid email address is required'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{9,14}$/, 'Phone number must be between 10 and 15 digits in E.164 or national format'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .max(128, 'Password cannot exceed 128 characters'),
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must be at least 2 characters long')
      .max(100, 'Full name cannot exceed 100 characters'),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    dateOfBirth: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Valid email address is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export const mfaChallengeSchema = z.object({
  body: z.object({
    tempToken: z.string().min(1, 'Temporary MFA authentication token is required'),
    code: z
      .string()
      .trim()
      .min(6, 'Verification code must be at least 6 characters (TOTP or backup code)'),
  }),
});

export const mfaEnrollSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Password re-verification is required to initiate MFA enrollment'),
  }),
});

export const mfaVerifyEnrollmentSchema = z.object({
  body: z.object({
    totpCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
  }),
});

export const mfaDisableSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Password re-verification is required to disable MFA'),
    code: z.string().trim().min(6, 'TOTP code or backup recovery code is required'),
  }),
});
