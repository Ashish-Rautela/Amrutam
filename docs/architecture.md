# Architecture Documentation: Amrutam Telemedicine Backend

## 1. System Overview
The Amrutam Telemedicine Backend is a production-grade, highly available, and concurrency-safe backend platform designed to manage the end-to-end lifecycle of telemedicine consultations. It supports 100,000+ daily consultations while adhering to the **Indian Telemedicine Practice Guidelines (2020)** and **Digital Personal Data Protection Act (DPDP 2023)**.

## 2. High-Level Architecture
The platform is organized as a **Modular Monolith** with clear domain separation, transactional ACID boundaries in PostgreSQL, and an asynchronous Transactional Outbox worker for decoupled event handling.

```
[Clients: Patient / Doctor / Admin]
                |
                v  HTTPS / TLS 1.3
[Edge & Express Middleware]
  - Rate Limiter (Redis / Memory)
  - Security Headers (Helmet, CORS)
  - Correlation ID Injector
  - Scoped Idempotency Interceptor (PENDING_CLAIM -> COMPLETED)
                |
                v
[Domain Modules]
  - Auth & Isolated MFA (AES-256-GCM, Argon2id Hashed Backup Codes)
  - Doctor & Availability (Exclusion Constraints, Non-Overlapping Interval Engine)
  - Booking Engine (Pessimistic Row Locking, Zero Double-Booking)
  - Explicit Consent Engine (TPG 2020 / DPDP 2023 Timestamped Consents)
  - Consultation Lifecycle (Strict FSM, Video Room Provider)
  - Prescription Engine (Immutable Versioning, Clinical Items)
  - Payment Engine (HMAC Webhook Ingestion with RECEIVED -> PROCESSED FSM)
  - Search & Discovery (Composite Indexing, Redis Read Caching)
  - Audit Trail (Append-Only Tamper-Evident Store)
  - Administrative Analytics (Optimized Aggregate Metrics)
                |
       +--------+--------+
       |                 |
       v                 v
 [PostgreSQL 16]    [Redis Cache]
 (System of Record) (Read Cache & Sessions)
       |
       | (Transactional Outbox - FOR UPDATE SKIP LOCKED)
       v
 [Asynchronous Worker]
   - Email / SMS Notification Dispatcher
   - Consultation Reminders
   - Stale Payment Sweeper & Auto-Cancellation
```

## 3. Concurrency Control & Double Booking Prevention
To prevent multiple patients from reserving the same doctor slot:
1. **PostgreSQL Exclusion Constraints (btree_gist):**
   ```sql
   ALTER TABLE availability_slots
   ADD CONSTRAINT no_overlapping_doctor_slots
   EXCLUDE USING gist (
     doctor_id WITH =,
     tstzrange(start_time, end_time, '[)') WITH &&
   )
   WHERE (status != 'CANCELLED');
   ```
   This guarantees that overlapping time intervals for the same doctor are physically impossible at the storage engine level.
2. **Pessimistic Row Locking:** During the booking transaction, the database locks the specific slot:
   ```sql
   SELECT * FROM availability_slots WHERE id = $1 FOR UPDATE;
   ```
3. **Atomic Verification:** If the slot status is not `AVAILABLE`, the transaction rolls back and immediately responds with `409 Conflict`.
4. **Conditional Unique Index on Bookings:** `CREATE UNIQUE INDEX uniq_active_slot_consultation ON consultations(slot_id) WHERE status != 'CANCELLED';`
5. **Scoped Idempotency State Machine:** Every write evaluates `IdempotencyRecord` with `@@unique([scope, operation, key])`:
   - State `PENDING_CLAIM`: Concurrent duplicates receive `409 Conflict` (request currently in flight).
   - State `COMPLETED`: Returns cached response with `X-Idempotent-Replay: true`. Payload mismatch triggers `409 Conflict`.

## 4. Consultation State Machine & Explicit Consent
```
[BOOKED] ---> [CONFIRMED] ---> [IN_PROGRESS] ---> [COMPLETED]
   |              |                  |
   v              v                  v
[CANCELLED]   [CANCELLED]        [NO_SHOW]
```
Transitions outside this state chart are rejected with `422 Unprocessable Entity`. Every transition writes an immutable audit record and emits a domain event to the transactional outbox.

**Consent Policy:**
- `consentRecorded` strictly defaults to `false`.
- Every consultation requires an explicit `ConsultationConsent` entity with timestamp, patient ID, IP address, user-agent, and legal text version (`TPG_2020_V1`), satisfying the Indian Telemedicine Practice Guidelines (2020).

## 5. Security & Secret Management
1. **Zero Hardcoded Secrets:** Docker Compose and environment configuration strictly enforce `${VAR:?error}` syntax. The application boots through a Zod validator that halts startup if secrets are missing, too short (< 32 chars), or set to known placeholder strings.
2. **Isolated MFA Storage:** `UserMfaCredential` is segregated from `User`. TOTP secrets are encrypted at rest using AES-256-GCM with separate IV and AuthTag. Backup codes are stored exclusively as salted hashes.
3. **Safe Webhook Ingestion:** Payment webhooks initialize in `RECEIVED` state with `signatureValid` unasserted and `processedAt = null`. Only after cryptographic HMAC verification and transaction completion is the event marked `PROCESSED` with a recorded timestamp.
