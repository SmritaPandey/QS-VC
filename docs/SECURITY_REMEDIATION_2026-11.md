# QS-VC security remediation — 9 November 2026

This is an implementation and local-test record for the supplied pre-assessment, not a VAPT certificate or a production retest. The supplied severity scores and live-site observations have not been independently re-established in this change. No live deployment, certificate signing, firewall change or customer payment was performed.

## Finding register

“Local fix” means source and local checks only; it does not close the finding for the deployed release.

| ID | Implementation / remaining work | Status |
|---|---|---|
| QS-01 | HTTP ICE credentials require a valid session. Admitted guests use an authenticated signaling capability, scoped to meeting and peer. Waiting/stale sockets are rejected. All five TURN profiles use private/link-local/metadata/mapped-IPv6/NAT64 peer restrictions, quotas and relay limits. AWS template requires IMDSv2, hop limit 1. | Local fix; actual relay denial and EC2 metadata settings need network retest. |
| QS-02 | Electron pinned to 45.2.3 and electron-builder to 26.18.0. Linux launcher no longer falls back to `--no-sandbox`. | Partial: runtime ZIP download failed twice with HTTP 504 here. Signed/notarized builds and a trusted update channel still need implementation and signing credentials. |
| QS-03 | Worker runs for all assets; HSTS, enforced CSP and anti-framing headers cover pages and errors. Inline startup JavaScript moved to an external asset. Nginx sends the same CSP on HTML and cached assets. AWS Caddy sends HSTS. | Local fix; payment/media browser tests and deployed headers still require staging retest. HSTS `preload` is a directive, not proof of preload-list registration. |
| QS-04 | Auth alone signs Ed25519 sessions from a private key file. Internal auth verification, meeting policy, invitations and TURN capabilities use separate purpose-specific keys. Missing/default/reused service keys fail outside explicit development/test. Legacy HS256 user sessions are rejected. | Partial: asymmetric session isolation implemented; this is Ed25519, not a PQ/hybrid token signature. No public JWKS/key-overlap rotation endpoint yet. |
| QS-05 | Durable, leased cancellation outbox with retries. A failed trial queues immediate mandate cancellation. Completion requires provider-confirmed terminal state. Verified captures from failed/expired subscriptions are no longer silently ignored. Charges with a missing period or another open subscription are preserved for reconciliation without overwriting another plan. | Local fix; all three provider sandboxes, reconciliation operations and customer/refund notifications need retest. |
| QS-06 | New dependency pins, local-only reviewed model bundles, SHA-256 file inventory, safetensors for Transformers, no runtime Hub download in production. Production model mounts are read-only. | Open: ASR's matched Torch/TorchAudio 2.10.0 stack still has two direct PyTorch advisories. Full transitive/container scans and real model/GPU compatibility tests are pending. |
| QS-07 | No change to account binding of per-meeting E2EE keys. | Open: persistent account/org identity design, key recovery/revocation and key-change UX need reviewed implementation. Self-signed per-meeting bundles do not establish account identity. |
| QS-08 | Worker replaces client-supplied origin credentials; AWS Caddy rejects missing/wrong credentials before any route, including `/ws`. Hybrid X25519MLKEM768/X25519 curves are configured. | Partial: local origin-auth integration test passes; origin network ACL/Tunnel and public TLS retest still needed. An HTTP secret gate is not network-level DDoS protection. |
| QS-09 | Existing SSO/personal sign-in is preserved. | Open: mandatory admin MFA, verified-email account activation and individual-admin account migration are not completed by this change. Do not claim that SSO availability proves MFA. |
| QS-10 | No claim of an append-only security audit trail or statutory retention. | Open: implement event schema, coverage, access controls, immutable India-region retention, NTP and incident-response ownership. Ordinary application logs are insufficient. |
| QS-11 | Existing intranet packaging produces image SBOMs and scans them; new TURN policy, key-provisioning utility and this guide are included. | Open: reviewed commit/tag, reproducible release, SBOM/CBOM, deployed build identity and formal audit freeze are still required. |
| QS-12 | Web crypto library pinned exactly to `@noble/post-quantum@0.7.1` in manifests/locks. | Partial: this does not provide CAVP/CMVP validation or constant-time guarantees. A validated-module integration and certificate verification remain external work. |
| QS-13 | Auth no longer substitutes Google STUN. TURN TLS overlays mount private certificates and publish `turns:` plus the deployment's own STUN hostname. | Partial: enable overlay with trusted certificates and test TLS/renewal. Merely adding TLS does not establish PQ key exchange on TURN. |
| QS-14 | Starter recording inclusion corrected to Pro. Unenforced numeric participant/storage guarantees, duration and 4K claims removed from plan cards. | Partial: remaining deployment-dependent marketing features and limits still need a full contract-to-capability review. |
| QS-15 | All ten lockfiles scanned: no production High/Critical findings. Core/workspace production graphs are clean; the optional Poly bridge has five Moderate entries and the desktop build graph has six Moderate entries. | Partial: CI/built-image SBOM scans and the remaining Moderate dependency findings still need review. No forced downgrade to the audit tool's suggested older builder. |
| QS-16 | Closed-admin-signup response is the same `409 Email already registered` response used for an existing address. | Local fix; registration enumeration retest still required. |
| QS-17 | JSON 404 handlers added to auth, meeting, signaling, SFU and MCU. `workers_dev` disabled. Public Worker deployment identifiers removed; deployment uses existing GitHub environment variables. | Partial: other repository history, deployment metadata and all exposed endpoints require review. |
| QS-18 | ECH is a DNS/edge setting, not implemented in application code. | External: confirm current Cloudflare support and enable/test in the actual zone. |

