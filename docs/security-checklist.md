# Production Security Checklist & Compliance Verification

| Check Item | Status | Verification Detail |
|---|---|---|
| **Authentication & Password Storage** | Verified | Salted hashing using Bcrypt/Argon2id. No plaintext passwords stored. |
| **Multi-Factor Authentication (MFA)** | Verified | RFC 6238 TOTP with QR-code generation and single-use recovery codes. Mandatory for Doctor & Admin accounts. |
| **Token Lifecycle & Revocation** | Verified | 15-minute JWT access tokens. Refresh tokens tracked in database with instant single-session or all-session revocation. |
| **Broken Object-Level Auth (BOLA / IDOR)** | Verified | ABAC middleware verifies resource ownership on consultations, prescriptions, and medical records before DB dispatch. |
| **SQL Injection Prevention** | Verified | 100% parameterized queries via Prisma ORM. Raw queries use tagged template literals with bound parameters. |
| **Mass Assignment Protection** | Verified | Strict input validation and sanitization using Zod DTO schemas on all POST/PUT/PATCH endpoints. |
| **Rate Limiting & Anti-Brute Force** | Verified | Sliding window rate limiter applied globally and aggressively configured on `/api/v1/auth/*`. |
| **Security Headers** | Verified | Helmet configured with CSP, HSTS (`max-age=31536000; includeSubDomains`), `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`. |
| **Payment Webhook Verification** | Verified | HMAC-SHA256 signature calculated against raw body buffer and verified with constant-time equality check (`crypto.timingSafeEqual`). |
| **Audit Trails & Non-Repudiation** | Verified | Append-only `audit_logs` records security events, auth failures, and clinical state transitions. |
| **PII & Secret Redaction in Logs** | Verified | Pino logger configured with automatic key redaction for credentials, tokens, and health records. |
| **Docker Security** | Verified | Multi-stage Docker build running under a non-root unprivileged system user (`appuser`). |
