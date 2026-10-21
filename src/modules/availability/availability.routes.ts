import { Router } from 'express';
import { Role } from '@prisma/client';
import { AvailabilityController } from './availability.controller.js';
import { authenticate, authorizeRoles } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import {
  createAvailabilitySlotsSchema,
  updateAvailabilitySlotSchema,
  queryAvailabilitySlotsSchema,
  queryDoctorPublicSlotsSchema,
} from './availability.dto.js';

export const availabilityRouter = Router();

// Public availability query for an approved doctor
availabilityRouter.get(
  '/doctors/:doctorId',
  validate(queryDoctorPublicSlotsSchema),
  AvailabilityController.getDoctorPublicAvailability
);

// Protected doctor availability routes (Doctor only)
availabilityRouter.post(
  '/slots',
  authenticate,
  authorizeRoles(Role.DOCTOR),
  validate(createAvailabilitySlotsSchema),
  AvailabilityController.createSlots
);

availabilityRouter.get(
  '/my-slots',
  authenticate,
  authorizeRoles(Role.DOCTOR),
  validate(queryAvailabilitySlotsSchema),
  AvailabilityController.getMySlots
);

availabilityRouter.patch(
  '/slots/:id',
  authenticate,
  authorizeRoles(Role.DOCTOR),
  validate(updateAvailabilitySlotSchema),
  AvailabilityController.updateSlot
);

availabilityRouter.put(
  '/slots/:id',
  authenticate,
  authorizeRoles(Role.DOCTOR),
  validate(updateAvailabilitySlotSchema),
  AvailabilityController.updateSlot
);

availabilityRouter.delete(
  '/slots/:id',
  authenticate,
  authorizeRoles(Role.DOCTOR),
  AvailabilityController.cancelSlot
);

availabilityRouter.post(
  '/slots/:id/cancel',
  authenticate,
  authorizeRoles(Role.DOCTOR),
  AvailabilityController.cancelSlot
);