## Deployment prerequisites

1. Back up the database, existing deployment environment, signing keys and certificates. Validate restoration before a production change. Keep a source/image rollback artifact. Do not replay existing migrations on a database without a reviewed migration ledger.
2. Generate keys once in a private directory outside release archives, for example:

   ```sh
   node scripts/provision-security-keys.mjs /opt/qsvc-secrets
   ```

   The utility refuses to overwrite an existing directory. It creates a private Ed25519 key and `security.env` with distinct service/origin/TURN secrets, without printing their values. Production rejects short or known development TURN secrets. Import these into the deployment's secret manager or private environment. Keep `.secrets`, `security.env` and private keys out of Git and Docker build contexts.

3. Set `SESSION_SIGNING_KEY_FILE` to the **host** key path for Compose. Compose mounts it in auth at `/run/secrets/session_signing_key`; verifying services must not receive this private key. On Linux, make the mounted file readable by auth's actual container UID only. The AWS image uses UID 1000. For that image:

   ```sh
   sudo chown 1000:1000 /opt/qsvc-secrets/session-signing.pem
   sudo chmod 0400 /opt/qsvc-secrets/session-signing.pem
   ```

   Local Compose file-backed secrets may retain host ownership/mode; do not assume their `uid`/`mode` fields remap a bind-mounted file. Verify readability as the runtime user before rollout. Other service images may use a different UID; inspect it first.

4. Install the same `ORIGIN_AUTH_SECRET` in the AWS proxy and the Cloudflare Worker **secret** binding:

   ```sh
   npx wrangler secret put ORIGIN_AUTH_SECRET
   ```

   Supply the value from the secret manager at the prompt. Do not put it in `wrangler.jsonc`, frontend variables, screenshots or command-line arguments. Deploy Worker and proxy together in a coordinated maintenance window. With a missing key the Worker returns 503 and the proxy denies access. Require public clients to use the edge hostname. Provider webhooks and SSO callbacks must use that hostname too; direct-origin callback URLs will now receive 403.

5. Apply migration **028** after the existing numbered migrations, using the migration role (never the app role). Example for AWS, with credentials privately configured:

   ```sh
   docker compose --env-file deploy/aws/.env --env-file /opt/qsvc-secrets/security.env -f deploy/aws/compose.yml --profile maintenance run --rm migrate
   ```

   Migration 028 adds the RLS-protected cancellation outbox and capture reconciliation flags; it also queues previously failed recurring subscriptions. Start auth only after it succeeds. The existing AWS deployment script reads `deploy/aws/.env`; either merge the new references/secrets into that private file or update its secret-manager injection. Do not rotate keys on every release.

6. Build and start the supported profile using both environment files. Newly signed Ed25519 sessions replace old HS256 sessions: users will need to sign in again. Invitation signing also changes, so reissue outstanding invitations. Service keys must be deployed consistently to auth/signaling/meeting; a mismatch fails requests rather than bypassing verification.
7. Restrict origin HTTPS ingress to the approved edge/Tunnel and administrator network. Keep TURN/SFU media on separate, reviewed ingress rules. Apply IMDSv2/hop-limit changes to existing EC2 instances through the cloud control plane; changing the template does not update an existing host.

## TURN TLS

Use a certificate whose SAN matches `TURN_HOST`, with a private-key file readable only by the TURN process. Configure renewal and a controlled coturn reload/restart. Add the TLS overlay **after** the base profile:

```sh
docker compose --env-file .env.production --env-file /opt/qsvc-secrets/security.env -f docker-compose.prod.yml -f deploy/turn/compose.tls.yml config --quiet
```

For AWS use `deploy/aws/compose.yml` followed by `deploy/turn/compose.aws-tls.yml`. Set `TURN_CERT_FILE`, `TURN_KEY_FILE`, `TURN_HOST` and `DOMAIN` privately. Open TCP 5349 only where required. `turns:` uses the TURN hostname/certificate, independently of Cloudflare website TLS; do not proxy ordinary TURN UDP through an HTTP proxy.

The private-peer deny policy intentionally blocks private SFU addresses. Prefer a public media address on internet deployments. On an isolated intranet, `TURN_ALLOWED_SFU_IP` may name **one literal, dedicated SFU IP**. Coturn allow rules override deny rules: constrain egress to that address and media ports, ensure it has no sensitive co-located control services, and retest the exception. Never allow an entire VPC/subnet, loopback or metadata address.

