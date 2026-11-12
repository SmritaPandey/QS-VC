# Cryptographic posture statement

ASSUMED – pending client approval: pilot interoperability profile. Each status describes the current deployment evidence. Candidate features require validation on pinned builds. A hybrid key exchange does not change the certificate signature algorithm.

| Layer | Status | Mechanism, fallback and evidence owner |
|---|---|---|
| Edge TLS | Classical – residual risk (mitigated by managed endpoints and scoped routing) | Caddy template lists X25519MLKEM768 and X25519. Prefer hybrid over TLS 1.3. Local OpenSSL handshake verified below. Capture group and certificate signature from real browser and Electron builds. Edge owner |
| Internal transport | Classical – residual risk (mitigated by segmentation and purpose credentials) | HTTP today. Target authenticated TLS with offline root, constrained online issuer, unique SAN and client/server EKU. Stage classical leafs until all clients accept PQ certificate chains. Platform owner |
| Management | Classical – residual risk (mitigated by restricted management network and key-only SSH) | Target hybrid SSH KEX. Verify host keys separately. Systems owner |
| MPLS overlay | Classical – residual risk (mitigated by restricted routing and application encryption) | MPLS supplies routing. Require hybrid IKEv2 on managed gateways before classified media crosses the carrier. Network owner |
| Media | Classical – residual risk (mitigated by DTLS-SRTP and restricting legacy endpoints) | Current WebRTC has no measured PQ DTLS negotiation. Verify candidate E2EE independently. Media owner |
| Identity | Classical – residual risk (mitigated by short session lifetime and restricted issuer reach) | Auth uses Ed25519 signing files. Keycloak PQ JOSE and sender-constrained QS-VC tokens UNVERIFIED. Identity owner |
| Data at rest | Classical – residual risk (mitigated by limiting retention and access) | S3 AES256 request today. Target LUKS2 AES-256-XTS with separate per-object AES-256-GCM data keys wrapped by a managed KEK. Backup transfer needs authenticated key transport. Storage owner |
| Key custody | Classical – residual risk (mitigated by file permissions and purpose separation) | Current provisioner writes file keys. Production HSM integration and ceremonies pending. PKI owner |
| Release and update | Not applicable | Existing image packager creates checksums. Candidate release requires two independent signatures against separately distributed keys. Release owner |
| Audit integrity | Not applicable | Structured logs do not demonstrate signed integrity. SIEM owner must verify chain checkpoints and independently anchored signatures |

## Official evidence checked 12 November 2026

- NIST finalized ML-KEM, ML-DSA and SLH-DSA in FIPS 203/204/205. Algorithm standardization and module validation are distinct. [NIST publication announcement](https://www.nist.gov/news-events/news/2024/08/announcing-issuance-three-final-post-quantum-encryption-standards)
- OpenSSL 3.5 supports the standardized algorithms. Go 1.24 added X25519MLKEM768 for TLS. Caddy exposes TLS protocol and curve selection. Record actual Caddy Go build and provider versions. [OpenSSL 3.5 notes](https://openssl-library.org/news/openssl-3.5-notes/) · [Go 1.24](https://go.dev/doc/go1.24) · [Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls)
- OpenSSH 10.0 makes mlkem768x25519-sha256 its preferred client KEX. Host runtime support and effective server configuration remain UNVERIFIED. [OpenSSH 10.0](https://www.openssh.org/txt/release-10.0)
- Chrome enterprise documentation records support for PQ TLS key agreement. Exact Chrome/Electron and mediasoup DTLS behavior remains UNVERIFIED. [Chrome enterprise policy](https://support.google.com/chrome/a/answer/2657289?hl=EN)
- RFC 9370 defines multiple IKE exchanges. It does not establish that a particular appliance implements ML-KEM. RFC 9605 SFrame requires a separate key management system. [IKEv2](https://www.rfc-editor.org/rfc/rfc9370.html) · [SFrame](https://www.rfc-editor.org/rfc/rfc9605.html)

## Loopback evidence

On 12 November 2026, the local Caddy 2.11.9 ARM64 image
sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
reported Go 1.27.3. OpenSSL 4.1.0 verified the local CA and hostname,
negotiated TLS 1.3 with X25519MLKEM768 and rejected TLS 1.2. The certificate
signature remained ECDSA P-256. The negotiated cipher was TLS_AES_128_GCM_SHA256.
Client requirements for AES-256-only transport need separate enforcement and
testing. Browser, Electron and client target image negotiation remain UNVERIFIED.

## Media paths

A. Prefer a hybrid overlay spanning all carrier links. Inside the gateway boundary DTLS remains classical and the SFU may access decoded media without E2EE.
B. Evaluate SFrame with authenticated participant key distribution and rekey on membership changes. SFrame alone provides no PQ key exchange. Existing browser E2EE is a separate implementation and requires its own test.
C. Evaluate TURN/TLS on a separate private address at TCP 443. Hybrid TLS, if negotiated, covers only client-to-relay. Verify UDP-blocked calls and classical exposure on the relay-to-SFU path.

ML-KEM-768 adds 1,184 bytes for the client public key and 1,088 for the server ciphertext relative to X25519-only shares. ML-KEM-1024 adds 1,568 bytes in each direction before framing. Larger TLS messages can span TCP segments. For UDP IKE, measure encapsulated MTU, allow required PMTUD messages and confirm IKE fragmentation and rekey at both gateways.

## Migration and rollback

Version the policy and each key ID. Verify support in staging, then distribute new trust anchors before issuing new credentials. Require both release signatures during the transition. Move one dependency at a time and retain old decrypt-only KEKs for authorized recovery until retention expires. Roll back by restoring the previous signed policy and trusted release only after reviewing any revocations and schema compatibility. Never restore a revoked key or allow silent profile downgrade. Prefer SLH-DSA for long-lived offline signing candidates. LMS/XMSS requires strict state management under SP 800-208.
