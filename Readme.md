# Amrutam Telemedicine Backend

Production-Grade, Concurrency-Safe, and Highly Scalable Telemedicine Backend Architecture for Amrutam.

---

## Architecture Highlights
- **Framework:** Express + Node.js (TypeScript)
- **Primary Datastore:** PostgreSQL 16 managed via Prisma ORM
- **In-Memory Cache & Rate Limiting:** Redis 7
- **Concurrency Control:** Pessimistic Row-Level Locking (`SELECT FOR UPDATE`) & Database Constraints (Zero Double-Booking Guarantee)
- **Idempotent Writes:** HTTP `Idempotency-Key` tracking with payload SHA-256 fingerprinting
- **Asynchronous Processing:** Transactional Outbox Pattern (`FOR UPDATE SKIP LOCKED`) for reliable notification and reminder dispatch
- **Security:** RFC 6238 TOTP Multi-Factor Authentication (MFA), Argon2id/Bcrypt password hashing, JWT Access + Rotating Refresh Tokens, ABAC ownership verification
- **Observability:** Structured JSON logging (Pino), Prometheus RED metrics (`/metrics`), Liveness/Readiness probes (`/health/liveness`, `/health/readiness`)
- **Compliance:** Indian Telemedicine Practice Guidelines (2020) & DPDP Act (2023)

---

## Directory Structure
```
amrutam-backend/
├── src/
│   ├── app.ts                  # Express application setup & middleware stack
│   ├── server.ts               # HTTP Server bootstrapper & graceful shutdown
│   ├── config/                 # Typed environment configuration
│   ├── common/
│   │   ├── errors/             # Domain errors & RFC 7807 problem details
│   │   ├── middleware/         # Auth, RBAC, ABAC, Idempotency, Rate Limiters
│   │   ├── validation/         # Zod schemas & DTO validators
│   │   └── observability/      # Pino logger & Prometheus metrics
│   ├── modules/
│   │   ├── auth/               # User registration, login, refresh, TOTP MFA
│   │   ├── users/              # Patient profiles & user management
│   │   ├── doctors/            # Doctor profile, verification, onboarding
│   │   ├── availability/       # Schedule templates & slot generation
│   │   ├── bookings/           # Concurrency-safe booking & idempotency
│   │   ├── consultations/      # Strict FSM lifecycle & video room provider
│   │   ├── prescriptions/      # Immutable clinical records & versioning
│   │   ├── payments/           # Webhook ingestion & reconciliation
│   │   ├── search/             # Doctor discovery & caching
│   │   ├── audit/              # Append-only audit logger
│   │   └── admin/              # Analytics aggregations & verification queues
│   ├── infrastructure/
│   │   ├── database/           # Prisma client singleton & transaction manager
│   │   ├── cache/              # Redis client wrapper with fallback
│   │   ├── queue/              # Transactional outbox repository
│   │   └── payments/           # Pluggable Razorpay & Local Mock gateway
│   └── worker/                 # Outbox polling worker & reminder dispatcher
├── prisma/
│   ├── schema.prisma           # Complete entity definitions & constraints
│   └── migrations/             # Versioned SQL migrations
├── tests/
│   ├── unit/                   # Business domain & state machine tests
│   ├── integration/            # API end-to-end integration tests
│   ├── concurrency/            # Parallel booking collision test suites
│   └── security/               # IDOR, auth bypass, and tamper tests
├── openapi/
│   └── openapi.yaml            # OpenAPI 3.1 contract specification
├── infra/
│   ├── docker/                 # Container configs
│   └── aws/                    # Terraform cloud deployment manifests
├── docs/                       # Architecture, Threat Model, Runbooks & DR
├── .github/workflows/          # Continuous Integration pipeline
├── Dockerfile                  # Multi-stage production container build
├── compose.yaml                # Docker Compose orchestration (App + Postgres + Redis)
└── .env.example                # Sample environment variables
```

---

## Quickstart & Local Setup

### 1. Prerequisites
- Node.js >= 20.x
- PostgreSQL 16 (or Docker)
- Redis 7 (or Docker)

### 2. Environment Setup
```bash
cp .env.example .env
npm install
```

### 3. Database Migration & Client Generation
```bash
npx prisma generate
npx prisma db push
```

### 4. Running via Docker Compose
```bash
docker compose up --build -d
```

### 5. Running in Development Mode
```bash
# Start API Server
npm run dev

# Start Background Outbox Worker
npm run worker
```

### 6. Executing Test Suites
```bash
# Run all tests
npm test

# Run concurrency double-booking tests
npm run test:concurrency

# Run security & IDOR tests
npm run test:security
```
