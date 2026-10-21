import { Request, Response, NextFunction } from 'express';
import { prescriptionsService } from './prescriptions.service.js';

export class PrescriptionsController {
  async issuePrescription(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const consultationId = req.params.id || req.body.consultationId;
      if (!consultationId) {
        return res.status(400).json({
          type: 'https://api.amrutam.co.in/errors/bad_request',
          title: 'BAD_REQUEST',
          status: 400,
          detail: 'Consultation ID is required in URL parameter or request body',
        });
      }
      const result = await prescriptionsService.issuePrescription(
        user,
        consultationId,
        req.body
      );

      res.status(201).json({
        success: true,
        message: 'Prescription issued successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getPrescriptionById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await prescriptionsService.getPrescriptionById(user, req.params.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getPrescriptionsForConsultation(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await prescriptionsService.getPrescriptionsForConsultation(
        user,
        req.params.id
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const prescriptionsController = new PrescriptionsController();
