# Component inventory

Source revision e6ae6cb801560e0f3ded5509849e7ee5b1191a7e, inspected 12 November 2026. Ports are observed source
defaults or Compose mappings. They form an inventory, pending the client network
design. Internal listeners must be isolated from endpoint networks.

| Component and source owner | Runtime and version source | Ports and protocols | State, configuration and readiness |
|---|---|---|---|
| Web, frontend/web | React 18, TypeScript, Vite; Node 22 build; nginx:alpine runtime | Container HTTP 5173; public HTTPS via proxy | VITE_AUTH_URL, VITE_SIGNALING_URL, VITE_MEETING_URL, VITE_RECORDING_URL and same-origin routing; self-hosted fonts and MediaPipe assets |
| Desktop, frontend/desktop | Electron 45.2.3 per package pin; embedded Chromium/Node; host build tools | HTTPS/WSS to workspace; optional loopback SSO callback | Workspace URL; Windows/macOS/Linux ZIP builds; signing/notarization requires separate evidence |
| Edge proxy, config/Caddyfile.template | caddy:2-alpine | TCP 80/443; WSS upgrade on /ws | DOMAIN/QSVC_DOMAIN; internal CA currently selected; certificate distribution or client CA integration required |
| Authentication, services/auth | Node 22 container | Internal HTTP 4002 | PostgreSQL auth role; session signing file; INTERNAL_AUTH_SECRET, TURN_ACCESS_SECRET, CORS_ORIGINS, WEB_URL; optional identity/email/billing |
| Signaling, services/signaling | Node 22 container, WebSocket and RPC | Internal HTTP/WS 4001 | MEETING_POLICY_SECRET, INVITATION_SECRET, SFU_CONTROL_TOKEN, service URLs, TURN configuration, optional Redis tickets, ASR/MT URLs; room state is process-local |
| Meeting, services/meeting | Node 22 container | Internal HTTP 4003 | PostgreSQL meeting role, tenant context and migrations; shared internal purpose keys; optional embedded signaling in combined image |
| SFU, services/sfu | Node 22 Debian/glibc container; mediasoup worker | Internal HTTP 4000; configured UDP 40000–40100 | SFU_ANNOUNCED_IP, SFU_CONTROL_TOKEN, worker count; plain transports for optional MCU require reachability checks |
| Recording, services/recording | Node 22 container, AWS SDK | Internal HTTP 4004; outbound HTTPS S3 | RECORDING_BUCKET, AWS_REGION and SDK credentials; browser-hosted composition/upload, not unattended server recording; S3 endpoint override missing |
| Legacy MCU, services/mcu | Node TypeScript placeholder | Loopback HTTP 4005 | Reports mediaReady=false and returns 503 for media operations; exclude from a claim of working composition |
| SFU Poly bridge, deploy/poly-bridge | TypeScript/CommonJS inside SFU process; dedicated Dockerfile | SFU /api/poly internal HTTP; SIP through drachtio; RTP/SRTP plain transports | BRIDGE_API_TOKEN, SFU_CONTROL_TOKEN, SIGNALING_URL, POLY_TENANT_ID on signaling, FS/DRACHTIO settings; physical interoperability unverified |
| FreeSWITCH, deploy/poly-bridge/freeswitch | External FreeSWITCH installation, mod_conference/mod_av codecs | SIP 5060 TCP/UDP, TLS 5061 candidate; bridge SIP 5090 per config; ESL 8021 private; media range depends on host config | Conference composite, endpoint registration, device directory, TLS and ACLs; installer uses Debian packages; Rocky path unresolved |
| drachtio, compose/mcu.yml | drachtio/drachtio-server:0.8.26 | SIP 5070 UDP/TCP; admin 9022 private | DRACHTIO_SECRET; shares Linux host network with bridge |
| TURN/STUN, deploy/turn | coturn/coturn:4.6.3 | UDP/TCP 3478; optional TLS TCP 5349; UDP relay 49152–49200 | TURN_SECRET, TURN_REALM, TURN_ALLOWED_SFU_IP and announced address; TLS overlay required; no proven TLS-443 fallback |
| Main database | postgres:16-alpine | TCP 5432 internal | Persistent volume; per-service roles, forced tenant RLS, migrations 001–031; backup/restore not accepted for client |
| Redis | redis:7-alpine | TCP 6379 internal | REDIS_PASSWORD/URL; persistence in Compose; using Redis does not make process-local meeting state HA |
| Object store candidate | minio/minio:latest in production Compose | S3 HTTP 9000 internal; admin console 9001 internal | Persistent volume; access/secret and bucket; current recording adapter is not wired to MINIO_* settings |
| Optional SSO | Keycloak 26.8.2 with digest pin; separate postgres:16-alpine | Keycloak HTTP 8080 internally; host loopback 8085; management 9000 internally; DB 5432 | QSVC_SSO_*, KEYCLOAK_*, realm import; AD/LDAP/SAML broker configuration and callbacks needed |
| ASR, services/asr | Python 3.11 image, faster-whisper 1.2.1; optional IndicConformer deps | Internal HTTP/WS 8000 | ASR_MODEL, ASR_ENGINE, ASR_API_KEY, languages/device/concurrency; reviewed local bundles and manifests; server transcription requires speaker consent |
| MT, services/mt | Python 3.11, Torch 2.15.0, Transformers 4.57.6, IndicTransToolkit 1.1.1 | Internal HTTP 5000 | MT_MODEL_EN_INDIC, MT_MODEL_INDIC_EN, MT_API_KEY, device/languages; LIBRETRANSLATE_URL/KEY on signaling; writable HF_MODULES_CACHE |
| Optional meeting minutes | Existing external Ollama/OpenAI-compatible service | Configured HTTP endpoint, e.g. 11434 or 8000 | MINUTES_LLM_URL, MINUTES_LLM_MODEL, MINUTES_LLM_API_KEY; local model/license/resource review required |
| Billing cancellation worker | Timer in auth process, services/auth/src/index.ts | Outbound provider HTTPS | Runs about every 30 seconds; durable cancellation outbox, retries and capture reconciliation; disable external billing for isolated deployment |
| Operational tooling | db/migrate.js; scripts/provision-security-keys.mjs; package-intranet-images.sh | Build-host registry/package access; local Docker API | Existing SBOM/Grype pipeline, key generation and image save; no complete client preflight/restore/image pipeline yet |

