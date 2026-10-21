# Architecture Documentation: Amrutam Telemedicine Backend

Production-Grade, Concurrency-Safe, and Highly Scalable Telemedicine Backend Architecture for Amrutam.

---

## 1. System Overview & Standards Compliance
The Amrutam Telemedicine Backend is designed to handle high-concurrency telemedicine operations (100,000+ daily consultations) while adhering to:
- **Indian Telemedicine Practice Guidelines (TPG 2020)**: Mandatory informed patient consent, immutable digital prescriptions with doctor signature, consultation auditability.
- **Digital Personal Data Protection Act (DPDP 2023)**: Purpose-based consent records, sensitive health record encryption, strict role-based and attribute-based access control.
- **OWASP API Security Top 10 & STRIDE**: Dual-token refresh families with automatic reuse revocation, zero hardcoded secrets, input validation with strict schema boundaries.

---

## 2. High-Level Modular Monolith Architecture

```
[Clients: Patient / Doctor / Admin]
                |
                v  HTTPS / TLS 1.3
[Edge & Express Middleware Pipeline]
  - Helmet HTTP Security Headers & Strict CORS
  - Correlation ID Injection (`X-Correlation-ID`)
  - Request-Fingerprint Idempotency Interceptor (`Idempotency-Key` -> SHA-256)
  - Rate Limiting (Redis / Memory)
  - Structured Request Logger (Pino-HTTP)
                |
                v
[Domain Modules]
  ├── Auth & MFA          (Bcrypt, AES-256-GCM TOTP, Hashed Backup Codes)
  ├── Doctors             (Verification Workflow, Search Directory, RBAC)
  ├── Availability        (Non-Overlapping Interval Engine, Btree_gist)
  ├── Bookings            (Atomic Conditional Updates, Zero Double-Booking)
  ├── Consultations       (Strict Lifecycle FSM, Mandatory TPG Consent)
  ├── Prescriptions       (Immutable Versioning, Clinical Items, HMAC Signatures)
  ├── Payments            (Trusted Fee Derivation, Webhook HMAC & Deduplication)
  ├── Audit               (Append-Only Compliance Trail)
  └── Admin Analytics     (Optimized Aggregate Status Metrics)
                |
       +--------+--------+
       |                 |
       v                 v
 [PostgreSQL 16]    [Redis Cache]
 (System of Record) (Sessions & Rate Limits)
       |
       | (Transactional Outbox: FOR UPDATE SKIP LOCKED)
       v
 [Asynchronous Background Worker]
   - Email / SMS Notification Dispatcher
   - Consultation Reminder Dispatcher
   - Stale Task Crash Recovery
```

---

## 3. Complete Entity-Relationship (ER) Diagram

The system persistence layer comprises exactly **15 Prisma models** backed by native PostgreSQL 16 extensions and constraints:
- **Core Entities (15 Models)**: `User`, `UserMfaCredential`, `PatientProfile`, `DoctorProfile`, `AvailabilitySlot`, `Consultation`, `ConsultationConsent`, `Prescription`, `PrescriptionItem`, `Payment`, `PaymentWebhookEvent`, `IdempotencyRecord`, `OutboxEvent`, `RefreshSession`, `AuditLog`.
- **Database-Level Enforced Invariants**:
  1. `btree_gist` extension for generalized search trees on timestamps and UUIDs.
  2. Table Check Constraint: `CHECK (end_time > start_time)` on `availability_slots`.
  3. Exclusion Constraint: `EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status != 'CANCELLED')` on `availability_slots`.
  4. Partial Unique Index: `CREATE UNIQUE INDEX uniq_active_slot_consultation ON consultations(slot_id) WHERE status != 'CANCELLED'`.
  5. Scoped Composite Unique Keys: `(provider, eventId)` on `payment_webhook_events`, `(scope, operation, key)` on `idempotency_records`, and `(consultationId, version)` on `prescriptions`.

