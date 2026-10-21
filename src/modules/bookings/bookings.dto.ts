import { z } from 'zod';
import { ConsultationMode, ConsultationStatus } from '@prisma/client';

export const createBookingSchema = z.object({
  body: z.object({
    slotId: z.string().uuid('Invalid slotId format'),
    mode: z.nativeEnum(ConsultationMode).default(ConsultationMode.VIDEO),
  }),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>['body'];

export const cancelBookingSchema = z.object({
  body: z.object({
    cancellationReason: z.string().min(3, 'Cancellation reason must be at least 3 characters').max(500),
  }),
  params: z.object({
    id: z.string().uuid('Invalid booking id format'),
  }),
});

export type CancelBookingInput = z.infer<typeof cancelBookingSchema>['body'];

export const getBookingSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid booking id format'),
  }),
});

export const listBookingsSchema = z.object({
  query: z.object({
    status: z.nativeEnum(ConsultationStatus).optional(),
    doctorId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export type ListBookingsQuery = z.infer<typeof listBookingsSchema>['query'];
