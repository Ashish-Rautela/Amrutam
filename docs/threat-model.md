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
| **Spoofing** | Forged JWT, stolen refresh tokens, or compromised MFA | Dual-token model: 15-minute access token; refresh tokens stored with SHA-256 hash in DB with family rotation. MFA secrets stored in isolated `UserMfaCredential` encrypted with AES-256-GCM; backup codes hashed with Bcrypt (work factor 10). |
| **Tampering** | Modifying prescription records, forging payment webhooks, or tampering with consent | Prescriptions are append-only with HMAC-SHA256 signatures. Payment webhooks enter `RECEIVED` state and require constant-time HMAC-SHA256 verification before being marked `PROCESSED`. Consents are stored in immutable `ConsultationConsent` records with IP and timestamps. |
| **Repudiation** | Doctor denies issuing a prescription; patient denies granting consent | Cryptographic HMAC-SHA256 signature generated over canonical prescription JSON payload (doctor, consultation, version, diagnosis, items, timestamp); immutable append-only `audit_logs` tracking user ID, IP address, user-agent, timestamp, and changes. Explicit `ConsultationConsent` record stored per booking. |
| **Information Disclosure** | IDOR / BOLA exposing medical history; leaking MFA secrets in user queries | Resource ownership middleware (ABAC) ensures patients only see their own records. `UserMfaCredential` is in a separate table, preventing accidental exposure via standard user profile queries. Sensitive health fields encrypted at rest. |
| **Denial of Service & Race Conditions** | High-frequency booking flooding or double-booking the same slot | PostgreSQL `btree_gist` exclusion constraints prevent overlapping intervals. Atomic pessimistic row-level locking (`SELECT ... FOR UPDATE`) prevents concurrent bookings. Scoped idempotency with `PENDING_CLAIM` rejects duplicate concurrent in-flight requests with 409 Conflict. |
| **Elevation of Privilege** | Normal patient altering role or bypassing MFA | Role strictly enforced from JWT claims signed with an audited 256-bit secret. Startup validation halts the application if default or insecure secrets are present. |

## 3. Data Protection & Cryptography (Source-of-Truth Implementation)
1. **Data in Transit:** Enforced TLS 1.3 with HSTS headers.
2. **Data at Rest:** 
   - TOTP secrets encrypted with AES-256-GCM (requiring 96-bit random IV and 128-bit authentication tag, keyed via `MFA_ENCRYPTION_KEY`).
   - Clinical notes stored in database text columns with strict ABAC authorization and redaction in Pino application logging. Field-level encryption helper (`encryptAesGcm`) is available for database migration hardening.
3. **Password & Backup Code Security:** 
   - Passwords hashed using Bcrypt with work factor 12 (`bcryptjs`). Constant-time dummy hash used on invalid account lookup to prevent timing enumeration.
   - Backup recovery codes hashed using Bcrypt with work factor 10.
4. **Token & Request Hashing:**
   - Refresh tokens persisted as SHA-256 digests; raw tokens never stored.
   - Idempotency request payloads hashed as SHA-256 digests.
5. **Message Integrity & Signatures:**
   - Prescriptions use HMAC-SHA256 symmetric message authentication codes over canonical JSON payloads (doctor, consultation, version, diagnosis, items, timestamp).
   - Payment webhooks use HMAC-SHA256 signatures validated via `crypto.timingSafeEqual`.
6. **Log Sanitization:** Pino logger automatically redacts passwords, tokens, MFA secrets, cards, and authorization headers from stdout/files.
