import { Router } from 'express';
import { DoctorsController } from './doctors.controller.js';
import { authenticate } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import {
  submitDoctorProfileSchema,
  updateDoctorProfileSchema,
  queryDoctorDirectorySchema,
} from './doctors.dto.js';

export const doctorsRouter = Router();

// Public doctor directory routes
doctorsRouter.get('/', validate(queryDoctorDirectorySchema), DoctorsController.getPublicDirectory);
doctorsRouter.get('/profile/me', authenticate, DoctorsController.getMyProfile);
doctorsRouter.get('/:id', DoctorsController.getPublicDoctorById);

// Authenticated doctor profile routes
doctorsRouter.post('/profile', authenticate, validate(submitDoctorProfileSchema), DoctorsController.submitProfile);
doctorsRouter.patch('/profile/me', authenticate, validate(updateDoctorProfileSchema), DoctorsController.updateMyProfile);
doctorsRouter.put('/profile/me', authenticate, validate(updateDoctorProfileSchema), DoctorsController.updateMyProfile);
