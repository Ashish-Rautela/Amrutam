import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorizeRoles } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import { consultationsController } from './consultations.controller.js';
import { prescriptionsController } from '../prescriptions/prescriptions.controller.js';
import {
  recordConsentSchema,
  startConsultationSchema,
  completeConsultationSchema,
  noShowConsultationSchema,
  getConsultationSchema,
} from './consultations.dto.js';
import { createPrescriptionSchema } from '../prescriptions/prescriptions.dto.js';

export const consultationsRouter = Router();

consultationsRouter.use(authenticate);

// Consent
consultationsRouter.post(
  '/:id/consent',
  validate(recordConsentSchema),
  consultationsController.recordConsent
);

// Lifecycle transitions
consultationsRouter.post(
  '/:id/start',
  authorizeRoles(Role.DOCTOR, Role.ADMIN),
  validate(startConsultationSchema),
  consultationsController.startConsultation
);

consultationsRouter.post(
  '/:id/complete',
  authorizeRoles(Role.DOCTOR, Role.ADMIN),
  validate(completeConsultationSchema),
  consultationsController.completeConsultation
);

consultationsRouter.post(
  '/:id/no-show',
  authorizeRoles(Role.DOCTOR, Role.ADMIN),
  validate(noShowConsultationSchema),
  consultationsController.markNoShow
);

// Consultations retrieval
consultationsRouter.get(
  '/:id',
  validate(getConsultationSchema),
  consultationsController.getConsultationById
);

// Prescription issuance and retrieval for consultation
consultationsRouter.post(
  '/:id/prescriptions',
  authorizeRoles(Role.DOCTOR, Role.ADMIN),
  validate(createPrescriptionSchema),
  prescriptionsController.issuePrescription
);

consultationsRouter.get(
  '/:id/prescriptions',
  validate(getConsultationSchema),
  prescriptionsController.getPrescriptionsForConsultation
);
