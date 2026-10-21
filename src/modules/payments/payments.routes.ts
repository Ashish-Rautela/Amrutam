import { Router } from 'express';
import { authenticate } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import { paymentsController } from './payments.controller.js';
import {
  createOrderSchema,
  mockCaptureSchema,
  getPaymentByConsultationSchema,
} from './payments.dto.js';

export const paymentsRouter = Router();

// Webhook endpoint (unauthenticated, signature-verified)
paymentsRouter.post('/webhook', paymentsController.processWebhook);

// Authenticated payment endpoints
paymentsRouter.post(
  '/create-order',
  authenticate,
  validate(createOrderSchema),
  paymentsController.createPaymentOrder
);

paymentsRouter.post(
  '/orders',
  authenticate,
  validate(createOrderSchema),
  paymentsController.createPaymentOrder
);

paymentsRouter.post(
  '/mock-capture',
  authenticate,
  validate(mockCaptureSchema),
  paymentsController.mockCapture
);

paymentsRouter.get(
  '/consultation/:consultationId',
  authenticate,
  validate(getPaymentByConsultationSchema),
  paymentsController.getPaymentByConsultationId
);