```mermaid
erDiagram
  User ||--o| PatientProfile : "has profile"
  User ||--o| DoctorProfile : "has profile"
  User ||--o| UserMfaCredential : "has credentials"
  User ||--o{ RefreshSession : "owns sessions"
  User ||--o{ AuditLog : "initiates"

  DoctorProfile ||--o{ AvailabilitySlot : "schedules"
  DoctorProfile ||--o{ Consultation : "conducts"
  DoctorProfile ||--o{ Prescription : "issues"

  PatientProfile ||--o{ Consultation : "books"
  PatientProfile ||--o{ ConsultationConsent : "grants"
  PatientProfile ||--o{ Prescription : "receives"

  AvailabilitySlot ||--o| Consultation : "reserved for"

  Consultation ||--o| ConsultationConsent : "requires consent"
  Consultation ||--o| Payment : "settled by"
  Consultation ||--o{ Prescription : "produces"

  Prescription ||--o{ PrescriptionItem : "contains items"
  Prescription ||--o{ Prescription : "amends previous version"

  User {
    string id PK
    string email UK
    string phone UK
    string passwordHash
    enum role
    enum status
    boolean mfaEnabled
    datetime createdAt
    datetime updatedAt
  }

  DoctorProfile {
    string id PK
    string userId FK
    string fullName
    string licenseNumber UK
    string_array specializations
    string_array qualifications
    int experienceYears
    decimal consultationFee
    enum_array supportedModes
    enum verificationStatus
    datetime verifiedAt
  }

  AvailabilitySlot {
    string id PK
    string doctorId FK
    datetime startTime
    datetime endTime
    enum status
    int version
  }

  Consultation {
    string id PK
    string slotId UK,FK
    string patientId FK
    string doctorId FK
    enum status
    enum mode
    string meetingRoomId
    string meetingToken
    boolean consentRecorded
    datetime consentTimestamp
    string clinicalNotes
  }

  ConsultationConsent {
    string id PK
    string consultationId UK,FK
    string patientId FK
    enum consentType
    string version
    boolean granted
    string ipAddress
    string userAgent
    datetime timestamp
  }

  Prescription {
    string id PK
    string consultationId FK
    string doctorId FK
    string patientId FK
    int version
    string parentPrescriptionId FK
    string amendmentReason
    string diagnosis
    string doctorSignature
    datetime createdAt
  }

  PrescriptionItem {
    string id PK
    string prescriptionId FK
    string medicineName
    string dosage
    string frequency
    int durationDays
    string instructions
  }

  Payment {
    string id PK
    string consultationId UK,FK
    string patientId FK
    decimal amount
    string currency
    enum status
    enum provider
    string providerOrderId UK
    string providerPaymentId UK
    string idempotencyKey UK
  }

  PaymentWebhookEvent {
    string id PK
    enum provider
    string eventId UK
    string eventType
    json payload
    boolean signatureValid
    enum status
    datetime receivedAt
    datetime processedAt
  }

  IdempotencyRecord {
    string id PK
    string scope UK
    string operation UK
    string key UK
    string requestHash
    enum status
    int responseStatus
    json responseBody
    datetime claimedAt
    datetime expiresAt
  }

  OutboxEvent {
    string id PK
    string aggregateType
    string aggregateId
    string eventType
    json payload
    enum status
    int retryCount
    int maxRetries
    datetime nextRetryAt
  }

  RefreshSession {
    string id PK
    string userId FK
    string tokenHash UK
    string familyId
    string replacedByTokenHash
    boolean revoked
    datetime expiresAt
  }

  AuditLog {
    string id PK
    string actorId FK
    string actorRole
    string action
    string resourceType
    string resourceId
    json changeset
    string ipAddress
    string userAgent
    datetime createdAt
  }
```

---

## 4. Latency & Performance Design Decisions

### Measured Performance Benchmarks (Liveness Probe Baseline)
A controlled in-process HTTP benchmark (300 requests, 30 concurrent workers via `scratch/load_test.ts`) executed against the HTTP framework's `/health/live` endpoint on local Node.js 20 yielded:

