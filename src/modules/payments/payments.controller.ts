import { Request, Response, NextFunction } from 'express';
import { paymentsService } from './payments.service.js';
import { withIdempotency } from '../../common/idempotency/idempotency.js';

export class PaymentsController {
  async createPaymentOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      const result = await withIdempotency(
        user.id,
        idempotencyKey,
        'PAYMENT_ORDER_CREATE',
        req.body,
        async () => {
          const payment = await paymentsService.createPaymentOrder(
            user,
            req.body,
            idempotencyKey
          );

          return {
            status: 201,
            body: {
              success: true,
              message: 'Payment order created successfully',
              data: {
                paymentId: payment.id,
                consultationId: payment.consultationId,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                provider: payment.provider,
                providerOrderId: payment.providerOrderId,
              },
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

  async processWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const rawBody = (req as any).rawBody as Buffer | undefined;
      const result = await paymentsService.processWebhook(
        rawBody,
        req.headers,
        req.body
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async mockCapture(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await paymentsService.mockCapture(user, req.body);

      res.status(200).json({
        success: true,
        message: 'Payment captured successfully (simulated)',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getPaymentByConsultationId(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const result = await paymentsService.getPaymentByConsultationId(
        user,
        req.params.consultationId
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

export const paymentsController = new PaymentsController();
