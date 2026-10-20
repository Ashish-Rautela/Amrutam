import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../common/middleware/validation.middleware.js';
import {
  registerPatientSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  mfaChallengeSchema,
  mfaEnrollSchema,
  mfaVerifyEnrollmentSchema,
  mfaDisableSchema,
} from './auth.dto.js';
import { authRateLimiter } from '../../common/middleware/rate-limiter.js';
import { authenticate } from '../../common/middleware/auth.middleware.js';

export const authRouter = Router();

// Public authentication endpoints with rate limiting
authRouter.post('/register', authRateLimiter, validate(registerPatientSchema), AuthController.register);
authRouter.post('/login', authRateLimiter, validate(loginSchema), AuthController.login);
authRouter.post('/mfa/challenge', authRateLimiter, validate(mfaChallengeSchema), AuthController.mfaChallenge);
authRouter.post('/refresh', authRateLimiter, validate(refreshTokenSchema), AuthController.refresh);
authRouter.post('/logout', validate(logoutSchema), AuthController.logout);

// Protected authenticated routes
authRouter.get('/me', authenticate, AuthController.getMe);
authRouter.post('/logout-all', authenticate, AuthController.logoutAll);
authRouter.post('/mfa/enroll', authenticate, validate(mfaEnrollSchema), AuthController.enrollMfa);
authRouter.post('/mfa/verify-enrollment', authenticate, validate(mfaVerifyEnrollmentSchema), AuthController.verifyMfaEnrollment);
authRouter.post('/mfa/disable', authenticate, validate(mfaDisableSchema), AuthController.disableMfa);