Node 22 is the container baseline. The root package declares Node >=20, which
does not prove all dependencies run under Node 20. Python 3.11 is the AI image
baseline; host Python 3.10 cannot run hashlib.file_digest in pin-model.py.

## Configuration owners

| Area | Variables and files to reconcile in P1/P2 |
|---|---|
| Hostnames and endpoints | DOMAIN, WEB_URL, AUTH_PUBLIC_URL, CORS_ORIGINS, VITE_*; config/Caddyfile.template and frontend nginx config |
| Identity and secrets | SESSION_SIGNING_KEY_FILE, INTERNAL_AUTH_SECRET, MEETING_POLICY_SECRET, INVITATION_SECRET, TURN_ACCESS_SECRET, SFU_CONTROL_TOKEN; separate private keys per purpose |
| Database | POSTGRES_*, AUTH_DB_*, MEETING_DB_*, DATABASE_URL/service-specific URLs; shared/database.cjs |
| Media | SFU_*, TURN_*, STUN_SERVERS, BRIDGE_*, FS_*, DRACHTIO_*, POLY_TENANT_ID |
| Recording | RECORDING_BUCKET, AWS_REGION and AWS SDK credentials; reconcile MinIO before an offline recording claim |
| Speech and language | ASR_*, MT_*, LIBRETRANSLATE_*, CAPTION_TRANSLATION_PROVIDER, ENABLE_ONPREM_GOOGLE_TRANSLATION, MINUTES_LLM_* |
| Optional internet services | QSVC_GOOGLE_*, QSVC_MICROSOFT_*, QSVC_EMAIL_*, PAYMENTS_ENABLED, PAYMENT_TERMS_CONFIRMED and provider-specific values |

The companion environment inventory lists discovered names and exact source
locations. Values from private .env files were not read or copied.

## Packaging blockers

1. config/.env.onprem.template uses an obsolete ASR URL ending in
   5001/api/v1/transcribe. The relay expects a base such as http://asr:8000.
   Its MT hostname also differs from the production Compose service.
2. Recording Compose MINIO_* values do not configure createS3Storage.
3. The on-prem template repeats AUTH_PUBLIC_URL and TURN_SECRET, includes legacy
   JWT_SECRET, enables Google translation opt-in and enables MCU by default.
   Its final deployment configuration must be reconciled with actual service owners.
4. Caddy internal TLS requires client trust distribution; customer CA credentials
   are not automatically installed.
5. Mutable container tags need digest resolution and release manifests.
6. Optional AI/Keycloak/Poly images and models need explicit bundle selection.
7. No validated application audit trail, full host hardening or HA claim follows
   from container logs, RLS or a single Compose deployment.
8. Proxy paths must be smoke-tested against actual API owners, including billing,
   internal routes, recording sharing and WebSocket ticket issuance.

## Version, license and checksum evidence

Package manifests and lockfiles are input evidence. A complete license inventory,
container digests, model revisions, OS RPM/DEB list, SBOM/CBOM and artifact checksums
must be generated from the selected build in P1/P2/P5/P6. The existing image
packager supplies image IDs, SBOMs and checksums for its chosen image set. It does
not supply a bootable VM, a complete OS mirror, model bundles, or accepted UAT.

Docker documents Ubuntu 24.04 as an Engine installation target. This is an OS
candidate, not validation of QS-VC on the customer's gold image.
[Docker Ubuntu guidance](https://docs.docker.com/engine/install/ubuntu/).
RHEL-family runtime and support policy must be agreed with the client.
[Docker RHEL guidance](https://docs.docker.com/engine/install/rhel/).
