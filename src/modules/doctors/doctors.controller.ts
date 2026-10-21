import { Request, Response, NextFunction } from 'express';
import { DoctorsService } from './doctors.service.js';

function getContext(req: Request) {
  return {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    correlationId: req.headers['x-correlation-id'] as string,
  };
}

export class DoctorsController {
  public static async submitProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await DoctorsService.submitProfile(req.user!.id, req.body, getContext(req));
      res.status(201).json({
        status: 'success',
        message: 'Doctor profile submitted for verification. An administrator will review your application.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await DoctorsService.getMyProfile(req.user!.id);
      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async updateMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await DoctorsService.updateMyProfile(req.user!.id, req.body, getContext(req));
      res.status(200).json({
        status: 'success',
        message: 'Doctor profile updated successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getPublicDirectory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await DoctorsService.getPublicDirectory(req.query as any);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getPublicDoctorById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await DoctorsService.getPublicDoctorById(req.params.id);
      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