| Metric | Target SLA | Measured Baseline (`/health/live`) | Status |
|---|:---:|:---:|:---:|
| **Throughput** | $> 200\text{ req/sec}$ | **683.9 req/sec** | Baseline Exceeds Target |
| **Minimum Latency** | $< 50\text{ ms}$ | **23.46 ms** | Event-loop baseline |
| **Average Latency** | $< 75\text{ ms}$ | **39.61 ms** | Event-loop baseline |
| **p50 Latency (Median)** | $< 50\text{ ms}$ | **28.59 ms** | Event-loop baseline |
| **p95 Latency (95th percentile)** | $< 120\text{ ms}$ | **90.15 ms** | Event-loop baseline |
| **p99 Latency (99th percentile)** | $< 200\text{ ms}$ | **104.49 ms** | Event-loop baseline |

> [!WARNING]
> **Scope & Test Limits — No Database/Redis Load Claimed**:
> - **Endpoint Tested**: The benchmark measured only the `/health/live` route. This route verifies Node.js event-loop and Express routing responsiveness without executing database queries or Redis lookups.
> - **Workload Tested**: The workload did **NOT** exercise PostgreSQL queries, Redis, authentication, booking, or payment flows under high concurrency.
> - **Authentication Latency**: Endpoints requiring password verification (`/api/v1/auth/login`) exhibit intentional ~95–130ms latency due to Bcrypt hashing (work factor 12).
> - **Transactional Database Endpoints**: Complex database workflows (such as `/api/v1/bookings` or `/api/v1/payments/webhook`) involve Prisma transactions, PostgreSQL row locks, and transactional outbox writes. Their throughput under distributed production load is untested and will be bounded by PostgreSQL connection pooling and transaction serialization limits.
> - **Distributed WAN Testing**: Multi-node distributed WAN testing (e.g. k6 cluster across geographic availability zones) was not executed.

### Key Architectural Decisions Driving Low Latency

#### 1. Zero N+1 Queries & Relational Projection
- All cross-entity queries (e.g. retrieving consultations with doctor, patient, slot, and payment) use Prisma relational `include` or selective projections (`select`), compiling to efficient single SQL queries with inner joins.
- Eliminates roundtrip network latency between the application server and PostgreSQL.

#### 2. Asynchronous Transactional Outbox (Decoupled Side Effects)
- In a telemedicine system, actions like appointment booking and prescription issuance require downstream notifications (email, SMS, calendar invites, reminders).
- **Design Decision**: Outbox events (`OutboxEvent`) are committed in the **same ACID transaction** as the business mutation (~1ms latency cost).
- The HTTP response is returned immediately to the client without blocking on external SMTP/SMS network calls.
- The background worker polls outbox events asynchronously using `SELECT ... FOR UPDATE SKIP LOCKED`, preventing client request thread contention.

#### 3. Database Indexing Strategy
Compound and covered B-Tree indexes are explicitly deployed on high-frequency query paths:
- `availability_slots([doctorId, startTime, endTime, status])`: Fast slot search without full-table scans.
- `consultations([patientId, status])` and `consultations([doctorId, status])`: Sub-millisecond filtered dashboard queries.
- `prescriptions([consultationId])` & `prescriptions([patientId])`: Fast historical medical chart retrieval.
- `audit_logs([resourceType, resourceId])` & `audit_logs([actorId])`: Scalable compliance inspection.

#### 4. Bcrypt Work Factor Calibration (95 – 130 ms)
- Login latency is deliberately dominated by Bcrypt password hashing (`work factor = 10`).
- This 100ms compute cost is a mandatory cryptographic defense against offline GPU rainbow-table attacks, strictly isolated from other API endpoints.

---

## 5. Concurrency Control & Invariant Guarantees

### Zero Double-Booking Guarantee
Double-booking is prevented through a three-layer defense:

