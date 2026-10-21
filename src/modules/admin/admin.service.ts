import { ConsultationStatus, PaymentStatus, VerificationStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

export interface AuditLogQuery {
  actorId?: string;
  resourceType?: string;
  action?: string;
  page?: number;
  limit?: number;
}

export class AdminService {
  /**
   * Aggregates platform operational analytics across consultations, payments, and providers.
   */
  public static async getAnalyticsOverview() {
    // 1. Consultation counts grouped by status
    const consultationCounts = await prisma.consultation.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const byConsultationStatus: Record<string, number> = {
      [ConsultationStatus.BOOKED]: 0,
      [ConsultationStatus.CONFIRMED]: 0,
      [ConsultationStatus.IN_PROGRESS]: 0,
      [ConsultationStatus.COMPLETED]: 0,
      [ConsultationStatus.CANCELLED]: 0,
      [ConsultationStatus.NO_SHOW]: 0,
    };

    let totalConsultations = 0;
    for (const item of consultationCounts) {
      byConsultationStatus[item.status] = item._count.status;
      totalConsultations += item._count.status;
    }

    const cancelledCount = byConsultationStatus[ConsultationStatus.CANCELLED] || 0;
    const cancellationRate =
      totalConsultations > 0
        ? Number(((cancelledCount / totalConsultations) * 100).toFixed(2))
        : 0;

    // 2. Payment metrics
    const paymentCounts = await prisma.payment.groupBy({
      by: ['status'],
      _count: { status: true },
      _sum: { amount: true },
    });

    const byPaymentStatus: Record<string, { count: number; totalAmount: number }> = {
      [PaymentStatus.PENDING]: { count: 0, totalAmount: 0 },
      [PaymentStatus.CAPTURED]: { count: 0, totalAmount: 0 },
      [PaymentStatus.FAILED]: { count: 0, totalAmount: 0 },
      [PaymentStatus.REFUNDED]: { count: 0, totalAmount: 0 },
    };

    let totalCapturedRevenue = 0;
    for (const item of paymentCounts) {
      const sum = item._sum.amount ? Number(item._sum.amount) : 0;
      byPaymentStatus[item.status] = {
        count: item._count.status,
        totalAmount: sum,
      };
      if (item.status === PaymentStatus.CAPTURED) {
        totalCapturedRevenue = sum;
      }
    }

    // 3. Doctor verification metrics
    const doctorCounts = await prisma.doctorProfile.groupBy({
      by: ['verificationStatus'],
      _count: { verificationStatus: true },
    });

    const byDoctorStatus: Record<string, number> = {
      [VerificationStatus.PENDING]: 0,
      [VerificationStatus.VERIFIED]: 0,
      [VerificationStatus.REJECTED]: 0,
    };

    let totalDoctors = 0;
    for (const item of doctorCounts) {
      byDoctorStatus[item.verificationStatus] = item._count.verificationStatus;
      totalDoctors += item._count.verificationStatus;
    }

    return {
      consultations: {
        total: totalConsultations,
        byStatus: byConsultationStatus,
        cancellationRatePercent: cancellationRate,
      },
      payments: {
        totalCapturedRevenue,
        byStatus: byPaymentStatus,
      },
      doctors: {
        total: totalDoctors,
        byVerificationStatus: byDoctorStatus,
      },
    };
  }

  /**
   * Retrieves paginated system audit logs for administrative compliance reviews.
   */
  public static async getAuditLogs(query: AuditLogQuery) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 && query.limit <= 100 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.action) where.action = query.action;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
