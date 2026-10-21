# Master Video Walkthrough Script: Amrutam Telemedicine Backend

**Total Estimated Duration:** 6 – 8 Minutes  
**Structure:**
- **Part 1 (0:00 – 2:30):** System Architecture, Tech Stack, Design Decisions & Latency Benchmarks
- **Part 2 (2:30 – 7:30):** Live Postman End-to-End Clinical & Concurrency Demonstration  
**Presenter Tone:** Senior Software Engineer — authoritative, precise, evidence-based, calm.

---

## PART 1: Architecture, Design Decisions & Latency Profile (0:00 – 2:30)

### 1.1 Introduction & Core Purpose (0:00 – 0:40)
* **[Visual Cue]:** *Show `docs/architecture.md` on screen, or title slide: "Amrutam Telemedicine Backend — Architecture & Live Verification".*
* **[Spoken Narration]:**
> "Hello everyone. Today I'm presenting the Amrutam Telemedicine Backend — a production-grade, concurrency-safe healthcare platform built to handle high-volume doctor-patient consultations while strictly enforcing Indian Telemedicine Practice Guidelines (TPG 2020) and DPDP 2023 compliance.
>
> In telemedicine, eventual consistency isn't enough: double-booking doctor slots or issuing unverified prescriptions directly compromises clinical safety. This architecture was designed from the ground up to enforce non-negotiable invariants at the PostgreSQL engine level, rather than relying solely on fragile application-level checks."

---

### 1.2 Tech Stack & Component Boundaries (0:40 – 1:15)
* **[Visual Cue]:** *Scroll to High-Level Architecture Diagram and ER Diagram in `docs/architecture.md`.*
* **[Spoken Narration]:**
> "Let's review the core technology stack:
> - **Runtime & Language:** Node.js 20 LTS running strict TypeScript, structured as a clean modular monolith across distinct domains: Auth, Scheduling, Bookings, Consultations, Prescriptions, and Payments.
> - **Framework & Middleware:** Express 4 hardened with Helmet security headers, CORS isolation, Pino-HTTP structured JSON logging with correlation IDs (`X-Correlation-ID`), and Prometheus metrics on `/metrics`.
> - **Database Layer:** PostgreSQL 16 managed via Prisma ORM, utilizing the native `btree_gist` extension for exclusion constraints and partial unique indexes across 15 relational entities.
> - **Caching & Rate Limiting:** Redis 7 managing distributed token family revocations and sliding-window rate limiters.
> - **Cryptography:** Bcrypt with work factor 10 for password protection, AES-256-GCM for TOTP MFA secrets, and HMAC-SHA256 for tamper-evident digital prescription signing and payment webhook verification."

---

### 1.3 Key Architectural & Design Decisions (1:15 – 1:55)
* **[Visual Cue]:** *Highlight Sections 3 and 5 in `docs/architecture.md` (Concurrency Control & Invariants).*
* **[Spoken Narration]:**
> "Four foundational design decisions drive this system:
>
> 1. **Zero Double-Booking Guarantee:** Doctor availability intervals are protected by PostgreSQL `EXCLUDE USING gist` constraints on timestamp ranges. Even under high concurrent race conditions, the database physical engine rejects overlapping intervals with 100% determinism.
> 2. **TPG 2020 Clinical Workflow Engine:** A strict Finite State Machine requires explicit informed patient consent before any consultation can commence. A doctor cannot begin a call or issue a prescription without verifiable patient consent on record.
> 3. **Asynchronous Transactional Outbox Pattern:** Downstream notifications (SMS reminders, emails) are written directly into an `OutboxEvent` table inside the *same ACID transaction* as the clinical action. The client response returns in milliseconds, while background workers drain the outbox safely using `SELECT ... FOR UPDATE SKIP LOCKED`.
> 4. **Authoritative Server-Side Pricing:** In the payment module, client-submitted prices are discarded. Order amounts are derived strictly from verified doctor profile fees on the server, signed with HMAC-SHA256 webhooks and deduplicated using database idempotency records."

---

### 1.4 Latency Profile & Performance Benchmarks (1:55 – 2:30)
* **[Visual Cue]:** *Highlight the Latency Benchmark Table in `docs/architecture.md` Section 4.*
* **[Spoken Narration]:**
> "Let's talk about performance. Under controlled in-process benchmarking with 30 concurrent workers executing 300 requests:
> - Our HTTP pipeline baseline achieved **683.9 requests per second**.
> - With a **p50 median latency of 28.59 milliseconds**, a **p95 of 90.15 milliseconds**, and a **p99 of 104.49 milliseconds**.
>
> It's critical to note the engineering trade-offs:
> - Our authentication endpoint `/api/v1/auth/login` deliberately operates at ~100ms because Bcrypt's work factor 10 is CPU-bound by design to eliminate GPU brute-force attacks.
> - Relational queries utilize zero N+1 projections, and transactional mutations operate under 30ms.
>
> Now, let's shift directly into Postman to walk through the complete end-to-end clinical journey live."

---

## PART 2: Live Postman End-to-End Walkthrough (2:30 – 7:30)