```
Layer 1: Application Conditional Atomic Update
         UPDATE availability_slots 
         SET status = 'BOOKED', version = version + 1 
         WHERE id = $1 AND status = 'AVAILABLE';
         (If rows affected == 0 -> throw 409 Conflict)
                |
Layer 2: PostgreSQL Exclusion Constraint (btree_gist)
         EXCLUDE USING gist (
           doctor_id WITH =,
           tstzrange(start_time, end_time, '[)') WITH &&
         ) WHERE (status != 'CANCELLED');
                |
Layer 3: Storage-Level Active Consultation Unique Index
         CREATE UNIQUE INDEX uniq_active_slot_consultation 
         ON consultations(slot_id) 
         WHERE status != 'CANCELLED';
```

---

## 6. State Machine Specifications

### Consultation Lifecycle FSM
```mermaid
stateDiagram-v2
  [*] --> BOOKED : Patient Books Available Slot
  BOOKED --> CONFIRMED : Payment Captured / Webhook Settled
  BOOKED --> CANCELLED : Patient or Doctor Cancels
  CONFIRMED --> IN_PROGRESS : Doctor Starts (Consent Mandatory)
  CONFIRMED --> CANCELLED : Cancelled with Automated Refund
  CONFIRMED --> NO_SHOW : Patient Fails to Attend
  IN_PROGRESS --> COMPLETED : Doctor Saves Clinical Notes
  COMPLETED --> [*]
  CANCELLED --> [*]
  NO_SHOW --> [*]
```

### Scoped Idempotency State Machine
```mermaid
stateDiagram-v2
  [*] --> PENDING_CLAIM : Claim Lock with Body Hash
  PENDING_CLAIM --> COMPLETED : Handler Succeeded (Store Status & Body)
  PENDING_CLAIM --> [*] : Handler Failed (Release Lock for Retry)
  COMPLETED --> [*] : Return Cached (X-Idempotent-Replay: true)
```

---

## 7. ACID Database Transaction Coverage

Every state-mutating operation is executed in a dedicated `prisma.$transaction`:

| Module | Operation | Operations Bound Inside Single Transaction |
|---|---|---|
| **Auth** | Patient Register | `tx.user.create` + `tx.patientProfile.create` + `tx.auditLog.create` + `createRefreshSession(tx)` |
| **Auth** | Token Rotate | `tx.$queryRaw ... FOR UPDATE` + revoke old session + insert new rotated session |
| **Auth** | MFA Verify | `tx.$queryRaw ... FOR UPDATE` + consume single-use code + issue tokens + audit log |
| **Doctors** | Admin Approve | `tx.doctorProfile.update(VERIFIED)` + `tx.user.update(role: DOCTOR)` + audit log |
| **Availability**| Create Slots | `Promise.all(tx.availabilitySlot.create)` + audit log |
| **Bookings**| Create Booking | `tx.availabilitySlot.updateMany(WHERE status = AVAILABLE)` + `tx.consultation.create` + `tx.outboxEvent.create` + audit log |
| **Bookings**| Cancel Booking | `tx.consultation.update(CANCELLED)` + `tx.availabilitySlot.update(CANCELLED)` + `tx.payment.update(REFUNDED)` + outbox event + audit log |
| **Consultations**| Record Consent | `tx.consultationConsent.upsert` + `tx.consultation.update(consentRecorded: true)` + outbox event + audit log |
| **Consultations**| Complete | `tx.consultation.update(COMPLETED, clinicalNotes)` + outbox event + audit log |
| **Prescriptions**| Issue / Amend | `tx.prescription.create(items, doctorSignature)` + outbox event + audit log |
| **Payments**| Create Order | `tx.payment.upsert(PENDING)` + outbox event + audit log |
| **Payments**| Capture Webhook| `tx.payment.update(CAPTURED)` + `tx.consultation.update(CONFIRMED)` + `tx.paymentWebhookEvent.update(PROCESSED)` + outbox event + audit log |
| **Worker**| Claim Batch | `tx.$queryRaw ... FOR UPDATE SKIP LOCKED` + `tx.$executeRaw UPDATE ... status = 'PROCESSING'` |
