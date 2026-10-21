import { Request, Response, NextFunction } from 'express';
import { consultationsService } from './consultations.service.js';

export class ConsultationsController {
  async recordConsent(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || undefined;
      const userAgent = req.headers['user-agent'];

      const result = await consultationsService.recordConsent(
        user,
        req.params.id,
        req.body,
        ipAddress,
        userAgent
      );

      res.status(200).json({
        success: true,
        message: 'Patient teleconsultation consent recorded successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async startConsultation(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await consultationsService.startConsultation(user, req.params.id);

      res.status(200).json({
        success: true,
        message: 'Consultation commenced successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async completeConsultation(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await consultationsService.completeConsultation(
        user,
        req.params.id,
        req.body
      );

      res.status(200).json({
        success: true,
        message: 'Consultation completed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async markNoShow(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await consultationsService.markNoShow(user, req.params.id);

      res.status(200).json({
        success: true,
        message: 'Consultation marked as no-show',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getConsultationById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await consultationsService.getConsultationById(user, req.params.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const consultationsController = new ConsultationsController();
