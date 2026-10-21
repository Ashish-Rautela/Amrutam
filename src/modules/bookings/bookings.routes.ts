import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorizeRoles } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import { bookingsController } from './bookings.controller.js';
import {
  createBookingSchema,
  cancelBookingSchema,
  getBookingSchema,
  listBookingsSchema,
} from './bookings.dto.js';

export const bookingsRouter = Router();

bookingsRouter.use(authenticate);

bookingsRouter.post(
  '/',
  authorizeRoles(Role.PATIENT, Role.ADMIN),
  validate(createBookingSchema),
  bookingsController.createBooking
);

bookingsRouter.get(
  '/',
  validate(listBookingsSchema),
  bookingsController.listBookings
);

bookingsRouter.get(
  '/:id',
  validate(getBookingSchema),
  bookingsController.getBookingById
);

bookingsRouter.post(
  '/:id/cancel',
  validate(cancelBookingSchema),
  bookingsController.cancelBooking
);
