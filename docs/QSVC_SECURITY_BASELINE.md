# QSVC source and infrastructure audit

4 November 2026 · Read-only source assessment · Independent engineering audit

What this repo does: QSVC provides browser and desktop meetings using React, Express, WebSocket signaling and mediasoup. Its AWS deployment connects PostgreSQL and S3; other launchers describe local/intranet and MinIO deployments. This audit assumes small pilot meetings, including 10 participants; production capacity has not been measured.

Repository: `/Users/shwetakushwaha/Downloads/QS-VC-private`, HEAD `a8514e876f97f86e212a0d62010860738a393cd7`, clean working tree when checked. Findings below describe this source baseline, before fixes made in a separate task workspace. No remote systems were scanned. Environment files, private keys and credentials were not opened. InstaVC source was not identified in the inspected repository; public vendor claims cannot establish its private architecture or certification.

## Must fix

1. **Backend outages still cause sign-out through the meeting API** (`services/meeting/src/index.ts:124`, `services/auth/src/index.ts:373`, `frontend/web/src/components/SignedInWorkspace.tsx:45`).
   - **What this is:** Both the account profile and meeting list validate the active server session.
   - **Problem:** The meeting authentication middleware changes every verification error, including 503 and connection failure, into 401. The profile endpoint also catches every error as 401. The workspace deletes its credential on these responses.
   - **Fix:** Return 401 only for confirmed invalid sessions; return 503 for dependency failures in both services. Test the actual HTTP callers and preserve the client session on unavailable responses.
   - **If we skip it:** Fixing only the profile endpoint leaves intermittent sign-outs through meeting-list requests.

2. **Failed login deletes a usable session** (`frontend/web/src/pages/Login.tsx:18`).
   - **What this is:** Login replaces the browser credential on success.
   - **Problem:** It first calls `clearSession()`, before the server verifies the new credentials. A wrong password or network failure discards the old local session.
   - **Fix:** Keep the old credential until a successful login replaces it; publish session changes from one shared owner.
   - **If we skip it:** A person following a misleading Sign in link can lose access merely by mistyping a password.

3. **The intranet launcher cannot provide the advertised authenticated meeting stack** (`start-intranet.js:20`, `start-intranet.js:113`, `start-intranet.js:150`, `frontend/web/vite.config.ts:12`).
   - **What this is:** The launcher starts signaling, MCU and the web development server.
   - **Problem:** MCU takes port 4002, which the web proxy and signaling expect to be authentication. The launcher does not start auth, meeting or SFU. It shares plain HTTP LAN URLs, which do not provide the secure browser context needed for normal camera/microphone access. The MCU's `startComposition` at `services/mcu/src/index.ts:296` only logs and contains a commented production pipeline.
   - **Fix:** Publish one supported intranet profile with distinct ports, trusted internal HTTPS, authentication/database, meeting service and real media service. Label MCU/SIP/H.323 as unverified until actual gateway/media tests pass.
   - **If we skip it:** A page or health check can appear ready while sign-in and actual conferencing fail. An intranet does not make this a secure production deployment.

4. **The legacy production deployment does not match active services** (`docker-compose.prod.yml:120`, `docker-compose.prod.yml:130`, `docker-compose.prod.yml:210`, `services/recording/src/app.ts:51`).
   - **What this is:** README recommends the root production Compose file; AWS uses a different deployment.
   - **Problem:** SFU uses host networking while signaling addresses it as Docker service `sfu`; that bridge-network name is not supplied by a host-network service. Recording passes MinIO variables, but the active application enables storage only with `RECORDING_BUCKET` and uses an AWS S3 adapter. The legacy web Dockerfile omits `public/`, including `theme.js`.
   - **Fix:** Consolidate on a verified deployment profile, or repair and test each supported profile with matching network addressing, storage adapter, static assets and service URLs. Do not apply AWS assumptions to intranet/legacy Compose.
   - **If we skip it:** A purported production launch can have unavailable media, disabled recording and missing browser initialization assets.

5. **A shared SFU rate limit blocks ordinary meetings** (`services/sfu/src/index.ts:46`, `services/signaling/src/sfu-client.ts:8`, `frontend/web/src/lib/media.ts:163`).
   - **What this is:** Every signaling request to the SFU is limited to 200 requests per source IP per 15 minutes.
   - **Problem:** The signaling server is one source IP. Ten participants with audio and video require up to 10 × 9 × 2 × 2 = 360 consume/resume requests, before transport setup, producing, health checks or other meetings. This is a source-derived request count, not a measured load result.
   - **Fix:** Authenticate internal control requests, give them a capacity-aware budget and enforce participant/tenant quotas at the user-facing boundary. Keep limits on untrusted requests. Test 10-person negotiation and concurrent rooms without unintended 429 responses.
   - **If we skip it:** Small meetings can fall into signaling-only mode or fail media setup even when CPU/network capacity is available.

