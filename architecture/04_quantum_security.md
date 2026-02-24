# QS-VC: Quantum-Safe Security Architecture

---

## 1. Security Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     ZERO TRUST SECURITY ARCHITECTURE                         │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 1: IDENTITY & ACCESS                                             │  │
│  │                                                                        │  │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────┐  │  │
│  │  │ PQC Identity  │  │ MFA/FIDO2     │  │ RBAC + ABAC               │  │  │
│  │  │ Provider      │  │ Auth Engine   │  │ Policy Engine             │  │  │
│  │  │ (Keycloak +   │  │               │  │ (Open Policy Agent)       │  │  │
│  │  │  Dilithium    │  │ • WebAuthn    │  │                           │  │  │
│  │  │  certificates)│  │ • TOTP        │  │ • Per-resource policies   │  │  │
│  │  │               │  │ • Push MFA    │  │ • Contextual access       │  │  │
│  │  │ • SAML 2.0    │  │ • PQC-signed  │  │ • Device trust scoring    │  │  │
│  │  │ • OIDC        │  │   challenges  │  │ • Geo-fencing             │  │  │
│  │  │ • SCIM 2.0    │  │               │  │                           │  │  │
│  │  └───────────────┘  └───────────────┘  └───────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 2: TRANSPORT SECURITY (Q-TLS)                                    │  │
│  │                                                                        │  │
│  │  Hybrid Key Exchange: X25519 + CRYSTALS-Kyber-1024                    │  │
│  │  Hybrid Signatures:   Ed25519 + CRYSTALS-Dilithium-5                  │  │
│  │  Symmetric Cipher:    AES-256-GCM                                     │  │
│  │  Hash:                SHA-3-256                                        │  │
│  │                                                                        │  │
│  │  TLS 1.3 with PQC extensions (draft-ietf-tls-hybrid-design)          │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 3: MEDIA ENCRYPTION (E2EE)                                       │  │
│  │                                                                        │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │  │
│  │  │ Insertable Streams API (WebRTC E2EE)                              │ │  │
│  │  │                                                                   │ │  │
│  │  │ Frame-level encryption:                                           │ │  │
│  │  │ • Each participant generates Kyber-1024 keypair                   │ │  │
│  │  │ • Key exchange via PQC-signed SFrame key distribution            │ │  │
│  │  │ • AES-256-GCM frame encryption/decryption                        │ │  │
│  │  │ • SFU sees only encrypted frames (zero-knowledge)                │ │  │
│  │  │ • Key rotation every 60 seconds                                  │ │  │
│  │  └───────────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 4: DATA AT REST                                                  │  │
│  │                                                                        │  │
│  │  • Recordings: AES-256-GCM with Kyber-wrapped DEK                    │  │
│  │  • Database: Transparent Data Encryption (PostgreSQL pgcrypto)       │  │
│  │  • Object Storage: Server-side encryption with PQC key envelope      │  │
│  │  • Logs: Append-only tamper-proof (Merkle tree verification)         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 5: AUDIT & COMPLIANCE                                            │  │
│  │                                                                        │  │
│  │  • Tamper-proof audit logs (append-only + Merkle tree)               │  │
│  │  • Real-time SIEM integration (Splunk/ELK)                           │  │
│  │  • Compliance dashboards (ISO 27001, DPDP Act, GDPR)                 │  │
│  │  • Automated compliance scanning                                      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Quantum-Safe Cryptographic Implementation

### Hybrid Cryptography Rationale

```
WHY HYBRID (Classical + PQC)?

1. PQC algorithms are newer → classical provides fallback assurance
2. NIST recommends hybrid approach during transition period
3. If either classical OR PQC is broken, the other still protects
4. Gradual migration path for existing infrastructure

IMPLEMENTATION:

  Handshake Key = KDF(X25519_shared_secret || Kyber1024_shared_secret)
  
  • If quantum computer breaks X25519 → Kyber still protects
  • If PQC has unforeseen weakness → X25519 still protects
  • Both must be compromised for key recovery
```

### Key Exchange Protocol (Kyber-1024 + X25519)

```
Client                                    Server
  │                                          │
  │ ClientHello                              │
  │ + supported_groups: [x25519, kyber1024]  │
  │ + key_share: x25519_pub, kyber1024_pub   │
  │─────────────────────────────────────────►│
  │                                          │
  │                              ServerHello │
  │     key_share: x25519_pub, kyber1024_ct  │
  │        + certificate (Dilithium signed)  │
  │        + certificate_verify              │
  │◄─────────────────────────────────────────│
  │                                          │
  │ Client computes:                         │
  │ ss_x25519 = X25519(client_sk, server_pk) │
  │ ss_kyber = Kyber.Decaps(kyber_ct, sk)    │
  │ master_secret = HKDF(ss_x25519||ss_kyber)│
  │                                          │
  │ Finished                                 │
  │─────────────────────────────────────────►│
  │                                          │
  │        Application Data (AES-256-GCM)    │
  │◄════════════════════════════════════════►│
```

