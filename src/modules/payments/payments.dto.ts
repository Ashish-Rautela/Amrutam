import { z } from 'zod';
import { PaymentProvider } from '@prisma/client';

export const createOrderSchema = z.object({
  body: z.object({
    consultationId: z.string().uuid('Invalid consultation ID format'),
    provider: z.nativeEnum(PaymentProvider).optional(),
  }),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>['body'];

export const mockCaptureSchema = z.object({
  body: z.object({
    orderId: z.string().min(1, 'Order ID is required'),
    paymentId: z.string().optional(),
  }),
});

export type MockCaptureInput = z.infer<typeof mockCaptureSchema>['body'];

export const getPaymentByConsultationSchema = z.object({
  params: z.object({
    consultationId: z.string().uuid('Invalid consultation ID format'),
  }),
});
