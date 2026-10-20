import { describe, it, expect } from 'vitest';
import { validateConfig, isSecureSecret } from '../../src/config/index.js';

describe('Configuration Validation (Unit Tests)', () => {
  const baseValidEnv = {
    NODE_ENV: 'test',
    PORT: '4000',
    APP_NAME: 'amrutam-test',
    API_PREFIX: '/api/v1',
    CORS_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test_db?schema=public',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_ACCESS_SECRET: '0123456789abcdef0123456789abcdef_valid_access_secret',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_SECRET: '0123456789abcdef0123456789abcdef_valid_refresh_secret',
    JWT_REFRESH_EXPIRY: '7d',
    DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    PAYMENT_GATEWAY_PROVIDER: 'MOCK',
    TELEHEALTH_PROVIDER: 'MOCK',
    TELEHEALTH_SECRET: 'mock_telehealth_signing_secret_min_32_chars',
    LOG_LEVEL: 'warn',
  };

  it('should successfully validate a well-formed environment configuration', () => {
    const config = validateConfig(baseValidEnv);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(4000);
    expect(config.REDIS_PORT).toBe(6379);
    expect(config.API_PREFIX).toBe('/api/v1');
    expect(config.DATA_ENCRYPTION_KEY).toBe(baseValidEnv.DATA_ENCRYPTION_KEY);
  });

  it('should reject invalid PORT values out of range', () => {
    expect(() => validateConfig({ ...baseValidEnv, PORT: '0' })).toThrow(/PORT must be >= 1/);
    expect(() => validateConfig({ ...baseValidEnv, PORT: '70000' })).toThrow(/PORT must be <= 65535/);
    expect(() => validateConfig({ ...baseValidEnv, PORT: 'invalid' })).toThrow();
  });

  it('should reject invalid REDIS_PORT values', () => {
    expect(() => validateConfig({ ...baseValidEnv, REDIS_PORT: '-5' })).toThrow(/REDIS_PORT must be >= 1/);
    expect(() => validateConfig({ ...baseValidEnv, REDIS_PORT: '99999' })).toThrow(/REDIS_PORT must be <= 65535/);
  });

  it('should reject invalid DATABASE_URL schemes', () => {
    expect(() =>
      validateConfig({ ...baseValidEnv, DATABASE_URL: 'mysql://root:password@localhost:3306/db' })
    ).toThrow(/DATABASE_URL must be a valid PostgreSQL connection string/);
    expect(() =>
      validateConfig({ ...baseValidEnv, DATABASE_URL: 'mongodb://localhost:27017' })
    ).toThrow(/DATABASE_URL must be a valid PostgreSQL connection string/);
  });

  it('should reject API_PREFIX that does not begin with /', () => {
    expect(() => validateConfig({ ...baseValidEnv, API_PREFIX: 'api/v1' })).toThrow(
      /API_PREFIX must start with a forward slash/
    );
  });

  it('should reject short JWT secrets (< 32 chars)', () => {
    expect(() => validateConfig({ ...baseValidEnv, JWT_ACCESS_SECRET: 'short_secret' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters/
    );
    expect(() => validateConfig({ ...baseValidEnv, JWT_REFRESH_SECRET: 'short_refresh' })).toThrow(
      /JWT_REFRESH_SECRET must be at least 32 characters/
    );
  });

  it('should reject DATA_ENCRYPTION_KEY if not exactly 64 hexadecimal characters', () => {
    // 63 characters
    expect(() =>
      validateConfig({
        ...baseValidEnv,
        DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde',
      })
    ).toThrow(/DATA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters/);

    // 64 characters but non-hex (contains 'z')
    expect(() =>
      validateConfig({
        ...baseValidEnv,
        DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdz',
      })
    ).toThrow(/DATA_ENCRYPTION_KEY must contain only hexadecimal characters/);
  });

  it('should require Razorpay credentials when PAYMENT_GATEWAY_PROVIDER is RAZORPAY', () => {
    expect(() =>
      validateConfig({
        ...baseValidEnv,
        PAYMENT_GATEWAY_PROVIDER: 'RAZORPAY',
        RAZORPAY_KEY_ID: '',
      })
    ).toThrow(/RAZORPAY_KEY_ID is required/);

    expect(() =>
      validateConfig({
        ...baseValidEnv,
        PAYMENT_GATEWAY_PROVIDER: 'RAZORPAY',
        RAZORPAY_KEY_ID: 'rzp_test_123',
        RAZORPAY_KEY_SECRET: '',
      })
    ).toThrow(/RAZORPAY_KEY_SECRET is required/);

    expect(() =>
      validateConfig({
        ...baseValidEnv,
        PAYMENT_GATEWAY_PROVIDER: 'RAZORPAY',
        RAZORPAY_KEY_ID: 'rzp_test_123',
        RAZORPAY_KEY_SECRET: 'secret123',
        RAZORPAY_WEBHOOK_SECRET: '',
      })
    ).toThrow(/RAZORPAY_WEBHOOK_SECRET is required/);

    // Should succeed with all 3 provided
    const validRazorpay = validateConfig({
      ...baseValidEnv,
      PAYMENT_GATEWAY_PROVIDER: 'RAZORPAY',
      RAZORPAY_KEY_ID: 'rzp_test_123',
      RAZORPAY_KEY_SECRET: 'secret123',
      RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
    });
    expect(validRazorpay.PAYMENT_GATEWAY_PROVIDER).toBe('RAZORPAY');
  });

  describe('Production Security Guardrails', () => {
    const prodBase = {
      ...baseValidEnv,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8',
      JWT_REFRESH_SECRET: 'f1e2d3c4b5a69788a1b2c3d4e5f6789a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
      CORS_ORIGIN: 'https://amrutam.co.in',
    };

    it('should allow valid production configuration', () => {
      const config = validateConfig(prodBase);
      expect(config.NODE_ENV).toBe('production');
      expect(config.CORS_ORIGIN).toBe('https://amrutam.co.in');
    });

    it('should reject development placeholder JWT secrets in production', () => {
      expect(() =>
        validateConfig({
          ...prodBase,
          JWT_ACCESS_SECRET: 'amrutam_super_secure_access_token_secret_placeholder',
        })
      ).toThrow(/In production, JWT_ACCESS_SECRET must be a cryptographically random secret/);

      expect(() =>
        validateConfig({
          ...prodBase,
          JWT_REFRESH_SECRET: 'default_password_secret_key_placeholder_value_32',
        })
      ).toThrow(/In production, JWT_REFRESH_SECRET must be a cryptographically random secret/);
    });

    it('should reject wildcard CORS (*) in production unless explicitly permitted', () => {
      expect(() =>
        validateConfig({
          ...prodBase,
          CORS_ORIGIN: '*',
        })
      ).toThrow(/Wildcard CORS_ORIGIN \(\*\) is strictly disallowed in production/);

      // Should be allowed if explicitly overridden with deliberate flag
      const allowedOverride = validateConfig({
        ...prodBase,
        CORS_ORIGIN: '*',
        ALLOW_INSECURE_WILDCARD_CORS: 'true',
      });
      expect(allowedOverride.CORS_ORIGIN).toBe('*');
    });
  });

  describe('isSecureSecret helper', () => {
    it('should detect insecure and short secrets accurately', () => {
      expect(isSecureSecret('short')).toBe(false);
      expect(isSecureSecret('contains_default_in_this_very_long_secret_string')).toBe(false);
      expect(isSecureSecret('contains_password_in_this_very_long_secret_string')).toBe(false);
      expect(isSecureSecret('f4a2b91c8e7d6a5c4b3a2918273645e0d1c2b3a4f5e6d7c8b9a0')).toBe(true);
    });
  });
});
