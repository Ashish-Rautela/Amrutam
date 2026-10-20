import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { hashToken } from '../../src/common/crypto/tokens.js';
import { enforceOwnership, authorizeRoles, authenticate } from '../../src/common/middleware/auth.middleware.js';
import { errorHandler } from '../../src/common/middleware/error.middleware.js';
import express, { Request, Response } from 'express';

describe('Milestone 2.1 — Authentication & Authorization Security Audit Tests', () => {
  const testRunId = Date.now();
  const testUser = {
    email: `audit_patient_${testRunId}@example.com`,
    phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
    password: 'SecurePassword123!',
    fullName: 'Audit Patient',
  };

  let registeredUserId: string;
  let patientProfileId: string;
  let initialRefreshToken: string;
  let initialAccessToken: string;

  beforeAll(async () => {
    // Register the test user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(testUser);

    expect(res.status).toBe(201);
    registeredUserId = res.body.data.user.id;
    patientProfileId = res.body.data.user.patientProfileId;
    initialRefreshToken = res.body.data.tokens.refreshToken;
    initialAccessToken = res.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    // Clean up created resources
    await prisma.auditLog.deleteMany({ where: { actorId: registeredUserId } });
    await prisma.refreshSession.deleteMany({ where: { userId: registeredUserId } });
    await prisma.userMfaCredential.deleteMany({ where: { userId: registeredUserId } });
    await prisma.patientProfile.deleteMany({ where: { userId: registeredUserId } });
    await prisma.user.deleteMany({ where: { id: registeredUserId } });
    await prisma.$disconnect();
  });

  describe('1. Refresh Token Concurrency & Token Family Revocation', () => {
    it('should prevent token duplication under concurrent refresh requests and assert DB state', async () => {
      // Obtain a fresh refresh token
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const freshToken = loginRes.body.data.tokens.refreshToken;
      const freshTokenHash = hashToken(freshToken);

      // Inspect DB: session is active
      const originalSession = await prisma.refreshSession.findUnique({
        where: { tokenHash: freshTokenHash },
      });
      expect(originalSession).not.toBeNull();
      expect(originalSession!.revoked).toBe(false);

      // Execute two simultaneous refresh requests using the exact same refresh token
      const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/auth/refresh').send({ refreshToken: freshToken }),
        request(app).post('/api/v1/auth/refresh').send({ refreshToken: freshToken }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Concurrency safety: exactly one request succeeds with 200, one fails with 401
      expect(statuses).toEqual([200, 401]);

      // Assert PostgreSQL database state:
      // 1. Original token must be revoked
      const updatedOriginal = await prisma.refreshSession.findUnique({
        where: { tokenHash: freshTokenHash },
      });
      expect(updatedOriginal!.revoked).toBe(true);
      expect(['ROTATED', 'REUSE_ATTACK_DETECTED']).toContain(updatedOriginal!.revocationReason);

      // 2. The second request detected reuse and revoked all sessions in the family
      const allFamilySessions = await prisma.refreshSession.findMany({
        where: { familyId: originalSession!.familyId },
      });

      // All sessions in this family must now be revoked
      for (const s of allFamilySessions) {
        expect(s.revoked).toBe(true);
      }

      // 3. Confirm audit log recorded TOKEN_REUSE_DETECTED
      const reuseLogs = await prisma.auditLog.findMany({
        where: {
          actorId: registeredUserId,
          action: 'TOKEN_REUSE_DETECTED',
        },
      });
      expect(reuseLogs.length).toBeGreaterThanOrEqual(1);

      // 4. Any subsequent attempt to use the newly issued token must fail
      const successfulRes = res1.status === 200 ? res1 : res2;
      const newlyIssuedRefreshToken = successfulRes.body.data.refreshToken;

      const followUpRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: newlyIssuedRefreshToken });

      expect(followUpRes.status).toBe(401);
    });
  });

  describe('2. Single-Use MFA Backup Code Concurrency', () => {
    let backupCodes: string[];
    let userWithMfaId: string;
    const mfaEmail = `mfa_race_${testRunId}@example.com`;
    const mfaPhone = `+9197${Math.floor(10000000 + Math.random() * 90000000)}`;

    beforeAll(async () => {
      // Register dedicated user for MFA race testing
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: mfaEmail,
          phone: mfaPhone,
          password: testUser.password,
          fullName: 'MFA Race User',
        });
      userWithMfaId = regRes.body.data.user.id;
      const token = regRes.body.data.tokens.accessToken;

      // Enroll in MFA
      const enrollRes = await request(app)
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: testUser.password });

      backupCodes = enrollRes.body.data.backupCodes;
      const secret = enrollRes.body.data.secret;

      // Verify enrollment using otplib
      const { authenticator } = await import('otplib');
      const totpCode = authenticator.generate(secret);

      await request(app)
        .post('/api/v1/auth/mfa/verify-enrollment')
        .set('Authorization', `Bearer ${token}`)
        .send({ totpCode });
    });

    afterAll(async () => {
      await prisma.auditLog.deleteMany({ where: { actorId: userWithMfaId } });
      await prisma.refreshSession.deleteMany({ where: { userId: userWithMfaId } });
      await prisma.userMfaCredential.deleteMany({ where: { userId: userWithMfaId } });
      await prisma.patientProfile.deleteMany({ where: { userId: userWithMfaId } });
      await prisma.user.deleteMany({ where: { id: userWithMfaId } });
    });

    it('should strictly enforce single-use backup recovery code under concurrent presentation', async () => {
      // Step 1: Login to get tempToken
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: mfaEmail, password: testUser.password });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.mfaRequired).toBe(true);
      const tempToken = loginRes.body.data.tempToken;

      const codeToUse = backupCodes[0];

      // Fire two concurrent requests presenting the EXACT SAME single-use backup code
      const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/auth/mfa/challenge').send({ tempToken, code: codeToUse }),
        request(app).post('/api/v1/auth/mfa/challenge').send({ tempToken, code: codeToUse }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds, one fails with 401
      expect(statuses).toEqual([200, 401]);

      // Assert PostgreSQL DB state: remaining backup codes count decreased by exactly 1
      const credential = await prisma.userMfaCredential.findUnique({
        where: { userId: userWithMfaId },
      });
      expect(credential!.hashedBackupCodes.length).toBe(7);

      // Attempting to use the code a third time must fail
      const loginRes2 = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: mfaEmail, password: testUser.password });
      const tempToken2 = loginRes2.body.data.tempToken;

      const reuseRes = await request(app)
        .post('/api/v1/auth/mfa/challenge')
        .send({ tempToken: tempToken2, code: codeToUse });

      expect(reuseRes.status).toBe(401);
    });
  });

  describe('3. JWT & Active Server-Side Session Validation', () => {
    it('should immediately reject unexpired access token if user status is set to SUSPENDED', async () => {
      // Obtain fresh access token
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const activeAccessToken = loginRes.body.data.tokens.accessToken;

      // Verify access works while ACTIVE
      const activeRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeAccessToken}`);
      expect(activeRes.status).toBe(200);

      // Simulate administrative suspension of the user
      await prisma.user.update({
        where: { id: registeredUserId },
        data: { status: UserStatus.SUSPENDED },
      });

      // Immediately attempt request with the same unexpired JWT
      const suspendedRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeAccessToken}`);

      // Must be immediately rejected without waiting for the 15-minute JWT expiration!
      expect(suspendedRes.status).toBe(401);
      expect(suspendedRes.body.detail).toContain('suspended');

      // Restore user status to ACTIVE
      await prisma.user.update({
        where: { id: registeredUserId },
        data: { status: UserStatus.ACTIVE },
      });

      // Request now succeeds again
      const restoredRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeAccessToken}`);
      expect(restoredRes.status).toBe(200);
    });
  });

  describe('4. MFA Bypass Prevention on Pre-Existing Sessions', () => {
    it('should revoke pre-existing refresh sessions when MFA is verified and activated', async () => {
      const bypassEmail = `mfa_bypass_${testRunId}@example.com`;
      const bypassPhone = `+9196${Math.floor(10000000 + Math.random() * 90000000)}`;

      // 1. Register user
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: bypassEmail,
          phone: bypassPhone,
          password: testUser.password,
          fullName: 'Bypass Test User',
        });
      const userId = regRes.body.data.user.id;
      const preMfaRefreshToken = regRes.body.data.tokens.refreshToken;
      const accessToken = regRes.body.data.tokens.accessToken;

      // 2. User activates MFA
      const enrollRes = await request(app)
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: testUser.password });

      const { authenticator } = await import('otplib');
      const totpCode = authenticator.generate(enrollRes.body.data.secret);

      await request(app)
        .post('/api/v1/auth/mfa/verify-enrollment')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ totpCode });

      // 3. Attempt to refresh using the pre-MFA refresh token
      const bypassAttempt = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: preMfaRefreshToken });

      // Pre-existing session must be invalidated!
      expect(bypassAttempt.status).toBe(401);

      // Clean up
      await prisma.auditLog.deleteMany({ where: { actorId: userId } });
      await prisma.refreshSession.deleteMany({ where: { userId } });
      await prisma.userMfaCredential.deleteMany({ where: { userId } });
      await prisma.patientProfile.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });
  });

  describe('5. Constant-Time Anti-Enumeration & Status Leakage Prevention', () => {
    it('should return identical 401 error and not leak suspended status on incorrect password', async () => {
      // 1. Non-existent account
      const notFoundRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent_account_12345@example.com', password: 'AnyPassword123!' });

      expect(notFoundRes.status).toBe(401);
      expect(notFoundRes.body.detail).toBe('Invalid email or password');

      // 2. Temporarily suspend test user
      await prisma.user.update({
        where: { id: registeredUserId },
        data: { status: UserStatus.SUSPENDED },
      });

      // 3. Probing with incorrect password against suspended account
      const wrongPasswordRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'WrongPassword999!' });

      // Must return generic 401, NOT reveal 403 Suspended!
      expect(wrongPasswordRes.status).toBe(401);
      expect(wrongPasswordRes.body.detail).toBe('Invalid email or password');

      // 4. Probing with correct password against suspended account -> 403
      const correctPasswordRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      expect(correctPasswordRes.status).toBe(403);
      expect(correctPasswordRes.body.detail).toContain('suspended');

      // Restore user
      await prisma.user.update({
        where: { id: registeredUserId },
        data: { status: UserStatus.ACTIVE },
      });
    });
  });

  describe('6. Authorization & Resource Ownership (ABAC / RBAC)', () => {
    // Create a standalone express mini-app to test authorizeRoles and enforceOwnership thoroughly
    const testApp = express();
    testApp.use(express.json());

    // Protected route requiring DOCTOR role
    testApp.get('/doctor-only', authenticate, authorizeRoles(Role.DOCTOR), (_req: Request, res: Response) => {
      res.json({ message: 'Welcome Doctor' });
    });

    // Protected route with resource ownership check
    testApp.get(
      '/patient-record/:patientId',
      authenticate,
      enforceOwnership((req: Request) => req.params.patientId),
      (_req: Request, res: Response) => {
        res.json({ message: 'Access granted to patient record' });
      }
    );

    // Register RFC 7807 error handler
    testApp.use(errorHandler);

    it('should forbid patient from accessing doctor-only endpoint (RBAC)', async () => {
      const response = await request(testApp)
        .get('/doctor-only')
        .set('Authorization', `Bearer ${initialAccessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.detail).toContain('Access denied');
    });

    it('should allow patient to access their own resource (ABAC)', async () => {
      const response = await request(testApp)
        .get(`/patient-record/${patientProfileId}`)
        .set('Authorization', `Bearer ${initialAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Access granted to patient record');
    });

    it('should forbid patient from accessing another patient resource (ABAC / IDOR prevention)', async () => {
      const foreignPatientId = '00000000-0000-0000-0000-000000000000';
      const response = await request(testApp)
        .get(`/patient-record/${foreignPatientId}`)
        .set('Authorization', `Bearer ${initialAccessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.detail).toContain('permission');
    });
  });
});