### Digital Signature (Dilithium-5 + Ed25519)

```python
# Hybrid signature implementation
from crystals_dilithium import Dilithium5
from nacl.signing import SigningKey as Ed25519SigningKey

class HybridSigner:
    def __init__(self):
        self.dilithium_sk, self.dilithium_pk = Dilithium5.keygen()
        self.ed25519_sk = Ed25519SigningKey.generate()
        self.ed25519_pk = self.ed25519_sk.verify_key
    
    def sign(self, message: bytes) -> bytes:
        sig_dilithium = Dilithium5.sign(self.dilithium_sk, message)
        sig_ed25519 = self.ed25519_sk.sign(message).signature
        
        # Concatenated hybrid signature
        return (
            len(sig_dilithium).to_bytes(4, 'big') +
            sig_dilithium +
            sig_ed25519
        )
    
    def verify(self, message: bytes, signature: bytes) -> bool:
        dil_len = int.from_bytes(signature[:4], 'big')
        sig_dil = signature[4:4+dil_len]
        sig_ed = signature[4+dil_len:]
        
        # BOTH must verify
        ok_dil = Dilithium5.verify(self.dilithium_pk, message, sig_dil)
        ok_ed = self.ed25519_pk.verify(message, sig_ed)
        
        return ok_dil and ok_ed
```

---

## 3. End-to-End Encryption (E2EE) for Media

### SFrame-Based E2EE (WebRTC Insertable Streams)

```
┌─────────────────────────────────────────────────────────────────────┐
│ E2EE Media Pipeline                                                  │
│                                                                      │
│ Sender Side:                                                         │
│                                                                      │
│ Camera → Encoder → [Insertable Stream Transform] → Encrypted → SFU  │
│                      │                                               │
│                      ▼                                               │
│              ┌──────────────────────────┐                            │
│              │ SFrame Encryptor          │                            │
│              │                          │                            │
│              │ 1. Get current epoch key │                            │
│              │    (AES-256-GCM)         │                            │
│              │ 2. Generate per-frame IV │                            │
│              │ 3. Encrypt payload       │                            │
│              │ 4. Keep RTP header clear │                            │
│              │    (SFU needs routing)   │                            │
│              └──────────────────────────┘                            │
│                                                                      │
│ SFU (zero-knowledge):                                                │
│ • Reads RTP headers only (unencrypted)                              │
│ • Forwards encrypted payload as-is                                   │
│ • Cannot decrypt or inspect media content                           │
│                                                                      │
│ Receiver Side:                                                       │
│                                                                      │
│ SFU → Encrypted → [Insertable Stream Transform] → Decoder → Display │
│                      │                                               │
│                      ▼                                               │
│              ┌──────────────────────────┐                            │
│              │ SFrame Decryptor          │                            │
│              │                          │                            │
│              │ 1. Get sender's epoch key│                            │
│              │ 2. Extract IV from frame │                            │
│              │ 3. Decrypt payload       │                            │
│              │ 4. Pass to decoder       │                            │
│              └──────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Distribution with PQC

```
┌──────────────────────────────────────────────────────────────────┐
│ E2EE Key Distribution Protocol                                    │
│                                                                   │
│ Meeting Start:                                                    │
│ 1. Each participant generates Kyber-1024 keypair (ephemeral)     │
│ 2. Public keys exchanged via signaling (PQC-TLS protected)       │
│ 3. Host generates meeting encryption key (MEK)                   │
│ 4. MEK encapsulated to each participant's Kyber public key       │
│ 5. Encapsulated MEK distributed via signaling channel            │
│ 6. Each participant decapsulates to recover MEK                  │
│                                                                   │
│ Key Rotation (every 60 seconds):                                  │
│ 1. Derive new epoch key: epoch_key = HKDF(MEK, epoch_counter)   │
│ 2. Increment epoch counter (synchronized via signaling)          │
│ 3. Old epoch key retained for 5 seconds (in-flight frame decrypt)│
│                                                                   │
│ Participant Join:                                                 │
│ 1. New participant gets current MEK via Kyber encapsulation      │
│ 2. Cannot decrypt any frames before their join time              │
│                                                                   │
│ Participant Leave:                                                │
│ 1. Generate new MEK (forward secrecy)                            │
│ 2. Distribute to remaining participants                          │
│ 3. Departed participant cannot decrypt future frames             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Lifecycle Management

