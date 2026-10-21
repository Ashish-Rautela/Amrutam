import { z } from 'zod';
import { ConsentType } from '@prisma/client';

export const recordConsentSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid consultation ID format'),
  }),
  body: z.object({
    granted: z.literal(true, {
      errorMap: () => ({ message: 'Explicit consent must be granted to proceed with teleconsultation' }),
    }),
    consentType: z.nativeEnum(ConsentType).default(ConsentType.TELEMEDICINE_CONSULTATION),
    version: z.string().min(1).default('TPG_2020_V1'),
  }),
});

export type RecordConsentInput = z.infer<typeof recordConsentSchema>['body'];

export const startConsultationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid consultation ID format'),
  }),
});

export const completeConsultationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid consultation ID format'),
  }),
  body: z.object({
    clinicalNotes: z.string().min(3, 'Clinical notes must be at least 3 characters long').max(5000),
  }),
});

export type CompleteConsultationInput = z.infer<typeof completeConsultationSchema>['body'];

export const noShowConsultationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid consultation ID format'),
  }),
});

export const getConsultationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid consultation ID format'),
  }),
});
