import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorizeRoles } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import { prescriptionsController } from './prescriptions.controller.js';
import { getPrescriptionSchema } from './prescriptions.dto.js';

export const prescriptionsRouter = Router();

prescriptionsRouter.use(authenticate);

prescriptionsRouter.post('/', authorizeRoles(Role.DOCTOR, Role.ADMIN), prescriptionsController.issuePrescription);

prescriptionsRouter.get(
  '/consultation/:id',
  prescriptionsController.getPrescriptionsForConsultation
);

prescriptionsRouter.get(
  '/:id',
  validate(getPrescriptionSchema),
  prescriptionsController.getPrescriptionById
);
