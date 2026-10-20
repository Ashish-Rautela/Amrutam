import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { app } from '../../src/app.js';
import { prisma, connectDatabase, disconnectDatabase } from '../../src/infrastructure/database/prisma.js';
import { config } from '../../src/config/index.js';
import { Role } from '@prisma/client';

describe('Authentication & Authorization Module (Integration Tests)', () => {
  const timestamp = Date.now();
  const testUser = {
    email: `patient_${timestamp}@example.com`,
    phone: `+9198${String(timestamp).slice(-8)}`,
    password: 'SuperSecurePassword123!',
    fullName: 'Test Patient Sharma',
  };

  let registeredUserId: string;
  let currentAccessToken: string;
  let currentRefreshToken: string;

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    // Clean up test user records
    if (registeredUserId) {
      await prisma.user.deleteMany({
        where: { id: registeredUserId },
      });
    }
    await disconnectDatabase();
  });

  describe('1. Patient Registration (POST /api/v1/auth/register)', () => {
    it('should successfully register a patient and issue initial tokens', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');

      const user = response.body.data.user;
      expect(user.email).toBe(testUser.email.toLowerCase());
      expect(user.phone).toBe(testUser.phone);
      expect(user.role).toBe(Role.PATIENT);
      expect(user).toHaveProperty('patientProfileId');

      // CRITICAL: Ensure password hash and secrets are NEVER returned
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('mfaSecret');
      expect(user).not.toHaveProperty('mfaBackupCodes');

      const tokens = response.body.data.tokens;
      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens.expiresIn).toBe(900);

      registeredUserId = user.id;
      currentAccessToken = tokens.accessToken;
      currentRefreshToken = tokens.refreshToken;
    });

    it('should reject duplicate registration with the same email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...testUser,
          phone: `+9197${String(Date.now()).slice(-8)}`, // different phone
        });

      expect(response.status).toBe(409);
      expect(response.body.title).toBe('CONFLICT');
      expect(response.body.detail).toContain('already exists');
    });

    it('should reject duplicate registration with the same phone number', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...testUser,
          email: `different_${Date.now()}@example.com`, // different email
        });

      expect(response.status).toBe(409);
      expect(response.body.title).toBe('CONFLICT');
      expect(response.body.detail).toContain('already exists');
    });

    it('should prevent privilege escalation by ignoring client-supplied role', async () => {
      const hackerTimestamp = Date.now() + 1;
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `hacker_${hackerTimestamp}@example.com`,
          phone: `+9191${String(hackerTimestamp).slice(-8)}`,
          password: 'Password123!',
          fullName: 'Malicious Actor',
          role: 'ADMIN', // Tampered role attempt
        });

      expect(response.status).toBe(201);
      // Ensure role is still strictly PATIENT
      expect(response.body.data.user.role).toBe(Role.PATIENT);

      // Clean up hacker user
      await prisma.user.delete({ where: { id: response.body.data.user.id } });
    });

    it('should reject invalid registration payloads with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid-email-format',
          phone: '123',
          password: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body.title).toBe('BAD_REQUEST');
      expect(response.body).toHaveProperty('details');
    });
  });

  describe('2. User Login (POST /api/v1/auth/login)', () => {
    it('should successfully log in with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email.toUpperCase(), // Test case normalization
          password: testUser.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('mfaRequired', false);
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.user.id).toBe(registeredUserId);

      // Update tokens
      currentAccessToken = response.body.data.tokens.accessToken;
      currentRefreshToken = response.body.data.tokens.refreshToken;
    });

    it('should return identical safe 401 error for non-existent email (anti-enumeration)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'non_existent_random_user_9999@example.com',
          password: 'AnyPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.detail).toBe('Invalid email or password');
    });

    it('should return identical safe 401 error for incorrect password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.detail).toBe('Invalid email or password');
    });
  });

  describe('3. Access Token & Authorization Middleware', () => {
    it('should access protected profile endpoint with valid access token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${currentAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(registeredUserId);
      expect(response.body.data.email).toBe(testUser.email.toLowerCase());
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('should reject requests with missing Authorization header', async () => {
      const response = await request(app).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.detail).toContain('Missing or malformed Authorization header');
    });

    it('should reject requests with malformed Bearer header', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic invalid_token_format');

      expect(response.status).toBe(401);
      expect(response.body.detail).toContain('Bearer token required');
    });

    it('should reject expired access tokens', async () => {
      // Craft an expired JWT signed with same key
      const expiredToken = jwt.sign(
        {
          sub: registeredUserId,
          email: testUser.email,
          role: Role.PATIENT,
        },
        config.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          expiresIn: '-10s', // Expired 10 seconds ago
        }
      );

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.detail).toContain('expired');
    });

    it('should reject tokens with invalid signature or wrong issuer', async () => {
      const forgedToken = jwt.sign(
        { sub: registeredUserId, email: testUser.email, role: Role.PATIENT },
        'wrong_secret_key_that_does_not_match_min_32_characters',
        {
          algorithm: 'HS256',
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        }
      );

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe('4. Refresh Token Rotation & Session Revocation', () => {
    let rotatedAccessToken: string;
    let rotatedRefreshToken: string;

    it('should successfully rotate an active refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: currentRefreshToken });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.refreshToken).not.toBe(currentRefreshToken);

      rotatedAccessToken = response.body.data.accessToken;
      rotatedRefreshToken = response.body.data.refreshToken;

      // New access token works
      const meResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${rotatedAccessToken}`);
      expect(meResponse.status).toBe(200);
    });

    it('REUSE DETECTION: attempting to use old refresh token revokes entire token family', async () => {
      // Submit the old currentRefreshToken which was already rotated
      const reuseResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: currentRefreshToken });

      expect(reuseResponse.status).toBe(401);
      expect(reuseResponse.body.detail).toContain('reuse detected');

      // Now verify that the NEW token in the family was ALSO revoked as a security measure!
      const subsequentResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotatedRefreshToken });

      expect(subsequentResponse.status).toBe(401);
    });

    it('should safely handle concurrent refresh requests (only one succeeds)', async () => {
      // First obtain a fresh token pair by logging in
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const freshRefreshToken = loginRes.body.data.tokens.refreshToken;

      // Fire two concurrent refresh requests simultaneously
      const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/auth/refresh').send({ refreshToken: freshRefreshToken }),
        request(app).post('/api/v1/auth/refresh').send({ refreshToken: freshRefreshToken }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds (200), and the sibling either detects rotation/conflict (401)
      expect(statuses).toEqual([200, 401]);
    });

    it('should revoke session on logout', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const tokenToRevoke = loginRes.body.data.tokens.refreshToken;

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokenToRevoke });

      expect(logoutRes.status).toBe(200);

      // Using the revoked token afterwards fails
      const refreshAfterLogout = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokenToRevoke });

      expect(refreshAfterLogout.status).toBe(401);
    });

    it('should revoke all active sessions on logout-all', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const authHeader = `Bearer ${loginRes.body.data.tokens.accessToken}`;
      const refreshToken = loginRes.body.data.tokens.refreshToken;

      const logoutAllRes = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', authHeader);

      expect(logoutAllRes.status).toBe(200);

      const tryRefresh = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(tryRefresh.status).toBe(401);
    });
  });

  describe('5. Multi-Factor Authentication (MFA) Lifecycle', () => {
    let activeToken: string;
    let mfaSecret: string;
    let backupCodes: string[];

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      activeToken = `Bearer ${loginRes.body.data.tokens.accessToken}`;
    });

    it('should reject MFA enrollment if password re-verification fails', async () => {
      const response = await request(app)
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', activeToken)
        .send({ password: 'WrongPassword!' });

      expect(response.status).toBe(401);
    });

    it('should initiate MFA enrollment with correct password and return secret + 8 backup codes', async () => {
      const response = await request(app)
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', activeToken)
        .send({ password: testUser.password });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('secret');
      expect(response.body.data).toHaveProperty('otpauthUrl');
      expect(response.body.data).toHaveProperty('qrCodeDataUrl');
      expect(response.body.data.backupCodes).toHaveLength(8);

      mfaSecret = response.body.data.secret;
      backupCodes = response.body.data.backupCodes;
    });

    it('should reject invalid 6-digit TOTP code during enrollment verification', async () => {
      const response = await request(app)
        .post('/api/v1/auth/mfa/verify-enrollment')
        .set('Authorization', activeToken)
        .send({ totpCode: '000000' });

      expect(response.status).toBe(400);
    });

    it('should successfully activate MFA with valid TOTP code', async () => {
      const validTotp = authenticator.generate(mfaSecret);

      const response = await request(app)
        .post('/api/v1/auth/mfa/verify-enrollment')
        .set('Authorization', activeToken)
        .send({ totpCode: validTotp });

      expect(response.status).toBe(200);
      expect(response.body.data.message).toContain('successfully activated');

      // Verify user has mfaEnabled = true in database
      const user = await prisma.user.findUnique({ where: { id: registeredUserId } });
      expect(user?.mfaEnabled).toBe(true);
    });

    it('subsequent login requires MFA challenge (tempToken returned)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      expect(response.status).toBe(200);
      expect(response.body.data.mfaRequired).toBe(true);
      expect(response.body.data).toHaveProperty('tempToken');

      // Ensure tempToken cannot access standard authenticated routes
      const tryAccess = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${response.body.data.tempToken}`);

      expect(tryAccess.status).toBe(401);
    });

    it('should complete login using valid 6-digit TOTP code', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const tempToken = loginRes.body.data.tempToken;
      const validTotp = authenticator.generate(mfaSecret);

      const challengeRes = await request(app)
        .post('/api/v1/auth/mfa/challenge')
        .send({ tempToken, code: validTotp });

      expect(challengeRes.status).toBe(200);
      expect(challengeRes.body.data.tokens).toHaveProperty('accessToken');
      expect(challengeRes.body.data.tokens).toHaveProperty('refreshToken');
    });

    it('should complete login using a backup recovery code and make it single-use', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const tempToken = loginRes.body.data.tempToken;
      const codeToUse = backupCodes[0];

      // Use backup code
      const challengeRes = await request(app)
        .post('/api/v1/auth/mfa/challenge')
        .send({ tempToken, code: codeToUse });

      expect(challengeRes.status).toBe(200);
      expect(challengeRes.body.data.tokens).toHaveProperty('accessToken');

      // SINGLE USE VERIFICATION: Try using the exact same backup code again
      const loginRes2 = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const reuseChallengeRes = await request(app)
        .post('/api/v1/auth/mfa/challenge')
        .send({ tempToken: loginRes2.body.data.tempToken, code: codeToUse });

      expect(reuseChallengeRes.status).toBe(401);
      expect(reuseChallengeRes.body.detail).toContain('Invalid');
    });

    it('should successfully disable MFA after password and code verification', async () => {
      // Log in with second backup code to get active token
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const challengeRes = await request(app)
        .post('/api/v1/auth/mfa/challenge')
        .send({ tempToken: loginRes.body.data.tempToken, code: backupCodes[1] });

      const authToken = `Bearer ${challengeRes.body.data.tokens.accessToken}`;
      const validTotp = authenticator.generate(mfaSecret);

      const disableRes = await request(app)
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', authToken)
        .send({ password: testUser.password, code: validTotp });

      expect(disableRes.status).toBe(200);
      expect(disableRes.body.data.message).toContain('disabled');

      // Subsequent login is now direct without MFA challenge
      const directLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      expect(directLogin.status).toBe(200);
      expect(directLogin.body.data.mfaRequired).toBe(false);
      expect(directLogin.body.data.tokens).toHaveProperty('accessToken');
    });
  });
});
