import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { config } from '../../config/index.js';
import { UnauthorizedError, ForbiddenError } from '../errors/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  patientProfileId?: string;
  doctorProfileId?: string;
}

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: Role;
  patientProfileId?: string;
  doctorProfileId?: string;
  iss: string;
  aud: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Authentication middleware: Validates the JWT Bearer access token.
 * Strictly verifies algorithm (HS256), issuer, audience, expiration,
 * and confirms active server-side user status and authoritative role.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header. Bearer token required.'));
  }

  const token = authHeader.split(' ')[1];
  if (!token || token.trim().length === 0) {
    return next(new UnauthorizedError('Token not provided in Authorization header'));
  }

  let decoded: JwtTokenPayload;
  try {
    decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }) as JwtTokenPayload;

    if (!decoded.sub || !decoded.email || !decoded.role) {
      return next(new UnauthorizedError('Invalid access token payload: missing required claims'));
    }
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new UnauthorizedError('Access token has expired'));
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new UnauthorizedError(`Invalid access token: ${error.message}`));
    }
    return next(new UnauthorizedError('Authentication failed'));
  }

  // Server-side authoritative validation: ensure user exists and is ACTIVE
  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        patientProfile: { select: { id: true } },
        doctorProfile: { select: { id: true } },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      return next(
        new UnauthorizedError(
          user && user.status === UserStatus.SUSPENDED
            ? 'Account has been suspended'
            : 'User account is inactive or no longer exists'
        )
      );
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role, // Authoritative server-side role
      patientProfileId: user.patientProfile?.id,
      doctorProfileId: user.doctorProfile?.id,
    };

    next();
  } catch (dbError: any) {
    return next(dbError);
  }
}

/**
 * Role-Based Access Control (RBAC) middleware.
 * Verifies that the authenticated user possesses one of the permitted roles.
 */
export function authorizeRoles(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access denied: Current role [${req.user.role}] is not authorized for this operation. Requires one of [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
}

/**
 * Reusable Attribute-Based Access Control (ABAC) resource ownership validator.
 */
export function enforceOwnership(
  getOwnerId: (req: Request) => string | undefined | Promise<string | undefined>
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        return next(new UnauthorizedError('Authentication required'));
      }

      // Administrators bypass resource ownership with audited access
      if (req.user.role === Role.ADMIN) {
        return next();
      }

      const ownerId = await getOwnerId(req);
      const userId = req.user.id;
      const patientProfileId = req.user.patientProfileId;
      const doctorProfileId = req.user.doctorProfileId;

      if (ownerId && (ownerId === userId || ownerId === patientProfileId || ownerId === doctorProfileId)) {
        return next();
      }

      return next(new ForbiddenError('You do not have permission to access or modify this resource'));
    } catch (err) {
      return next(err);
    }
  };
}
