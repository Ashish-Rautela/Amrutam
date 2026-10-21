import { Router } from 'express';
import { Role } from '@prisma/client';
import { AdminController } from './admin.controller.js';
import { authenticate, authorizeRoles } from '../../common/middleware/auth.middleware.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import {
  adminRejectDoctorSchema,
  adminQueryPendingDoctorsSchema,
} from '../doctors/doctors.dto.js';

export const adminRouter = Router();

// Protect all admin routes with authentication and ADMIN role check
adminRouter.use(authenticate, authorizeRoles(Role.ADMIN));

adminRouter.get('/doctors/pending', validate(adminQueryPendingDoctorsSchema), AdminController.getPendingDoctors);
adminRouter.post('/doctors/:id/approve', AdminController.approveDoctor);
adminRouter.post('/doctors/:id/reject', validate(adminRejectDoctorSchema), AdminController.rejectDoctor);

adminRouter.get('/analytics/overview', AdminController.getAnalyticsOverview);
adminRouter.get('/audit-logs', AdminController.getAuditLogs);
