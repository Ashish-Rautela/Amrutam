import { Request, Response, NextFunction } from 'express';
import { bookingsService } from './bookings.service.js';
import { withIdempotency } from '../../common/idempotency/idempotency.js';

export class BookingsController {
  async createBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      const result = await withIdempotency(
        user.id,
        idempotencyKey,
        'BOOKING_CREATE',
        req.body,
        async () => {
          const booking = await bookingsService.createBooking(user, req.body);
          return {
            status: 201,
            body: {
              success: true,
              message: 'Appointment booked successfully',
              data: booking,
            },
          };
        }
      );

      if (result.cached) {
        res.setHeader('X-Cache-Lookup', 'HIT');
        res.setHeader('X-Idempotent-Replay', 'true');
      }

      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  }

  async getBookingById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const booking = await bookingsService.getBookingById(user, req.params.id);
      res.status(200).json({
        success: true,
        data: booking,
      });
    } catch (error) {
      next(error);
    }
  }

  async listBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await bookingsService.listBookings(user, req.query as any);
      res.status(200).json({
        success: true,
        data: result.data,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const cancelled = await bookingsService.cancelBooking(user, req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: 'Booking cancelled successfully',
        data: cancelled,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const bookingsController = new BookingsController();