## Payment operations

Auth polls the durable cancellation queue every 30 seconds; jobs are leased for 10 minutes to prevent concurrent processing. Provider calls happen outside database transactions. Exceptions, timeouts and a still-active provider mandate leave the job pending. No cancellation is considered complete until a fresh provider lookup confirms it.

Monitor pending jobs and confirmed captures needing review with the auth tenant context (or a restricted operator/migration role):

```sql
SELECT subscription_id, attempts, next_attempt_at
FROM payment_mandate_cancellations WHERE completed_at IS NULL;
SELECT provider, provider_payment_id, subscription_id, amount_minor, currency, review_reason
FROM payment_captures WHERE needs_review;
```

Reconcile flagged captures with the gateway and contact/refund the customer as appropriate. Do not grant an overlapping lower plan over an existing purchase. Provider sandbox tests must cover cancellation timeout, duplicate webhook, failed-trial authorization, delayed capture, overlapping checkout and provider-confirmed cancellation. No real provider credentials or charges were used in these local tests.

## AI models

Production no longer downloads models on startup. Each model setting must name an already reviewed local directory. Prepare the exact upstream commit on a trusted build machine; review its executable Python code as well as its weights. Copy files out of the Hugging Face cache with symlinks dereferenced. Prefer safetensors; the service explicitly requests it for Transformers loads.

```sh
python3 scripts/pin-model.py /path/to/reviewed-model --revision FULL_40_CHARACTER_COMMIT_HASH
```

The generated manifest pins **every** file. This command records a review decision; it is not a malware scan or signature from the model publisher. Never regenerate a manifest automatically when verification fails. Protect the manifest and artifacts together through reviewed release checksums/signatures and read-only mounts.

Set `ASR_MODEL=/models/whisper`, `ASR_INDIC_MODEL=/models/indic`, `MT_MODEL_EN_INDIC=/models/en-indic`, and `MT_MODEL_INDIC_EN=/models/indic-en` as appropriate. Each directory needs its own manifest. Build contexts for ASR/MT now start at the repository root so their images include the shared integrity helper. Example:

```sh
docker build -f services/asr/Dockerfile -t qsvc-asr:reviewed .
docker build -f services/mt/Dockerfile -t qsvc-mt:reviewed .
```

Development-only downloads need both `NODE_ENV=development` and `QSVC_ALLOW_UNVERIFIED_MODELS=true`, plus a Hub model name such as `ASR_MODEL=small`. The opt-in has no effect in production. Do not enable it to bypass a failed production integrity check.

Direct-package audit results: MT has zero reported advisories in the scanned pins; ASR retains two PyTorch advisories at 2.10.0. This is **not** a transitive-dependency or built-image clearance. ASR's Torch/TorchAudio ABI pair needs a tested replacement or a reviewed ONNX-only implementation. Transformers 5.x and the new MT Torch version need canary inference with the exact reviewed IndicTrans/IndicConformer revisions. GPU profiles require an explicitly supplied, tested CUDA base and wheel index; old CUDA 12.4 examples must not be reused blindly. No real GPU/model inference was verified in this change.

## Local verification and release gate

Run from the repository root:

```sh
npm run build
npm --prefix frontend/desktop run build
npm test
node --test deploy/cloudflare/worker.test.mjs
QSVC_CONTAINER_TESTS=1 node --test deploy/aws/origin-guard.test.mjs
python3 -m unittest shared.test_model_security
PYTHONPATH=. python3 -m pytest services/asr/test_app.py
PYTHONPATH=. python3 -m pytest services/mt/test_app.py
```

All migrations through 028 and `db/verify-access.sql` were tested in isolated PostgreSQL 16 databases. Migration 028 was also applied by a non-superuser, non-BYPASSRLS migration role; its explicit owner policy lets the bounded definer function claim jobs without weakening the app role's tenant policy. Checks include outbox tenant isolation, denied cross-tenant writes and non-replayable leases. This is not verification of the customer's existing database.

Before government go-live, resolve the remaining register items, scan **each built image**, perform authenticated role/tenant tests, exercise a real multi-device E2EE meeting and run bounded load/TURN tests on the intended network. Repeat header/TLS checks on the deployed page, API, WebSocket and TURN endpoints. Freeze the reviewed revision and image digests with SBOM/CBOM and give that exact build to the independent auditor. A `config --quiet`, successful unit test, crypto library pin or passing package audit does not establish release-wide compliance.

Certification remains external: engage a currently CERT-In-empanelled organisation for the required scope/hosting certificate and verify the buyer's tender requirements. ISO certification, legal compliance, NIST CAVP certificates and FIPS 140-3 module validation cannot be created by a source-code change. Use implementation-specific wording for the algorithms actually running; do not call this build NIST-certified, FIPS-validated or a completed government security audit.