* **[Visual Cue]:** *Switch screen to Postman. Open the `Amrutam Telemedicine Backend API` collection in the sidebar. Point out that all URLs use clean literal endpoints (`http://localhost:4000/api/v1/...`).*

---

### Step 1: Health, Readiness & Telemetry (2:30 – 3:00)
* **Request 1.1:** `1. Health & Probes > 1.1 Liveness Probe` (`GET http://localhost:4000/health/live`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — `{"status":"ok","uptime":...}`.
  * **Spoken Narration:**
  > "We begin with our Kubernetes-compatible health probes. The liveness check returns 200 OK instantly with process uptime and memory telemetry."

* **Request 1.2:** `1. Health & Probes > 1.3 Prometheus Metrics Endpoint` (`GET http://localhost:4000/api/v1/metrics`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Prometheus metric lines starting with `amrutam_`.
  * **Spoken Narration:**
  > "Our Prometheus metrics endpoint exposes real-time application telemetry, memory heap usage, and HTTP duration histograms ready for Grafana scraping."

---

### Step 2: Authentication & Token Rotation (3:00 – 3:45)
* **Request 2.1:** `2. Auth & Identity > 2.1 Patient Login` (`POST http://localhost:4000/api/v1/auth/login`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Returns JWT Access Token & Refresh Token.
  * **Spoken Narration:**
  > "Next, our patient logs in. Notice the dual-token architecture: we return a short-lived access token and a refresh token. The Postman test script automatically captures `patientToken` and stores it into our session environment."

* **Request 2.2:** `2. Auth & Identity > 2.2 Doctor Login` (`POST http://localhost:4000/api/v1/auth/login`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Authenticates `doctor@amrutam.co.in`, captures `doctorToken`.
  * **Spoken Narration:**
  > "We also authenticate our verified Ayurvedic doctor, Dr. Ananya Sharma. Her credentials and doctor profile ID are captured for the clinical steps ahead."

* **Request 2.4:** `2. Auth & Identity > 2.4 Token Refresh & Family Rotation` (`POST http://localhost:4000/api/v1/auth/refresh`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Old refresh token rotated, new pair issued.
  * **Spoken Narration:**
  > "Here is our OWASP-compliant token rotation in action. When refreshed, the old refresh token is immediately invalidated and a new family pair is issued. Any replay of an old token triggers automatic family revocation."

---

### Step 3: Scheduling & Non-Overlapping Slot Creation (3:45 – 4:25)
* **Request 3.1:** `3. Scheduling & Doctor Availability > 3.1 Doctor Creates Availability Slot` (`POST http://localhost:4000/api/v1/availability/slots`)
  * **Action:** Click **Send**.
  * **Observe:** `201 Created` — Returns slot object with status `AVAILABLE`.
  * **Spoken Narration:**
  > "In folder 3, the doctor publishes an availability slot for telemedicine consultations. The slot ID is saved automatically. Notice that the PostgreSQL `btree_gist` exclusion constraint guarantees this doctor can never create overlapping intervals."

---

### Step 4: Atomic Booking & Concurrency Protection (4:25 – 5:05)
* **Request 4.1:** `4. Bookings & Concurrency > 4.1 Patient Books Confirmed Slot` (`POST http://localhost:4000/api/v1/bookings`)
  * **Action:** Click **Send**.
  * **Observe:** `201 Created` — Returns `consultationId`, slot status changes to `BOOKED`.
  * **Spoken Narration:**
  > "Now the patient books that specific slot. This triggers an atomic PostgreSQL transaction: the slot status shifts from `AVAILABLE` to `BOOKED`, a Consultation record is created, and an Outbox event is registered for patient notification."

* **Request 4.2:** `4. Bookings & Concurrency > 4.2 Booking Idempotency Check` (`POST http://localhost:4000/api/v1/bookings`)
  * **Action:** Click **Send**.
  * **Observe:** `201 Created` / `200 OK` — Returns identical response payload without double-booking.
  * **Spoken Narration:**
  > "If the patient's network drops and retries with the same `Idempotency-Key` header, the system returns the cached authoritative response without creating a duplicate booking. Furthermore, our automated concurrency test suite proves that under 15 simultaneous booking requests for the same slot, exactly 1 succeeds and 14 receive HTTP 409 Conflict."

---

### Step 5: TPG 2020 Legal Consent & Consultation Lifecycle (5:05 – 5:50)
* **Request 5.1:** `5. Legal Consent (TPG 2020) & Clinical Workflow > 5.1 Patient Grants Telemedicine Consent` (`POST http://localhost:4000/api/v1/consultations/{{consultationId}}/consent`)
  * **Action:** Click **Send**.
  * **Observe:** `201 Created` — `granted: true`, `version: "TPG_2020_V1"`.
  * **Spoken Narration:**
  > "Under Indian Telemedicine Practice Guidelines, explicit patient consent is a mandatory prerequisite. Here, the patient grants consent for telemedicine consultation. This record is immutable and timestamped."

* **Request 5.2:** `5. Legal Consent (TPG 2020) & Clinical Workflow > 5.2 Doctor Starts Consultation Session` (`POST http://localhost:4000/api/v1/consultations/{{consultationId}}/start`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Status changes to `IN_PROGRESS`, creates video room session.
  * **Spoken Narration:**
  > "With consent legally recorded, the doctor initiates the session. The consultation transitions to `IN_PROGRESS` and generates our secure room token."

* **Request 5.3:** `5. Legal Consent (TPG 2020) & Clinical Workflow > 5.3 Doctor Completes Consultation` (`POST http://localhost:4000/api/v1/consultations/{{consultationId}}/complete`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Consultation status transitions to `COMPLETED`.
  * **Spoken Narration:**
  > "At the conclusion of the call, the doctor marks the consultation `COMPLETED`. Prohibited backwards transitions are strictly rejected by the finite state machine."

---

### Step 6: Immutable Digital Prescription with HMAC Signature (5:50 – 6:35)
* **Request 6.1:** `6. Prescriptions > 6.1 Doctor Issues Immutable Digital Prescription` (`POST http://localhost:4000/api/v1/prescriptions`)
  * **Action:** Click **Send**.
  * **Observe:** `201 Created` — Returns prescription with `doctorSignature: "..."` and medicines list.
  * **Spoken Narration:**
  > "Now the doctor issues the official digital prescription. Notice the response includes a cryptographic HMAC-SHA256 signature generated over the doctor ID, diagnosis, dosage items, and timestamp. Any alteration to medicines or dosages invalidates this signature, fulfilling legal telemedicine evidentiary standards."

* **Request 6.2:** `6. Prescriptions > 6.2 Patient Retrieves Prescription` (`GET http://localhost:4000/api/v1/consultations/{{consultationId}}/prescriptions`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Array containing the signed digital prescription.
  * **Spoken Narration:**
  > "The patient retrieves their prescription record with verified doctor licensing details."

---

### Step 7: Server-Priced Payments & Idempotent Webhooks (6:35 – 7:15)
* **Request 7.1:** `7. Payments & Webhooks > 7.1 Patient Creates Authoritative Server-Priced Order` (`POST http://localhost:4000/api/v1/payments/orders`)
  * **Action:** Click **Send**.
  * **Observe:** `201 Created` — Status `PENDING`, amount ₹750 (derived from Dr. Sharma's profile fee).
  * **Spoken Narration:**
  > "Moving to payments: notice the request body does not specify any price. The server authoritatively looks up Dr. Sharma's verified consultation fee (₹750) and generates the payment order. This prevents client-side price tampering."

* **Request 7.2:** `7. Payments & Webhooks > 7.2 Payment Gateway Webhook (Capture & Confirm)` (`POST http://localhost:4000/api/v1/payments/webhook`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — `{"success":true,"duplicate":false}`.
  * **Spoken Narration:**
  > "The payment gateway webhook arrives with a cryptographic HMAC signature. Our webhook handler verifies the signature, marks payment status as `CAPTURED`, and records the processed event."

* **Request 7.3:** `7. Payments & Webhooks > 7.3 Webhook Replay Deduplication Test` (`POST http://localhost:4000/api/v1/payments/webhook`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — `{"success":true,"duplicate":true,"message":"Webhook event already processed"}`.
  * **Spoken Narration:**
  > "Payment gateways routinely retry webhooks on network timeouts. We re-send the exact same webhook payload: the database composite unique constraint catches the duplicate and returns 200 OK with `duplicate: true`, preventing double-crediting."

---

### Step 8: Security ABAC Isolation & Admin Overview (7:15 – 7:45)
* **Request 8.1:** `8. Security & ABAC Isolation > 8.1 Cross-Patient Access Denied (IDOR Defense)` (`GET http://localhost:4000/api/v1/consultations/{{consultationId}}`)
  * **Action:** Click **Send**.
  * **Observe:** `401 / 403 Forbidden` — Access denied.
  * **Spoken Narration:**
  > "In folder 8, we verify our zero-trust access control. Attempting to fetch another patient's medical records or using an unauthorized token is immediately blocked by our attribute-based access control middleware, preventing IDOR vulnerabilities."

* **Request 8.2:** `8. Security & ABAC Isolation > 8.2 Admin Platform Overview Analytics` (`GET http://localhost:4000/api/v1/admin/analytics/overview`)
  * **Action:** Click **Send**.
  * **Observe:** `200 OK` — Aggregate system analytics (consultations count, revenue, completed sessions).
  * **Spoken Narration:**
  > "Finally, the platform administrator accesses our optimized analytics engine, returning real-time metrics across all consultations, payments, and completion rates with zero cross-tenant data leaks."

---

### Conclusion (7:45 – 8:00)
* **[Visual Cue]:** *Bring up the terminal showing 128 / 128 automated tests passing, or switch back to the main architecture diagram.*
* **[Spoken Narration]:**
> "In conclusion, the Amrutam Telemedicine Backend delivers an end-to-end clinical workflow backed by 128 automated integration, security, and race-condition tests. It marries PostgreSQL-level concurrency guarantees with TPG 2020 regulatory compliance and low-latency architectural patterns.
>
> Thank you for your time, and I welcome any technical questions!"
