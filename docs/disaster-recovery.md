# Disaster Recovery & Business Continuity Plan

## 1. Targets & Objectives
* **Recovery Point Objective (RPO):** $< 1\text{ minute}$  
* **Recovery Time Objective (RTO):** $< 15\text{ minutes}$  
* **High Availability Target:** 99.95% annual uptime

## 2. Backup Strategy
1. **Continuous WAL Archiving:** PostgreSQL Write-Ahead Logs (WAL) continuously streamed to geo-redundant S3/GCS buckets.
2. **Daily Automated Snapshots:** Full database dumps executed daily at 02:00 UTC with 30-day retention.
3. **Backup Verification:** Automated weekly restore drill to an isolated staging instance to verify backup consistency and index integrity.

## 3. Disaster Scenarios & Recovery Procedures

### Scenario A: Primary Database Failure
1. **Detection:** Healthcheck probe on `/health/readiness` fails for 3 consecutive checks (15 seconds).
2. **Failover:** Automated promotion of hot standby read-replica to primary via patroni / AWS RDS multi-AZ failover.
3. **Application Reconnection:** Connection pool in Node.js handles reconnection with exponential backoff.

### Scenario B: Redis Cache Outage
1. **Graceful Fallback:** Application catches Redis connection failures and falls back seamlessly to direct database queries for doctor search and in-memory token rate limiting.
2. **Recovery:** Once Redis restarts, the application automatically reconnects and repopulates cache on read misses.

### Scenario C: Outbox Worker Interruption
1. **Detection:** Prometheus alert `telehealth_outbox_queue_depth > 500` or `telehealth_outbox_lag_seconds > 120`.
2. **Recovery:** Workers run with `FOR UPDATE SKIP LOCKED`. If a worker pod crashes mid-execution, PostgreSQL automatically releases the row lock, allowing surviving or newly spawned pods to process pending events immediately.
