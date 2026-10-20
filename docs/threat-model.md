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
                                            [ JWT + TOTP MFA Validator ]
                                                        |
                                             [ Authorization (ABAC) ]
                                                        v
                                       [ Internal Domain Services & DB ]
```

## 2. Threat Analysis (STRIDE)

| Threat Category | Potential Attack Vector | Applied Mitigation |
|---|---|---|
| **Spoofing** | Forged JWT or stolen refresh tokens | Dual-token model: 15-minute access token; refresh tokens stored with SHA-256 hash in DB, with automatic reuse detection (invalidates entire token family if leaked). TOTP MFA for doctor/admin roles. |
| **Tampering** | Modifying prescription records or forging payment webhooks | Prescriptions are immutable; amendments require new version records. Payment webhooks validate HMAC-SHA256 signatures against raw request payloads before ingestion. |
| **Repudiation** | Doctor denies issuing a prescription; patient denies cancelling | Cryptographic digital signature generated over prescription contents; immutable append-only `audit_logs` tracking user ID, IP address, user-agent, timestamp, and changes. |
| **Information Disclosure** | IDOR / BOLA exposing another patient's medical history or doctor's schedule | Resource ownership middleware (ABAC) guarantees users can only access records where `patient_id == currentUser.id` or `doctor_id == currentDoctor.id`. |
| **Denial of Service** | High-frequency booking endpoint flooding or doctor search scraping | Sliding window rate limiting on all endpoints via Redis / in-memory token bucket; DB connection pooling; composite indexing on search filters. |
| **Elevation of Privilege** | Normal patient altering their role to DOCTOR or ADMIN | Role strictly checked from validated JWT claims; role modification restricted exclusively to verified administrators with active MFA. |

## 3. Data Protection & Cryptography
1. **Data in Transit:** Enforced TLS 1.3 with HSTS headers.
2. **Data at Rest:** Sensitive medical fields (clinical notes, diagnosis, MFA secrets) encrypted using AES-256-GCM with environment-injected secret keys.
3. **Password Security:** Salted hashes using Argon2id / Bcrypt with work factor 12.
4. **Log Sanitization:** Automated Pino logger redaction filters out `password`, `token`, `mfaSecret`, `cardNumber`, `pan`, and `aadhaar` from all console/file logs.
