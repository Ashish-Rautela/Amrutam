import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  hashToken,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from '../../src/common/crypto/tokens.js';
import { encryptAesGcm, decryptAesGcm } from '../../src/common/crypto/cipher.js';

describe('Cryptographic Utilities (Unit Tests)', () => {
  const testKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  describe('Password Hashing & Verification', () => {
    it('should hash a password and verify it correctly', async () => {
      const password = 'SuperSecurePassword123!';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt hash format

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('WrongPassword123!', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('Opaque Tokens & Hashing', () => {
    it('should generate random opaque tokens and consistent SHA-256 hashes', () => {
      const token1 = generateOpaqueToken(40);
      const token2 = generateOpaqueToken(40);

      expect(token1).toHaveLength(80); // 40 bytes = 80 hex chars
      expect(token2).toHaveLength(80);
      expect(token1).not.toBe(token2);

      const hash1 = hashToken(token1);
      const hash1Repeat = hashToken(token1);
      const hash2 = hashToken(token2);

      expect(hash1).toHaveLength(64); // SHA-256 is 64 hex chars
      expect(hash1).toBe(hash1Repeat);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Backup Recovery Codes', () => {
    it('should generate 8 properly formatted backup recovery codes', () => {
      const codes = generateBackupCodes(8);
      expect(codes).toHaveLength(8);

      for (const code of codes) {
        expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      }
    });

    it('should hash and verify backup codes with case-insensitivity', async () => {
      const code = 'A3F9-2B8C';
      const hash = await hashBackupCode(code);

      expect(await verifyBackupCode(code, hash)).toBe(true);
      expect(await verifyBackupCode('a3f9-2b8c', hash)).toBe(true); // Lowercase check
      expect(await verifyBackupCode('WRONG-CODE', hash)).toBe(false);
    });
  });

  describe('AES-256-GCM Authenticated Encryption & Decryption', () => {
    it('should encrypt and decrypt plaintext accurately', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP'; // Sample Base32 TOTP secret
      const encrypted = encryptAesGcm(plaintext, testKeyHex);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.authTag).toHaveLength(32); // 16 bytes = 32 hex chars

      const decrypted = decryptAesGcm(encrypted.ciphertext, encrypted.iv, encrypted.authTag, testKeyHex);
      expect(decrypted).toBe(plaintext);
    });

    it('should detect tampering in ciphertext or authentication tag', () => {
      const plaintext = 'SensitiveTOTPSecret123';
      const encrypted = encryptAesGcm(plaintext, testKeyHex);

      // Tampered ciphertext (preserve exact hex length)
      const tamperedCiphertext =
        encrypted.ciphertext.slice(0, -2) + (encrypted.ciphertext.endsWith('00') ? 'ff' : '00');

      expect(() =>
        decryptAesGcm(tamperedCiphertext, encrypted.iv, encrypted.authTag, testKeyHex)
      ).toThrow();

      // Tampered auth tag (preserve exact 16-byte hex length)
      const tamperedTag =
        encrypted.authTag.slice(0, -2) + (encrypted.authTag.endsWith('00') ? 'ff' : '00');

      expect(() =>
        decryptAesGcm(encrypted.ciphertext, encrypted.iv, tamperedTag, testKeyHex)
      ).toThrow();

      // Tampered IV
      const tamperedIv =
        encrypted.iv.slice(0, -2) + (encrypted.iv.endsWith('00') ? 'ff' : '00');

      expect(() =>
        decryptAesGcm(encrypted.ciphertext, tamperedIv, encrypted.authTag, testKeyHex)
      ).toThrow();
    });
  });
});
