# Threat Model & Security Architecture

**System:** Amrutam Telemedicine Backend  
**Framework:** STRIDE & OWASP API Security Top 10  
**Compliance Standards:** Indian Telemedicine Practice Guidelines (TPG 2020), DPDP Act 2023, ISO 27001  

---

## 1. Trust Boundaries & Attack Surfaces

```
               [ Internet / External Attackers ]
                              |
                     [ TLS 1.3 Boundary ]
                              v
 [ Untrusted User Input (Web/Mobile Apps) ] ---> [ Rate Limiter & Helmet ]
                                                        |
                                            [ Authentication Boundary ]
                                                        v
                                            [ JWT + Isolated TOTP MFA ]
                                                        |
                                             [ Authorization (ABAC) ]
                                                        v
                                       [ Internal Domain Services & DB ]
```

## 2. Threat Analysis (STRIDE) & Hardened Mitigations

| Threat Category | Potential Attack Vector | Applied Mitigation |
|---|---|---|
| **Spoofing** | Forged JWT, stolen refresh tokens, or compromised MFA | Dual-token model: 15-minute access token; refresh tokens stored with SHA-256 hash in DB with family rotation. MFA secrets stored in isolated `UserMfaCredential` encrypted with AES-256-GCM; backup codes hashed with Bcrypt/Argon2id. |
| **Tampering** | Modifying prescription records, forging payment webhooks, or tampering with consent | Prescriptions are append-only with cryptographic doctor signatures. Payment webhooks enter `RECEIVED` state and require constant-time HMAC-SHA256 verification before being marked `PROCESSED`. Consents are stored in immutable `ConsultationConsent` records with IP and timestamps. |
| **Repudiation** | Doctor denies issuing a prescription; patient denies granting consent | Cryptographic digital signature generated over prescription contents; immutable append-only `audit_logs` tracking user ID, IP address, user-agent, timestamp, and changes. Explicit `ConsultationConsent` record stored per booking. |
| **Information Disclosure** | IDOR / BOLA exposing medical history; leaking MFA secrets in user queries | Resource ownership middleware (ABAC) ensures patients only see their own records. `UserMfaCredential` is in a separate table, preventing accidental exposure via standard user profile queries. Sensitive health fields encrypted at rest. |
| **Denial of Service & Race Conditions** | High-frequency booking flooding or double-booking the same slot | PostgreSQL `btree_gist` exclusion constraints prevent overlapping intervals. Atomic pessimistic row-level locking (`SELECT ... FOR UPDATE`) prevents concurrent bookings. Scoped idempotency with `PENDING_CLAIM` rejects duplicate concurrent in-flight requests with 409 Conflict. |
| **Elevation of Privilege** | Normal patient altering role or bypassing MFA | Role strictly enforced from JWT claims signed with an audited 256-bit secret. Startup validation halts the application if default or insecure secrets are present. |

## 3. Data Protection & Cryptography
1. **Data in Transit:** Enforced TLS 1.3 with HSTS headers.
2. **Data at Rest:** 
   - TOTP secrets encrypted with AES-256-GCM (requiring IV and authentication tag).
   - Clinical notes encrypted using AES-256-GCM with environment-injected 64-hex-character secret.
3. **Password & Backup Code Security:** Salted hashes using Argon2id / Bcrypt with work factor 12.
4. **Log Sanitization:** Pino logger automatically redacts passwords, tokens, MFA secrets, cards, and clinical notes from stdout/files.
