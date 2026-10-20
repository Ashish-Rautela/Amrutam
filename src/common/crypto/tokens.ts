import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Hashes a plaintext password using bcrypt with work factor 12.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * Verifies a plaintext password against a bcrypt hash in constant time.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generates a cryptographically secure, opaque refresh token (40 bytes / 320 bits).
 */
export function generateOpaqueToken(bytes = 40): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Computes a SHA-256 hash of an opaque token for database persistence.
 * Raw refresh tokens are never stored in the database.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generates an array of secure, random single-use backup recovery codes.
 * Format: 8 characters split by hyphen, e.g. "A3F9-2B8C".
 */
export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 Crockford variant without ambiguous 0/O, 1/I

  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let b = 0; b < 8; b++) {
      code += charset[bytes[b] % charset.length];
    }
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }

  return codes;
}

/**
 * Hashes a backup recovery code using bcrypt.
 */
export async function hashBackupCode(code: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(code.trim().toUpperCase(), salt);
}

/**
 * Verifies a provided backup recovery code against a bcrypt hash.
 */
export async function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code.trim().toUpperCase(), hash);
}
