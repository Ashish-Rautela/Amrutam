import { Request, Response, NextFunction } from 'express';
import { DoctorsService } from '../doctors/doctors.service.js';
import { AdminService } from './admin.service.js';

function getContext(req: Request) {
  return {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    correlationId: req.headers['x-correlation-id'] as string,
  };
}

export class AdminController {
  public static async getPendingDoctors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await DoctorsService.adminGetPendingProfiles(page, limit);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async approveDoctor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminUserId = req.user!.id;
      const doctorProfileId = req.params.id;

      const result = await DoctorsService.adminApproveDoctor(adminUserId, doctorProfileId, getContext(req));
      res.status(200).json({
        status: 'success',
        message: 'Doctor profile approved successfully. User role upgraded to DOCTOR.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async rejectDoctor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminUserId = req.user!.id;
      const doctorProfileId = req.params.id;
      const { reason } = req.body;

      const result = await DoctorsService.adminRejectDoctor(adminUserId, doctorProfileId, reason, getContext(req));
      res.status(200).json({
        status: 'success',
        message: 'Doctor profile has been rejected.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getAnalyticsOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await AdminService.getAnalyticsOverview();
      res.status(200).json({
        status: 'success',
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = {
        actorId: req.query.actorId as string,
        resourceType: req.query.resourceType as string,
        action: req.query.action as string,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
      };

      const result = await AdminService.getAuditLogs(query);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  }
}
