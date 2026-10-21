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
- **Security:** RFC 6238 TOTP Multi-Factor Authentication (MFA), Bcrypt (work factor 12) password hashing, JWT Access + Rotating Refresh Tokens, ABAC ownership verification
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
npx prisma migrate deploy
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

---

## HTTP Idempotency Contract (`Idempotency-Key`)
The API implements database-backed scoped idempotency (`IdempotencyRecord`) on state-mutating endpoints (`/bookings`, `/payments/orders`):
- **Concurrent In-Flight Request**: If a request arrives while an identical key is still processing (`PENDING_CLAIM`), the server responds with **409 Conflict**.
- **Identical Replay**: If a completed request is replayed with the identical payload, the cached response is returned (**200/201**) with header `X-Cache-Lookup: HIT`.
- **Payload Mismatch / Key Reuse**: If an existing key is reused with a *different* request body, the server rejects it with **400 Bad Request** (`Idempotency key reused with different request payload`).

---

## Continuous Integration & Continuous Delivery (CI/CD)

The repository includes an enterprise-grade GitHub Actions automation pipeline defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### 1. CI Pipeline (`test-and-validate`)
Runs automatically on:
- **Pull Requests** targeting `master` or `main`.
- **Pushes** to `master`, `main`, and `develop`.
- **Release Tags** matching `v*.*.*`.

Includes automatic concurrency cancellation (`cancel-in-progress: true`) and least-privilege permissions (`contents: read`).

#### CI Stages & Execution Flow:
1. **Isolated Service Containers**: Boots PostgreSQL 16 (`postgres:16-alpine`) and Redis 7 (`redis:7-alpine`) with health checks (`pg_isready`, `redis-cli ping`).
2. **Environment & Dependency Setup**: Reproducible installation with Node.js 20 LTS via `npm ci` with NPM cache.
3. **Prisma Validation & Client Generation**: Validates schema syntax (`npx prisma validate`) and compiles multi-target client (`npx prisma generate`).
4. **Static Analysis & Type Checking**: Enforces TypeScript compilation rules (`npm run lint` / `tsc --noEmit`).
5. **Production Build**: Compiles production bundles to `dist/` (`npm run build`).
6. **Database Migration Verification**: Executes versioned SQL migrations (`npx prisma migrate deploy`) against disposable test DB.
7. **Comprehensive Automated Test Suites**:
   - `npm run test:unit`: In-memory configuration, cryptographic cipher, TOTP, and token tests.
   - `npm run test:integration`: End-to-end API integration tests across auth, doctors, availability, bookings, consultations, prescriptions, and payments.
   - `npm run test:concurrency`: High-concurrency race condition tests (validating zero double-booking under parallel bursts).
   - `npm run test:security`: Access control, IDOR, token revocation, and MFA tamper verification.
8. **Docker Compose Validation**: Validates orchestration file integrity (`docker compose --env-file .env.example config`).
9. **Container Image Pre-flight Build**: Builds both API (`--target api`) and Worker (`--target worker`) Docker images to catch Dockerfile errors prior to delivery.

---

### 2. CD Pipeline (`publish-images`)
Triggered strictly after `test-and-validate` passes on:
- Pushes to the primary branch (`master` / `main`).
- Semantic version release tags (`v*`).

*Untrusted pull requests cannot publish images.*

#### Container Versioning & Registry Publishing:
- **Registry**: GitHub Container Registry (`ghcr.io`).
- **Images Published**:
  - `ghcr.io/<owner>/amrutam-backend-api`
  - `ghcr.io/<owner>/amrutam-backend-worker`
- **Tagging Strategy**:
  - **Immutable Commit SHA**: `sha-<commit_sha>` (ensures exact trace to git commit).
  - **Branch Name**: `master` or `main`.
  - **Semantic Release Tag**: `v1.0.0` (when triggered via git tag).
  - **`latest`**: Updated only on the primary default branch.
- **Security & Caching**: Uses GitHub Actions Buildx caching (`type=gha,mode=max`) and repository-scoped `GITHUB_TOKEN` with least-privilege `packages: write`.

---

### 3. Required Repository Settings & Secrets
To enable automated package publishing to GHCR:
1. Navigate to **Settings > Actions > General > Workflow permissions**.
2. Select **Read and write permissions** (or grant Package read/write to `GITHUB_TOKEN`).
3. Allow GitHub Actions to approve/create pull requests if release automation is used.
4. **No external cloud credentials needed for CI/CD container publishing**: The pipeline uses standard GitHub Actions token authentication (`${{ secrets.GITHUB_TOKEN }}`).

---

### 4. Deployment Target Status
- **Current State**: Container delivery to GHCR is fully automated with immutable SHA tagging.
- **Unconfigured Target Platform**: The original specification does not designate a specific cloud runtime (e.g. AWS ECS/Fargate, AWS EKS, GCP Cloud Run, or Fly.io).
- **Next Step**: Once a live runtime target is selected and hosting credentials (e.g., AWS IAM role / EKS kubeconfig) are provided, the CD pipeline can be extended with a rolling update deployment job.