6. **SFU control endpoints have no application authentication** (`services/sfu/src/index.ts:92`, `services/sfu/src/index.ts:232`, `services/sfu/src/index.ts:282`).
   - **What this is:** HTTP routes create transports, publish/consume media and remove peers.
   - **Problem:** The routes accept caller-supplied room/peer identifiers without a service credential and the listener binds without a host restriction. A network principal able to reach the control port can invoke them. The AWS security group appears intended to block public control-port access; public reachability was not tested and is not asserted here.
   - **Fix:** Bind control APIs to the intended private interface and authenticate signaling-to-SFU calls; validate ownership at the trusted boundary. Test both permitted service calls and rejected direct calls in each deployment profile.
   - **If we skip it:** A firewall mistake or untrusted intranet host can bypass the signaling authorization boundary.

7. **Concurrent first joins can overwrite an SFU room** (`services/sfu/src/index.ts:59`).
   - **What this is:** A room owns one mediasoup router.
   - **Problem:** Two initial calls can both miss the room map, await separate `createRouter()` operations, then overwrite the same map entry. Transports may be created against different routers and the first router can be orphaned. JavaScript's single thread does not prevent interleaving across `await`.
   - **Fix:** Deduplicate creation with a per-room in-flight promise and clean it on both success and failure. Add a deterministic concurrent-call test that returns the same room/router and closes failed work.
   - **If we skip it:** Simultaneous joins can intermittently lose media or leak router resources.

8. **Security and capability claims exceed the active implementation** (`README.md:3`, `frontend/web/src/pages/PricingPage.tsx:74`, `frontend/web/src/pages/ScheduleMeeting.tsx:115`, `start-intranet.js:198`).
   - **What this is:** Product copy and startup output promise E2EE, quantum safety, FIPS compliance and extensive gateway/translation support.
   - **Problem:** The scheduler displays an E2EE selection but sends `e2eeRequired: false`. The active `MeetingRoom`/media path does not call the E2EE manager's sender/receiver transforms. Startup prints unverified compliance/capabilities; MCU composition is scaffolding.
   - **Fix:** Remove or qualify unsupported claims and disable misleading controls; keep the existing policy that rejects meetings requiring unverified E2EE. Treat cryptographic integration and certification as separate evidenced projects.
   - **If we skip it:** People may rely on privacy/security or interoperability that has not been established. No ISO or FIPS compliance is asserted by this review.

## Should fix

9. **WebSocket work is not bounded at the connection/message boundary** (`services/signaling/src/ws-attach.ts:35`, `services/signaling/src/ws-attach.ts:67`).
   - **What this is:** Messages run asynchronously and authenticated messages verify their session through the auth service.
   - **Problem:** `maxPayload` limits an individual message, but no per-connection in-flight limit or message-rate budget is applied before verification. Express's HTTP rate limiter does not cover these WebSocket messages. A valid session can create many simultaneous verification/database requests; guests can create connection/room work outside that limiter.
   - **Fix:** Add bounded per-connection queues and aggregate tenant/IP admission limits, with explicit overload errors and bounded cleanup. Review allowed upgrade origins; CORS middleware does not enforce WebSocket Origin.
   - **If we skip it:** A single noisy client can consume auth/database resources and degrade unrelated meetings. Exploitability and capacity require staging measurement; no CVSS score is assigned from source alone.

10. **Translation is absent from the AWS signaling environment** (`deploy/aws/compose.yml:60`, `services/signaling/src/captions.ts:38`).
   - **What this is:** Active caption translation uses a configured LibreTranslate endpoint.
   - **Problem:** AWS Compose only passes `*runtime`; it does not pass `LIBRETRANSLATE_URL` or its optional key. Merely writing them in the Compose interpolation file does not inject them into the container.
   - **Fix:** Pass the variables explicitly, health-check a private durable translation service, and verify actual Hindi/Japanese language-pair capabilities and consent/data flow.
   - **If we skip it:** Original captions can work while listener translation remains unavailable.

11. **Shared TURN credentials permit reuse outside the intended session** (`deploy/aws/compose.yml:27`, `deploy/aws/compose.yml:89`, `services/signaling/src/index.ts:56`).
   - **What this is:** AWS coturn uses a static user/password, also returned in ICE configuration.
   - **Problem:** Clients necessarily learn these credentials and can reuse them until rotation. The credential is not bounded to meeting/session lifetime. This is a design gap, not proof of an open unauthenticated relay.
   - **Fix:** Issue short-lived TURN REST credentials from an authorized endpoint, configure coturn's matching secret, and set relay/rate/egress budgets. Test expiry and abuse controls on an owned staging relay.
   - **If we skip it:** Leaked client credentials can generate unwanted relay use and egress charges.

