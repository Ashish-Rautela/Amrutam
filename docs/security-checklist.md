# Production Security Checklist & Compliance Verification

| Check Item | Status | Verification Detail |
|---|---|---|
| **Secret Management & Startup Validation** | Verified | Zero hardcoded secrets in `compose.yaml`. Zod environment validator blocks process startup if secrets are missing, < 32 chars, or matching placeholder strings. |
| **Authentication & Password Storage** | Verified | Salted hashing using Bcrypt (work factor 12 via `bcryptjs`). Constant-time comparison on invalid lookups prevents timing enumeration. No plaintext passwords stored. |
| **Multi-Factor Authentication (MFA)** | Verified | Isolated `UserMfaCredential` model. TOTP secrets encrypted with AES-256-GCM. Backup codes stored as one-way cryptographic hashes. |
| **Token Lifecycle & Revocation** | Verified | 15-minute JWT access tokens. Refresh tokens tracked in database with instant single-session or all-session revocation. |
| **Broken Object-Level Auth (BOLA / IDOR)** | Verified | ABAC middleware verifies resource ownership on consultations, prescriptions, and medical records before DB dispatch. |
| **Database Concurrency & Non-Overlap** | Verified | PostgreSQL `btree_gist` exclusion constraint prevents overlapping doctor intervals. Pessimistic row locking (`SELECT FOR UPDATE`) prevents double bookings. |
| **Scoped Idempotency Control** | Verified | `IdempotencyRecord` scoped by `(scope, operation, key)`. `PENDING_CLAIM` rejects concurrent duplicate requests with 409 Conflict. |
| **Explicit Telemedicine Consent** | Verified | `consentRecorded` strictly defaults to `false`. Explicit `ConsultationConsent` model records timestamp, legal version (`TPG_2020_V1`), IP address, and patient grant. |
| **Payment Webhook Verification** | Verified | Webhooks enter `RECEIVED` state with `signatureValid` unasserted and `processedAt = null`. Verified using constant-time HMAC check (`crypto.timingSafeEqual`) before transitioning to `PROCESSED`. |
| **SQL Injection Prevention** | Verified | 100% parameterized queries via Prisma ORM and tagged template literals. |
| **Audit Trails & Non-Repudiation** | Verified | Append-only `audit_logs` records security events, auth failures, and clinical state transitions. |
| **Docker Security** | Verified | Multi-stage Docker build running under a non-root unprivileged system user (`appuser`). |