```
┌──────────────────────────────────────────────────────────────────────────┐
│ HashiCorp Vault + PQC Plugin                                              │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Key Hierarchy                                                      │   │
│  │                                                                    │   │
│  │ Root Key (HSM-protected, Shamir split, 5-of-8 threshold)          │   │
│  │     │                                                              │   │
│  │     ├── Master Encryption Key (KEK)                               │   │
│  │     │       │                                                      │   │
│  │     │       ├── TLS Private Keys (Dilithium + Ed25519)            │   │
│  │     │       ├── TURN Shared Secrets (rotated hourly)              │   │
│  │     │       ├── JWT Signing Keys (Dilithium)                      │   │
│  │     │       └── Recording Encryption Keys (per-meeting)           │   │
│  │     │                                                              │   │
│  │     ├── Data Encryption Keys (DEK)                                │   │
│  │     │       │                                                      │   │
│  │     │       ├── Database TDE Keys                                 │   │
│  │     │       ├── Object Storage Keys                               │   │
│  │     │       └── Backup Encryption Keys                            │   │
│  │     │                                                              │   │
│  │     └── Identity Keys                                             │   │
│  │             │                                                      │   │
│  │             ├── CA Certificates (Dilithium root CA)               │   │
│  │             ├── Service Mesh mTLS Certs                           │   │
│  │             └── User Authentication Keys                          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  Key Rotation Schedule:                                                   │
│  ┌──────────────────────┬───────────────┬────────────────────────────┐   │
│  │ Key Type             │ Rotation      │ Method                     │   │
│  ├──────────────────────┼───────────────┼────────────────────────────┤   │
│  │ TLS Certificates     │ 90 days       │ ACME + auto-renewal        │   │
│  │ TURN Secrets         │ 1 hour        │ Vault dynamic secrets      │   │
│  │ JWT Signing Keys     │ 24 hours      │ Dual-key overlap period    │   │
│  │ Meeting Keys (E2EE)  │ 60 seconds    │ HKDF epoch derivation      │   │
│  │ Recording DEKs       │ Per-recording │ Unique key per recording   │   │
│  │ Database TDE         │ 30 days       │ Online re-encryption       │   │
│  │ Root CA              │ 5 years       │ HSM ceremony               │   │
│  └──────────────────────┴───────────────┴────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Compliance Framework

### Regulatory Mapping

| Regulation | Requirements | QS-VC Implementation |
|---|---|---|
| **DPDP Act (India)** | Data localization, consent, DPO | India-region data residency, consent UI, DPO dashboard |
| **IT Act 2000 (India)** | Lawful interception, intermediary guidelines | LEA interface (court-ordered only), audit logs |
| **GDPR (EU)** | Data minimization, right to erasure, DPA | Auto-purge, deletion API, DPA tooling |
| **ISO 27001** | ISMS, risk assessment, controls | Full ISMS implementation, annual audit |
| **ISO 27701** | Privacy information management | PII inventory, DPIA tooling |
| **SOC 2 Type II** | Security, availability, confidentiality | Continuous monitoring, annual certification |
| **HIPAA** | PHI protection | BAA support, audit controls, encryption |
| **FedRAMP** | US government cloud security | Separate GovCloud deployment |

### Data Sovereignty Controls

```
┌────────────────────────────────────────────────────────────────┐
│ Data Sovereignty Engine                                         │
│                                                                 │
│ Rule: "India-first" — all Indian user data stays in India       │
│                                                                 │
│ Implementation:                                                 │
│ 1. Geo-tagged data classification at ingestion                 │
│ 2. Region-locked storage policies on PostgreSQL + S3           │
│ 3. Cross-region replication BLOCKED for restricted data        │
│ 4. Encryption keys for Indian data in Indian HSM only          │
│ 5. Meeting recordings = same region as host user               │
│ 6. Transcripts/summaries = same region as recording            │
│ 7. Admin override requires DPO + CISO dual approval            │
│                                                                 │
│ Cross-Border Meeting Handling:                                  │
│ • Media routed through nearest SFU (may cross borders)         │
│ • Recording stored in host's region                            │
│ • Each participant's PII stays in their region                 │
│ • Aggregated analytics: anonymized before cross-region sync    │
└────────────────────────────────────────────────────────────────┘
```

### Tamper-Proof Audit Logs

```
┌──────────────────────────────────────────────────────────────────────┐
│ Audit Log Architecture                                                │
│                                                                       │
│  Event Source → Kafka → Audit Log Service → Append-Only Store         │
│                                                                       │
│  Each log entry:                                                      │
│  {                                                                    │
│    "id": "ulid",                                                     │
│    "timestamp": "2025-01-15T10:30:00Z",                             │
│    "actor": { "userId", "ip", "deviceId", "geoLocation" },         │
│    "action": "meeting.join | recording.access | admin.config.change",│
│    "resource": { "type", "id" },                                    │
│    "outcome": "success | failure",                                   │
│    "details": { ... },                                               │
│    "hash": "SHA3-256(previous_hash + this_entry)",                  │
│    "signature": "Dilithium5.sign(hash)"                             │
│  }                                                                    │
│                                                                       │
│  Verification:                                                        │
│  • Merkle tree root published hourly to immutable ledger             │
│  • Any tampering breaks the hash chain → detectable                 │
│  • Independent auditor can verify chain integrity                    │
│  • Retention: 7 years (configurable per regulation)                  │
└──────────────────────────────────────────────────────────────────────┘
```
