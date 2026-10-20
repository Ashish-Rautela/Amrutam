import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { config } from '../../config/index.js';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  hashToken,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from '../../common/crypto/tokens.js';
import { encryptAesGcm, decryptAesGcm } from '../../common/crypto/cipher.js';
import { logger } from '../../common/observability/logger.js';
import { getRedisClient } from '../../infrastructure/cache/redis.js';

interface RequestContext {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export class AuthService {
  // Pre-computed constant dummy bcrypt hash (work factor 12) to ensure constant-time response on invalid accounts
  private static readonly DUMMY_BCRYPT_HASH =
    '$2a$12$e8nEvG8YmNqXk2B4xU1V.u3bQvTz7Wp6JyKdF9Lz1mR8s2vH4qI6e';
  /**
   * Registers a new patient.
   * Public registration is strictly restricted to the PATIENT role.
   */
  public static async registerPatient(
    data: {
      email: string;
      phone: string;
      password: string;
      fullName: string;
      gender?: string;
      dateOfBirth?: string;
    },
    context?: RequestContext
  ) {
    const normalizedEmail = data.email.trim().toLowerCase();
    const normalizedPhone = data.phone.trim();

    // Check existing user to avoid unhandled database unique constraint errors
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: normalizedPhone }],
      },
    });

    if (existing) {
      throw new ConflictError('An account with this email address or phone number already exists');
    }

    const passwordHash = await hashPassword(data.password);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          role: Role.PATIENT,
          status: UserStatus.ACTIVE,
          mfaEnabled: false,
        },
      });

      const patientProfile = await tx.patientProfile.create({
        data: {
          userId: user.id,
          fullName: data.fullName.trim(),
          gender: data.gender,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        },
      });

      // Record audit log
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: Role.PATIENT,
          action: 'USER_REGISTERED',
          resourceType: 'USER',
          resourceId: user.id,
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      // Issue initial access and refresh tokens
      const session = await this.createRefreshSession(tx, user.id, context);
      const accessToken = this.generateAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
        patientProfileId: patientProfile.id,
      });

      logger.info({
        msg: 'New patient registered successfully',
        userId: user.id,
        correlationId: context?.correlationId,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          fullName: patientProfile.fullName,
          patientProfileId: patientProfile.id,
        },
        tokens: {
          accessToken,
          refreshToken: session.rawRefreshToken,
          expiresIn: 900,
        },
      };
    });
  }

  /**
   * Authenticates a user with email and password.
   * If MFA is enabled, returns a short-lived temporary challenge token.
   */
  public static async login(
    email: string,
    passwordPlain: string,
    context?: RequestContext
  ) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        patientProfile: true,
        doctorProfile: true,
        mfaCredential: true,
      },
    });

    // Constant-time execution: always perform a bcrypt comparison regardless of whether user exists
    const passwordHashToCompare = user ? user.passwordHash : this.DUMMY_BCRYPT_HASH;
    const isPasswordValid = await verifyPassword(passwordPlain, passwordHashToCompare);

    if (!user || !isPasswordValid) {
      if (user) {
        await prisma.auditLog.create({
          data: {
            actorId: user.id,
            actorRole: user.role,
            action: 'LOGIN_FAILED',
            resourceType: 'AUTH',
            ipAddress: context?.ip,
            userAgent: context?.userAgent,
            correlationId: context?.correlationId,
          },
        });
      }
      throw new UnauthorizedError('Invalid email or password');
    }

    // Account status check is performed ONLY after password is validated
    // This prevents status enumeration (discovering whether an unknown email exists and is suspended)
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenError('Your account has been suspended. Please contact customer support.');
    }

    // Handle Multi-Factor Authentication
    if (user.mfaEnabled && user.mfaCredential?.verified) {
      // Issue a restricted temporary token strictly for the MFA challenge
      const tempToken = jwt.sign(
        {
          sub: user.id,
          purpose: 'MFA_CHALLENGE',
        },
        config.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          expiresIn: '5m',
        }
      );

      return {
        mfaRequired: true,
        tempToken,
        message: 'Multi-factor authentication required. Please provide your TOTP code or backup code.',
      };
    }

    // Direct login: create session and issue tokens
    const session = await this.createRefreshSession(prisma, user.id, context);
    const accessToken = this.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      patientProfileId: user.patientProfile?.id,
      doctorProfileId: user.doctorProfile?.id,
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        action: 'LOGIN_SUCCESS',
        resourceType: 'AUTH',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        correlationId: context?.correlationId,
      },
    });

    return {
      mfaRequired: false,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        patientProfileId: user.patientProfile?.id,
        doctorProfileId: user.doctorProfile?.id,
      },
      tokens: {
        accessToken,
        refreshToken: session.rawRefreshToken,
        expiresIn: 900,
      },
    };
  }

  /**
   * Completes login by verifying TOTP code or single-use backup recovery code.
   */
  public static async verifyMfaChallenge(
    tempToken: string,
    code: string,
    context?: RequestContext
  ) {
    let payload: { sub: string; purpose: string };
    try {
      payload = jwt.verify(tempToken, config.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }) as { sub: string; purpose: string };
    } catch {
      throw new UnauthorizedError('Invalid or expired MFA session token');
    }

    if (payload.purpose !== 'MFA_CHALLENGE') {
      throw new UnauthorizedError('Invalid token purpose for MFA verification');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        mfaCredential: true,
        patientProfile: true,
        doctorProfile: true,
      },
    });

    if (!user || !user.mfaEnabled || !user.mfaCredential || !user.mfaCredential.verified) {
      throw new UnauthorizedError('MFA is not configured for this account');
    }

    const cleanCode = code.trim().toUpperCase();

    // Concurrency-safe execution: Acquire row-level lock on user_mfa_credentials
    return prisma.$transaction(async (tx) => {
      const credentials = await tx.$queryRaw<
        Array<{
          id: string;
          user_id: string;
          encrypted_totp_secret: string;
          iv: string;
          auth_tag: string;
          hashed_backup_codes: string[];
          verified: boolean;
        }>
      >`
        SELECT id, user_id, encrypted_totp_secret, iv, auth_tag, hashed_backup_codes, verified
        FROM "user_mfa_credentials"
        WHERE "user_id" = ${payload.sub}
        FOR UPDATE
      `;

      if (credentials.length === 0 || !credentials[0].verified) {
        throw new UnauthorizedError('MFA is not configured for this account');
      }

      const cred = credentials[0];
      const user = await tx.user.findUnique({
        where: { id: payload.sub },
        include: { patientProfile: true, doctorProfile: true },
      });

      if (!user || user.status !== UserStatus.ACTIVE || !user.mfaEnabled) {
        throw new UnauthorizedError('MFA is not configured or user account is inactive');
      }

      let isTotpValid = false;

      // 1. Try TOTP code verification if 6 digits
      if (/^\d{6}$/.test(cleanCode)) {
        try {
          const decryptedSecret = decryptAesGcm(
            cred.encrypted_totp_secret,
            cred.iv,
            cred.auth_tag,
            config.DATA_ENCRYPTION_KEY
          );
          isTotpValid = authenticator.check(cleanCode, decryptedSecret);

          if (isTotpValid) {
            // TOTP replay protection via Redis cache (if Redis is connected)
            const redis = getRedisClient();
            if (redis.status === 'ready') {
              const replayKey = `mfa:totp:replay:${user.id}:${cleanCode}`;
              const claimed = await redis.set(replayKey, '1', 'EX', 60, 'NX');
              if (!claimed) {
                throw new UnauthorizedError('TOTP verification code has already been used. Please wait for the next token.');
              }
            }
          }
        } catch (err: any) {
          if (err instanceof UnauthorizedError) throw err;
          logger.error({ msg: 'Failed to decrypt TOTP secret during verification', error: err.message });
        }
      }

      // 2. If TOTP failed or format is backup code, check single-use backup codes under exclusive row lock
      let usedBackupCodeIndex = -1;
      if (!isTotpValid && cred.hashed_backup_codes && cred.hashed_backup_codes.length > 0) {
        for (let i = 0; i < cred.hashed_backup_codes.length; i++) {
          const matches = await verifyBackupCode(cleanCode, cred.hashed_backup_codes[i]);
          if (matches) {
            usedBackupCodeIndex = i;
            break;
          }
        }
      }

      if (!isTotpValid && usedBackupCodeIndex === -1) {
        throw new UnauthorizedError('Invalid multi-factor authentication code or backup recovery code');
      }

      // Atomically consume single-use backup code
      if (usedBackupCodeIndex !== -1) {
        const updatedBackupCodes = [...cred.hashed_backup_codes];
        updatedBackupCodes.splice(usedBackupCodeIndex, 1);

        await tx.userMfaCredential.update({
          where: { userId: user.id },
          data: {
            hashedBackupCodes: updatedBackupCodes,
            lastUsedAt: new Date(),
          },
        });

        logger.info({ msg: 'Single-use backup recovery code consumed', userId: user.id });
      } else {
        await tx.userMfaCredential.update({
          where: { userId: user.id },
          data: { lastUsedAt: new Date() },
        });
      }

      const session = await this.createRefreshSession(tx, user.id, context);
      const accessToken = this.generateAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
        patientProfileId: user.patientProfile?.id,
        doctorProfileId: user.doctorProfile?.id,
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'MFA_CHALLENGE_VERIFIED',
          resourceType: 'AUTH',
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          correlationId: context?.correlationId,
        },
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          patientProfileId: user.patientProfile?.id,
          doctorProfileId: user.doctorProfile?.id,
        },
        tokens: {
          accessToken,
          refreshToken: session.rawRefreshToken,
          expiresIn: 900,
        },
      };
    });
  }

  /**
   * Initiates MFA enrollment by generating a TOTP secret and backup codes.
   * Requires password re-verification.
   */
  public static async enrollMfa(userId: string, currentPasswordPlain: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundError('User not found');

    const isPasswordValid = await verifyPassword(currentPasswordPlain, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Current password re-verification failed');
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'Amrutam Telemedicine', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Encrypt secret with AES-256-GCM
    const encrypted = encryptAesGcm(secret, config.DATA_ENCRYPTION_KEY);

    // Generate and hash 8 single-use backup recovery codes
    const plainBackupCodes = generateBackupCodes(8);
    const hashedBackupCodes = await Promise.all(
      plainBackupCodes.map((code) => hashBackupCode(code))
    );

    // Upsert unverified credential record
    await prisma.userMfaCredential.upsert({
      where: { userId },
      create: {
        userId,
        encryptedTotpSecret: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        hashedBackupCodes,
        verified: false,
      },
      update: {
        encryptedTotpSecret: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        hashedBackupCodes,
        verified: false,
      },
    });

    return {
      secret,
      otpauthUrl,
      qrCodeDataUrl,
      backupCodes: plainBackupCodes,
      instructions:
        'Save these single-use recovery codes in a secure location. They will not be displayed again.',
    };
  }

  /**
   * Verifies enrollment and officially enables MFA on the user account.
   */
  public static async verifyMfaEnrollment(userId: string, totpCode: string) {
    const credential = await prisma.userMfaCredential.findUnique({
      where: { userId },
    });

    if (!credential) {
      throw new BadRequestError('MFA enrollment has not been initiated for this account');
    }

    let isValid = false;
    try {
      const decryptedSecret = decryptAesGcm(
        credential.encryptedTotpSecret,
        credential.iv,
        credential.authTag,
        config.DATA_ENCRYPTION_KEY
      );
      isValid = authenticator.check(totpCode.trim(), decryptedSecret);
    } catch (err: any) {
      logger.error({ msg: 'Error decrypting secret during enrollment verification', error: err.message });
    }

    if (!isValid) {
      throw new BadRequestError('Invalid 6-digit TOTP verification code');
    }

    await prisma.$transaction(async (tx) => {
      await tx.userMfaCredential.update({
        where: { userId },
        data: {
          verified: true,
          lastUsedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      });

      // Security measure: Invalidate all existing refresh sessions created before MFA was enabled
      // This prevents an attacker or stale client from bypassing MFA using a pre-existing refresh token
      await tx.refreshSession.updateMany({
        where: { userId, revoked: false },
        data: {
          revoked: true,
          revokedAt: new Date(),
          revocationReason: 'MFA_ACTIVATED',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'MFA_ENABLED',
          resourceType: 'USER',
          resourceId: userId,
        },
      });
    });

    return { message: 'Multi-factor authentication has been successfully activated.' };
  }

  /**
   * Disables MFA on a user account after password and code verification.
   */
  public static async disableMfa(
    userId: string,
    currentPasswordPlain: string,
    code: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { mfaCredential: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaCredential) {
      throw new BadRequestError('MFA is not currently enabled for this account');
    }

    const isPasswordValid = await verifyPassword(currentPasswordPlain, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Current password re-verification failed');
    }

    const cleanCode = code.trim().toUpperCase();
    let isCodeValid = false;

    // Check TOTP
    if (/^\d{6}$/.test(cleanCode)) {
      try {
        const decryptedSecret = decryptAesGcm(
          user.mfaCredential.encryptedTotpSecret,
          user.mfaCredential.iv,
          user.mfaCredential.authTag,
          config.DATA_ENCRYPTION_KEY
        );
        isCodeValid = authenticator.check(cleanCode, decryptedSecret);
      } catch {
        // ignore
      }
    }

    // Check backup code if TOTP failed
    if (!isCodeValid) {
      for (const hashed of user.mfaCredential.hashedBackupCodes) {
        if (await verifyBackupCode(cleanCode, hashed)) {
          isCodeValid = true;
          break;
        }
      }
    }

    if (!isCodeValid) {
      throw new UnauthorizedError('Invalid TOTP or backup recovery code');
    }

    await prisma.$transaction(async (tx) => {
      await tx.userMfaCredential.delete({
        where: { userId },
      });

      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: false },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'MFA_DISABLED',
          resourceType: 'USER',
          resourceId: userId,
        },
      });
    });

    return { message: 'Multi-factor authentication has been disabled.' };
  }

  /**
   * Atomically rotates a refresh token using row-level locking.
   * If token reuse is detected, revokes the entire token family immediately
   * in a committed transaction so rollback can never undo the security revocation.
   */
  public static async rotateRefreshToken(rawRefreshToken: string, context?: RequestContext) {
    const tokenHash = hashToken(rawRefreshToken);

    let reuseDetectedFamilyId: string | null = null;
    let reuseDetectedUserId: string | null = null;
    let reuseDetectedSessionId: string | null = null;

    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Acquire exclusive row lock on the refresh session in PostgreSQL
        const sessions = await tx.$queryRaw<
          Array<{
            id: string;
            user_id: string;
            token_hash: string;
            family_id: string;
            replaced_by_token_hash: string | null;
            revoked: boolean;
            revoked_at: Date | null;
            revocation_reason: string | null;
            expires_at: Date;
          }>
        >`
          SELECT id, user_id, token_hash, family_id, replaced_by_token_hash, revoked, revoked_at, revocation_reason, expires_at
          FROM "refresh_sessions"
          WHERE "token_hash" = ${tokenHash}
          FOR UPDATE
        `;

        if (sessions.length === 0) {
          throw new UnauthorizedError('Invalid refresh token');
        }

        const session = sessions[0];

        // 2. REUSE DETECTION: If token is already revoked, capture familyId to revoke outside tx
        if (session.revoked) {
          reuseDetectedFamilyId = session.family_id;
          reuseDetectedUserId = session.user_id;
          reuseDetectedSessionId = session.id;
          throw new Error('TOKEN_REUSE_DETECTED');
        }

        // 3. Expiration check
        if (new Date(session.expires_at) < new Date()) {
          await tx.refreshSession.update({
            where: { id: session.id },
            data: {
              revoked: true,
              revokedAt: new Date(),
              revocationReason: 'EXPIRED',
            },
          });
          throw new UnauthorizedError('Refresh token has expired. Please log in again.');
        }

        // 4. Generate new replacement token inheriting the same familyId
        const newRawToken = generateOpaqueToken(40);
        const newHash = hashToken(newRawToken);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // 5. Invalidate current token and link replacement
        await tx.refreshSession.update({
          where: { id: session.id },
          data: {
            revoked: true,
            revokedAt: new Date(),
            replacedByTokenHash: newHash,
            revocationReason: 'ROTATED',
          },
        });

        // 6. Create new refresh session
        await tx.refreshSession.create({
          data: {
            userId: session.user_id,
            familyId: session.family_id,
            tokenHash: newHash,
            ipAddress: context?.ip,
            userAgent: context?.userAgent,
            expiresAt,
          },
        });

        // 7. Fetch active user details for access token
        const user = await tx.user.findUnique({
          where: { id: session.user_id },
          include: { patientProfile: true, doctorProfile: true },
        });

        if (!user || user.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedError('User account is suspended or inactive');
        }

        const accessToken = this.generateAccessToken({
          id: user.id,
          email: user.email,
          role: user.role,
          patientProfileId: user.patientProfile?.id,
          doctorProfileId: user.doctorProfile?.id,
        });

        return {
          accessToken,
          refreshToken: newRawToken,
          expiresIn: 900,
        };
      });
    } catch (err: any) {
      if (err.message === 'TOKEN_REUSE_DETECTED' && reuseDetectedFamilyId) {
        logger.warn({
          msg: 'CRITICAL: Refresh token reuse detected! Revoking entire token family.',
          familyId: reuseDetectedFamilyId,
          userId: reuseDetectedUserId,
        });

        // Revoke all sessions sharing this familyId in a standalone committed operation
        // This ensures the revocation is NEVER rolled back!
        await prisma.refreshSession.updateMany({
          where: { familyId: reuseDetectedFamilyId },
          data: {
            revoked: true,
            revokedAt: new Date(),
            revocationReason: 'REUSE_ATTACK_DETECTED',
          },
        });

        await prisma.auditLog.create({
          data: {
            actorId: reuseDetectedUserId,
            action: 'TOKEN_REUSE_DETECTED',
            resourceType: 'SESSION',
            resourceId: reuseDetectedSessionId,
            ipAddress: context?.ip,
            userAgent: context?.userAgent,
            correlationId: context?.correlationId,
          },
        });

        throw new UnauthorizedError(
          'Invalid refresh token: token reuse detected. All sessions in this token family have been revoked for your security.'
        );
      }
      throw err;
    }
  }

  /**
   * Revokes a single refresh token session (logout).
   */
  public static async logout(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);

    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash },
    });

    if (session && !session.revoked) {
      await prisma.refreshSession.update({
        where: { id: session.id },
        data: {
          revoked: true,
          revokedAt: new Date(),
          revocationReason: 'LOGOUT',
        },
      });
    }

    return { message: 'Logged out successfully.' };
  }

  /**
   * Revokes all active refresh sessions for a user (logout all devices).
   */
  public static async logoutAll(userId: string) {
    await prisma.refreshSession.updateMany({
      where: {
        userId,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revocationReason: 'LOGOUT_ALL',
      },
    });

    return { message: 'All active sessions have been revoked.' };
  }

  /**
   * Returns current user identity without exposing any secrets or hashes.
   */
  public static async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        mfaEnabled: true,
        createdAt: true,
        patientProfile: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
            bloodGroup: true,
          },
        },
        doctorProfile: {
          select: {
            id: true,
            fullName: true,
            licenseNumber: true,
            specializations: true,
            verificationStatus: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  /**
   * Helper to generate a short-lived, strictly signed JWT access token.
   */
  private static generateAccessToken(user: {
    id: string;
    email: string;
    role: Role;
    patientProfileId?: string;
    doctorProfileId?: string;
  }): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        patientProfileId: user.patientProfileId,
        doctorProfileId: user.doctorProfileId,
      },
      config.JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        expiresIn: '15m',
      }
    );
  }

  /**
   * Helper to create a new refresh session with a new token family.
   */
  private static async createRefreshSession(
    db: any,
    userId: string,
    context?: RequestContext
  ): Promise<{ rawRefreshToken: string; session: any }> {
    const rawRefreshToken = generateOpaqueToken(40);
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const session = await db.refreshSession.create({
      data: {
        userId,
        tokenHash,
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        expiresAt,
      },
    });

    return { rawRefreshToken, session };
  }
}
