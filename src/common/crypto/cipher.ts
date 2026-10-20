import crypto from 'crypto';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts plaintext using AES-256-GCM with authenticated encryption.
 * @param plaintext Plaintext UTF-8 string to encrypt
 * @param keyHex 64-hex character (32-byte) key
 */
export function encryptAesGcm(plaintext: string, keyHex: string): EncryptedData {
  if (keyHex.length !== 64) {
    throw new Error('Encryption key must be exactly 64 hexadecimal characters (32 bytes)');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypts AES-256-GCM encrypted ciphertext with authentication tag verification.
 * Throws an error if ciphertext or tag was tampered with.
 */
export function decryptAesGcm(
  ciphertext: string,
  ivHex: string,
  authTagHex: string,
  keyHex: string
): string {
  if (keyHex.length !== 64) {
    throw new Error('Encryption key must be exactly 64 hexadecimal characters (32 bytes)');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== 12) {
    throw new Error('IV must be 12 bytes');
  }
  if (authTag.length !== 16) {
    throw new Error('Authentication tag must be 16 bytes');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}