12. **Release checks do not cover the supported build/deploy paths** (`.github/workflows/ci.yml:32`, `.github/workflows/ci.yml:56`, `vitest.config.ts:5`, `services/signaling/Dockerfile:7`).
   - **What this is:** CI runs tests/builds and selected Docker builds.
   - **Problem:** Lint failures are ignored. Worker tests are outside Vitest's include list. CI uses root contexts for Dockerfiles written to copy local service `src/` and configuration, so those copies do not describe the service's build root. Some service-local `npm ci` Dockerfiles also need an actual matching lockfile in that context. No Docker build was executed in this audit.
   - **Fix:** Gate meaningful lint/tests, run the separate Worker suite, and make each image context agree with its Dockerfile and shared-file dependencies. Add clean, reproducible builds for the deployment profile actually released.
   - **If we skip it:** Green application tests do not establish that a deployable image or intranet release exists.

13. **There is no verified operating envelope for process-local state** (`services/signaling/src/room-manager.ts:66`, `services/signaling/src/captions.ts:9`, `services/recording/src/app.ts:57`).
   - **What this is:** Room membership, caption caches and upload concurrency are held in each process.
   - **Problem:** Restart loses transient room/caption state; a second replica does not share room ownership or upload budgets. This is acceptable for a consciously single-process pilot but conflicts with scaling by simply adding replicas.
   - **Fix:** Document single-process capacity and recovery first; measure CPU/memory/egress and auth latency. For scale, design room affinity and shared coordination before enabling replicas, with explicit revocation and cleanup semantics.
   - **If we skip it:** A load balancer or restart can split meetings or bypass global budgets. This is an operating-design limit, not an invented multi-replica production incident.

## Six-category coverage and validation requirements

| Audit category | Result | Required verification |
| --- | --- | --- |
| Correctness | Findings 1–5, 7, 10 | Actual HTTP outage semantics; concurrent-router creation test; 10-person negotiation; supported deployment smoke tests |
| Security/data loss | Findings 6, 8, 9, 11 | Direct SFU rejection; session/role/tenant replay; claims corrected; bounded WS queues; TURN expiry; recording deletion/share revocation |
| Expected load/concurrency | Findings 5, 7, 9, 13 | Measured concurrent meetings, restart/overload behavior, bounded auth work and media headroom |
| Missing tests | Finding 12 and missing acceptance evidence | Browser history/multitab/outage tests; real two-device captions/voice; clean images; restore/rollback |
| Speed | Per-RPC network verification is a potential dependency bottleneck; no measured latency regression asserted | Measure auth verification, DB pool utilization, join time and p95 speech pipeline stages before caching |
| Lean structure | Multiple deployment owners and obsolete/dormant implementations increase maintenance risk | Consolidate deployment support after compatibility checks; no line-count deletion estimate justified |

Useful protections actually found: parameterized SQL and tenant context wrapper; server-owned join roles; membership checks for active signaling RPCs; recording owner checks, bounded uploads, share markers, signed playback URLs and no-store API responses; caption validation, membership checks, provider timeout and bounded caption/translation caches; desktop `contextIsolation`, disabled Node integration, sandbox and same-origin media permission checks. These are source observations, not a certification or a complete security pass.

The admitted-waiting-peer helper passes `{}` to `joinPeerToRoom`, dropping authenticated user metadata while keeping the original connection's room/peer IDs. Participant commands still match the socket because those IDs were set when waiting. Treat identity preservation as a targeted regression to investigate; do not misreport it as all admitted peers becoming unable to act. Host reassignment on disconnect is explicit existing behavior; product ownership policy must decide whether it is intended before classifying it as a privilege-escalation flaw.

CVSS: assign a versioned vector only to a reproduced security vulnerability with confirmed reachability, privileges, interaction and impacts. Priorities above are engineering/release priorities, not CVSS severity scores. Scanner version/scores must remain labelled; this audit did not fabricate scores.

Verdict: repair outage-induced sign-out in both services, withdraw unsupported security claims, and establish one working authenticated intranet deployment before release. Bound and authenticate media/control work before exposing the service more broadly.

Not checked: live AWS/security groups/IAM/billing, running databases and migrations, provider accounts/keys, secret-history contents, every file/history, clean installs or image builds, desktop execution/signing, physical browser/device audio, real speech quality, production load/recovery, ISO certificates, intrusive Burp/Nessus testing or private InstaVC source. No code was changed by this audit. Test results from other agents must be attached separately and not attributed to this read-only pass.
