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
  - Idempotency Interceptor
                |
                v
[Domain Modules]
  - Auth & MFA (Argon2id, TOTP RFC 6238, JWT + Refresh Rotation)
  - Doctor & Availability (Schedule Templates, Materialized Slots)
  - Booking Engine (Pessimistic Row Locking, Zero Double-Booking)
  - Consultation Lifecycle (Strict FSM, Video Room Provider)
  - Prescription Engine (Immutable Versioning, Clinical Items)
  - Payment Engine (HMAC Webhook Ingestion, Auto-Reconciliation)
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
1. **Pessimistic Row Locking:** During the booking transaction, the database locks the specific slot:
   ```sql
   SELECT * FROM availability_slots WHERE id = $1 FOR UPDATE;
   ```
2. **Atomic Verification:** If the slot status is not `AVAILABLE`, the transaction rolls back and immediately responds with `409 Conflict`.
3. **Database Exclusion & Unique Constraints:** A conditional unique index on `consultations(slot_id) WHERE status != 'CANCELLED'` ensures the database storage engine rejects any duplicate booking even if an application bug bypasses memory checks.
4. **Idempotency Guard:** Every write request evaluates the `Idempotency-Key` header. Duplicate identical requests return the cached original response without reprocessing; conflicting payloads trigger `409 Conflict`.

## 4. Consultation State Machine
```
[BOOKED] ---> [CONFIRMED] ---> [IN_PROGRESS] ---> [COMPLETED]
   |              |                  |
   v              v                  v
[CANCELLED]   [CANCELLED]        [NO_SHOW]
```
Transitions outside this state chart are rejected with `422 Unprocessable Entity`. Every transition writes an immutable audit record and emits a domain event to the transactional outbox.

## 5. Prescription Immutability & Audit Trail
Prescriptions are append-only. When an amendment is required:
- A new record is created with `version = previous_version + 1`.
- It references `parent_prescription_id`.
- An explicit `amendment_reason` is mandatory.
- The doctor's registration number (NMC) and cryptographic digital signature are attached.
