# Operational Runbook: Amrutam Telemedicine Backend

## 1. Routine Operations

### Checking Service Health
```bash
# Check container statuses
docker compose ps

# Test API Liveness Probe
curl -i http://localhost:4000/health/liveness

# Test API Readiness Probe (Checks Postgres & Redis)
curl -i http://localhost:4000/health/readiness

# Scrape Prometheus Metrics
curl -s http://localhost:4000/metrics | grep telehealth_
```

### Running Database Migrations
```bash
# Apply pending migrations
npx prisma migrate deploy

# Check migration status
npx prisma migrate status
```

---

## 2. Incident Runbooks

### Runbook 1: Elevated Booking Concurrency Conflicts
* **Symptom:** Alert `telehealth_booking_conflicts_total` increasing rapidly.
* **Diagnosis:**
  1. Multiple users are attempting to reserve the exact same doctor slot simultaneously.
  2. Verify if this is legitimate demand (popular doctor / marketing campaign) or bot scraping.
* **Action:**
  1. Verify application logs: `grep "CONFLICT_SLOT_RESERVED" /var/log/amrutam/app.log`.
  2. If caused by bot traffic, adjust IP rate limits on `/api/v1/appointments/book`.
  3. Confirm that no duplicate records exist in `consultations` table using:
     ```sql
     SELECT slot_id, count(*) FROM consultations GROUP BY slot_id HAVING count(*) > 1;
     ```
     (Expected result: 0 rows).

### Runbook 2: Transactional Outbox Lag / DLQ Accumulation
* **Symptom:** Customers report delay in receiving booking confirmation emails.
* **Diagnosis:**
  1. Check worker logs: `docker compose logs --tail=100 -f worker`.
  2. Inspect failed outbox events:
     ```sql
     SELECT id, event_type, retry_count, last_error FROM outbox_events WHERE status = 'FAILED';
     ```
* **Action:**
  1. If external email/SMS provider is returning 5xx, the worker will automatically retry with exponential backoff.
  2. If bad payload, fix payload and reset status:
     ```sql
     UPDATE outbox_events SET status = 'PENDING', retry_count = 0, next_retry_at = NOW() WHERE id = '...';
     ```

### Runbook 3: Stuck Pending Payments
* **Symptom:** Consultations remain in `BOOKED` state without transitioning to `CONFIRMED`.
* **Action:**
  1. Trigger manual payment reconciliation job:
     ```bash
     npm run reconcile:payments
     ```
  2. The reconciler queries the gateway API for all pending transactions $> 15\text{ minutes}$ old and synchronizes states.
