import { Request, Response, NextFunction } from 'express';
import { AvailabilityService } from './availability.service.js';

function getContext(req: Request) {
  return {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    correlationId: req.headers['x-correlation-id'] as string,
  };
}

export class AvailabilityController {
  public static async createSlots(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AvailabilityService.createSlots(req.user!.id, req.body, getContext(req));
      res.status(201).json({
        status: 'success',
        message: 'Availability slots created successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getMySlots(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AvailabilityService.getMySlots(req.user!.id, req.query as any);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getDoctorPublicAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { doctorId } = req.params;
      const { startDate, endDate } = req.query;

      const result = await AvailabilityService.getDoctorPublicAvailability(
        doctorId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async updateSlot(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AvailabilityService.updateSlot(
        req.user!.id,
        req.params.id,
        req.body,
        getContext(req)
      );

      res.status(200).json({
        status: 'success',
        message: 'Availability slot updated successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async cancelSlot(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AvailabilityService.cancelSlot(
        req.user!.id,
        req.params.id,
        getContext(req)
      );

      res.status(200).json({
        status: 'success',
        message: result.message,
        data: result.slot,
      });
    } catch (err) {
      next(err);
    }
  }
}
