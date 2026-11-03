# QS-VC project and deployment audit

Review date: 1 November 2026. Read-only application review; no application code changed.

What this repo does: QS-VC combines a commercial website, browser meeting client, Electron desktop shell, and Node services for signaling, authentication, meetings, media forwarding, recording, and an intended intranet MCU. I assumed several employees joining concurrent meetings from separate LAN computers, plus an internet deployment with guests. The current source is a prototype with substantial integration gaps, not a verified enterprise conferencing deployment.

## Existing structure

| Location | Responsibility | Assessment |
|---|---|---|
| `frontend/web/src/pages/HomePage.tsx`, `PricingPage.tsx` | Public website | Shares the meeting application's build and routing. |
| `frontend/web/src/pages/Landing.tsx`, `PreMeeting.tsx`, `MeetingRoom.tsx` | Create, preview and join meetings | Main user flow; media negotiation currently inconsistent with the server. |
| `ScheduleMeeting.tsx`, `AdminDashboard.tsx`, `RecordingPlayback.tsx` | Scheduling and operations | Backend contracts and access controls incomplete. |
| `frontend/web/src/components` | Meeting controls and optional features | Many features exist as components without integration into the active meeting page. File presence is not proof a feature works. |
| `frontend/web/src/lib` | Media, signaling, recording, AI and encryption helpers | Several helpers are disconnected from the main flow. |
| `frontend/desktop` | Electron wrapper | Outside root workspaces and root build; requires a separate release path. |
| `services/signaling` | WebSocket room membership and host commands | In-memory room state; also duplicates meeting creation APIs. |
| `services/sfu` | mediasoup media forwarding | Substantial implementation, but compilation and connection issues block deployment. |
| `services/auth` | Registration, login, JWT, TURN credentials | Database-backed; tenant login ambiguity and permissive registration. |
| `services/meeting` | Persistent scheduling, participants and chat | Also optionally embeds signaling; authorization incomplete. |
| `services/recording` | Recording metadata and MinIO upload/download | No caller authentication or ownership checks. |
| `services/mcu` | Intended composition and room-system bridge | State-management scaffold; actual composition and gateway listeners absent. |
| `shared` | Validation and cryptography | Not consistently reused by production handlers and tests. |
| `db` | SQL schema and migration runner | Tenant isolation and migration bootstrapping need correction. |
| `nginx`, Compose, Render, Vercel | Deployment options | Different assumptions and incompatible build/network paths. |
| `architecture`, `docs`, `marketing` | Design, manuals and sales assets | Describe intended capabilities beyond the implemented runtime. |

## Deployment modes as implemented

| Mode | What starts | Material gap |
|---|---|---|
| `npm run local` | Signaling and Vite | No SFU, auth, persistent meeting service or recording service. |
| `npm run internet` | Signaling, Vite and Cloudflare tunnel | Same omissions; tunnel binary path is Windows-specific. |
| `npm run intranet` | Signaling, MCU and Vite | No SFU; MCU does not process media; LAN URLs use HTTP. |
| `npm run dev` | SFU, signaling, auth, meeting, recording and Vite | Vite routes all generic `/api` calls to signaling; MCU excluded. Infrastructure is started separately. |
| Compose | Infrastructure and five application services plus web | Docker build contexts and SFU networking are inconsistent. MCU absent. |
| Render blueprint | Auth, meeting, signaling and database | No SFU, TURN or recording/storage deployment in this blueprint. |
| Vercel | Static frontend and guest-code function | Does not provide the WebSocket or media backend itself. |

## Must fix

1. **The signaling and SFU services fail compilation.** (`services/signaling/src/index.ts:59`, `services/signaling/src/rpc/handler.ts:643`, `services/sfu/src/index.ts:39`)
   - **What this is:** These services carry room control and meeting media.
   - **Problem:** Local TypeScript checks report 7 signaling errors and 11 SFU errors. They include missing config fields, a nonexistent `broadcastToPeers` method, incompatible role names, Zod record signatures and route parameter types.
   - **Fix:** Repair these contracts against the installed dependencies and use the same checks in every deployment build.
   - **If we skip it:** Root builds and Docker stages that compile these services fail.

2. **The browser sends a join request the server rejects.** (`frontend/web/src/pages/MeetingRoom.tsx:72`, `services/signaling/src/rpc/handler.ts:28`)
   - **What this is:** The initial room join supplies the client's supported media formats.
   - **Problem:** The browser sends `rtpCapabilities: null`; the server accepts an optional record, not null. Even omitting the field leaves no later update of the peer's capabilities before `consume` uses them.
   - **Fix:** Agree on a two-step capability handshake: load the device from router capabilities, then register actual client capabilities before consuming.
   - **If we skip it:** Joining fails validation, or receiving other participants' media fails afterward.

3. **Guests can request host privileges.** (`services/signaling/src/rpc/handler.ts:76`, `services/signaling/src/rpc/handler.ts:766`)
   - **What this is:** Host privileges allow muting, removing people and ending meetings.
   - **Problem:** `joinRoom` accepts `role: 'host'` or `'co-host'` from the caller and stores it. The handler does not use the verified identity; the first arrival also becomes host without checking the scheduled owner.
   - **Fix:** Derive privileges from server-owned meeting ownership and validated invitations; ignore caller-supplied privileged roles.
   - **If we skip it:** An invited guest can obtain meeting control.

4. **Recording APIs allow unauthenticated reads and writes.** (`services/recording/src/index.ts:124`, `services/recording/src/index.ts:244`)
   - **What this is:** These endpoints create recordings, replace content and issue download links.
   - **Problem:** No authentication or meeting/tenant ownership check protects any recording route. A caller knowing a recording ID can request its signed download link or upload replacement content.
   - **Fix:** Authenticate callers, derive tenant identity from verified credentials and enforce meeting access before storage operations.
   - **If we skip it:** Meeting recordings can be disclosed or altered by unauthorized callers.

5. **Meeting APIs lack ownership checks.** (`services/meeting/src/index.ts:322`, `services/meeting/src/index.ts:388`, `services/meeting/src/index.ts:407`)
   - **What this is:** These APIs change meeting state and persist attendance and chat.
   - **Problem:** Any valid token can change a known meeting ID's status without a host or tenant filter. Chat reads/writes and attendance changes have no authentication at all.
   - **Fix:** Apply meeting-scoped authorization to each route, including verified guest membership where guests are allowed.
   - **If we skip it:** Callers can end other users' meetings, read chat or falsify attendance.

6. **The E2EE indicator does not represent active encryption.** (`frontend/web/src/pages/MeetingRoom.tsx:242`, `frontend/web/src/lib/e2ee.ts:185`, `shared/crypto/pqc.ts:428`)
   - **What this is:** The meeting displays a permanent E2EE badge and the product advertises quantum-safe encryption.
   - **Problem:** The active meeting and media paths never instantiate `E2EEManager` or install its transforms. The PQC helper references an unshipped `/pqc/liboqs.js`, falls back to classical algorithms and still returns `nistCompliant: true`.
   - **Fix:** Immediately make security claims reflect measured runtime state. Ship and verify actual key exchange and frame encryption before displaying E2EE or quantum-safe status.
   - **If we skip it:** Users receive security assurances the implemented flow does not establish.

7. **The dormant encryption helper reuses sender IVs.** (`frontend/web/src/lib/e2ee.ts:61`, `frontend/web/src/lib/e2ee.ts:119`)
   - **What this is:** Each participant derives an epoch key from the same meeting key and counts frames locally.
   - **Problem:** Two participants using the same meeting key both begin at epoch 0 and counter 1, producing the same AES-GCM key and IV. At epoch 256, decryption also reconstructs the IV using the truncated one-byte key ID instead of the full epoch.
   - **Fix:** Use a reviewed frame-encryption design with sender-specific keys or nonce namespaces, authenticated headers and coordinated epoch changes; test multiple senders and epoch rollover before integration.
   - **If we skip it:** Connecting this helper would introduce unsafe encryption and long-meeting decryption failures. This is a latent issue, separate from the current lack of E2EE integration.

8. **Intranet MCU media and gateway features are placeholders.** (`services/mcu/src/index.ts:256`, `services/mcu/src/index.ts:307`, `services/mcu/src/index.ts:404`)
   - **What this is:** The intranet launcher advertises composition, recording and SIP/H.323 support.
   - **Problem:** Composition only logs a message; recording only builds a filename. Join returns a stream URL with no matching GET stream route. Gateway status is static metadata, without SIP/H.323 listeners. Signaling still calls the SFU, not the MCU.
   - **Fix:** Label these features unavailable until implemented. For working LAN browser meetings, run the SFU; add a real media bridge only when room-system support is required.
   - **If we skip it:** Intranet startup can report success while providing no remote video or legacy endpoint bridge.

9. **The intranet launcher exposes an unusable camera origin.** (`start-intranet.js:154`, `frontend/web/src/pages/PreMeeting.tsx:21`)
   - **What this is:** Employees open the printed LAN address from another computer.
   - **Problem:** The launcher prints `http://<LAN-IP>:5173`, while the client directly requires browser camera/microphone APIs. This is not the localhost origin used in single-machine development.
   - **Fix:** Serve the LAN app over HTTPS with a certificate trusted by client devices, and use WSS for signaling.
   - **If we skip it:** Remote LAN browsers cannot reliably enter the media flow.

10. **Docker build contexts disagree with Dockerfile inputs.** (`docker-compose.yml:140`, `services/meeting/Dockerfile:6`, `.github/workflows/ci.yml:64`)
   - **What this is:** Compose and CI build the same services using different source roots.
   - **Problem:** Both Compose files give the meeting image `services/meeting` as context, but its Dockerfile copies `services/signaling/...` and `services/meeting/...` from the repository root. Conversely, CI gives the root context to service-local Dockerfiles that copy plain `package.json` and `src/`.
   - **Fix:** Choose a consistent context per Dockerfile and update Compose and CI together. The web service also needs an accessible lockfile for `npm ci`.
   - **If we skip it:** Images fail to build or use the wrong package manifest.

11. **SFU networking is inconsistent in both Compose modes.** (`docker-compose.yml:88`, `docker-compose.yml:100`, `docker-compose.prod.yml:120`, `docker-compose.prod.yml:130`)
   - **What this is:** Signaling calls the SFU's internal HTTP API before creating media transports.
   - **Problem:** Development signaling calls its own container's `localhost:4000`, while the SFU uses host networking. Production calls `sfu:4000`, but the host-networked SFU does not join the Compose bridge under that service address.
   - **Fix:** Use one deliberate networking arrangement with a reachable internal SFU URL, correct advertised media address and explicit media ports.
   - **If we skip it:** Signaling falls back to a room with no media relay.

12. **API routing and frontend environment configuration disagree.** (`frontend/web/vite.config.ts:11`, `docker-compose.prod.yml:239`, `frontend/web/Dockerfile:10`)
   - **What this is:** Browser requests must reach the correct service in development and production.
   - **Problem:** Vite's broad `/api` proxy precedes and captures `/api/mcu` and `/api/gateway`; auth and recording also go to signaling. Production supplies `VITE_*` values only to the final static Nginx container, after Vite has built the bundle. Several callers append `/api/...` to values already containing that path.
   - **Fix:** Prefer same-origin API paths through an explicit proxy route table. Otherwise supply origin-only frontend settings at build time and put specific proxy prefixes first.
   - **If we skip it:** MCU, auth, scheduling, admin or recording requests reach the wrong path or service.

13. **Scheduled meeting restrictions never reach live room admission.** (`frontend/web/src/pages/ScheduleMeeting.tsx:98`, `services/signaling/src/index.ts:65`, `services/signaling/src/rpc/handler.ts:81`)
   - **What this is:** Scheduling offers waiting-room, encryption, participant-limit and recording options.
   - **Problem:** The scheduling page sends no bearer token, while the persistent endpoint requires one. The signaling alternative returns a meeting object without storing it; live room creation uses defaults and never loads the saved meeting. Password, invitees and recurrence details are not sent by the form.
   - **Fix:** Use the persistent meeting service as the authority and load its ownership/settings during signaling admission. Either implement the omitted scheduling fields or remove those controls.
   - **If we skip it:** Scheduling fails or appears successful while its restrictions and invitations have no effect.

14. **Database isolation does not match the tenant model.** (`db/migrations/001_initial_schema.sql:148`, `services/auth/src/index.ts:222`)
   - **What this is:** Multiple organizations share one database.
   - **Problem:** Policies depend on `app.current_tenant`, but application connections never set it. Owner/superuser connections bypass ordinary row policies; restricted connections instead encounter missing context, and chat/participant tables have no policies. Login selects by email alone although uniqueness is per tenant.
   - **Fix:** Use a deliberate least-privilege database role and transaction-scoped tenant context with complete policies, alongside route authorization. Include tenant identity in login, or make email globally unique.
   - **If we skip it:** Tenant isolation is ineffective under the default owner role, and changing database privileges can break normal requests. Duplicate emails can make the intended tenant account inaccessible.

15. **Host commands and waiting-room admission are disconnected from the active UI.** (`services/signaling/src/rpc/handler.ts:334`, `services/signaling/src/rpc/handler.ts:436`, `frontend/web/src/pages/MeetingRoom.tsx:127`)
   - **What this is:** Signaling emits admission, forced-mute, role and meeting-ended notifications.
   - **Problem:** The active meeting page subscribes only to a small set of presence/chat/media events. It assumes a full join response even when the server returns `status: 'waiting'`; admission later supplies no UI continuation. Host mute emits `forceMute`, which this page never handles.
   - **Fix:** Implement explicit waiting/admitted/active/ended states, wire the relevant notifications and enforce media restrictions on the server where required.
   - **If we skip it:** Waiting-room users cannot complete the normal join flow and host controls can appear successful without changing participant behavior.

## Should fix

16. **Passing tests do not exercise the broken application paths.** (`services/auth/src/validation.test.ts:8`, `services/signaling/src/validation.test.ts:1`, `vitest.config.ts:5`)
   - **What this is:** Six test files currently pass 128 tests.
   - **Problem:** Tests largely redefine schemas or models locally rather than exercising deployed handlers. They pass alongside compilation failures, an invalid browser join payload and missing authorization.
   - **Fix:** Import actual shared schemas and add focused integration tests for join/consume, host escalation, cross-tenant access, scheduling and recording downloads.
   - **If we skip it:** The green test result continues to miss release-blocking failures.

17. **Preview camera streams survive navigation.** (`frontend/web/src/pages/PreMeeting.tsx:21`, `frontend/web/src/pages/MeetingRoom.tsx:148`)
   - **What this is:** Preview acquires media before the meeting acquires another stream.
   - **Problem:** The preview cleanup closes over the initial null `stream` because its effect has no dependencies. The meeting effect cleanup also does not stop its acquired local stream on general unmount; explicit Leave is the separate path that stops it. Device selectors have no change handlers.
   - **Fix:** Track the acquired stream in an effect-local variable or ref and stop it on every exit, including late acquisition; pass selected device IDs into media constraints.
   - **If we skip it:** Cameras/microphones can stay active after navigation and selected devices are ignored.

18. **The admin page calls nonexistent backend endpoints.** (`frontend/web/src/pages/AdminDashboard.tsx:101`, `frontend/web/src/pages/AdminDashboard.tsx:114`)
   - **What this is:** The dashboard tries to list users and recordings and poll service health.
   - **Problem:** Auth has no `GET /api/auth/users`; recording has no `GET /api/recordings`. Its signaling health URL can also be built from a `ws://.../ws` value, which is not an HTTP base. The `/admin` page has no route-level role gate.
   - **Fix:** Implement only the required admin APIs with server-side administrator checks and matching response shapes; gate the page and use explicit HTTP health routes.
   - **If we skip it:** Operators see incomplete or misleading data. Adding a frontend gate alone would not secure backend operations.

19. **Restarts and multiple signaling replicas lose or split rooms.** (`services/signaling/src/room-manager.ts:70`, `services/signaling/src/index.ts:68`, `services/sfu/src/mediasoup/cascade-manager.ts:77`)
   - **What this is:** Live room state belongs to one process; Redis appears in configuration.
   - **Problem:** The room maps are not shared or persisted. Cascade selection, room assignment and heartbeat-monitor methods have no production callers outside their definitions. Adding replicas does not establish shared membership or working distributed media routing.
   - **Fix:** First explicitly support one signaling instance and persist scheduled meetings. Add room affinity and tested inter-instance coordination only when multiple instances are required.
   - **If we skip it:** Restarts lose live state; users with the same meeting code can land in separate rooms across instances.

20. **Migration startup paths do not agree.** (`db/migrate.js:13`, `db/migrate.js:34`, `docker-compose.yml:20`)
   - **What this is:** Fresh database initialization and subsequent migrations both apply SQL files.
   - **Problem:** Docker automatically runs the initial schema but does not record it in `_migrations`; the migration runner subsequently tries its non-idempotent `CREATE TABLE` statements again. The runner also ignores `DATABASE_URL`, does not load `.env`, and defaults to port 5432 while development Compose publishes 5434.
   - **Fix:** Use one migration owner and shared database configuration. Ensure initial bootstrap records the migration, or let the runner perform initialization itself.
   - **If we skip it:** The documented quick-start migration step fails against a fresh Compose database or connects to the wrong database.

## Recommended structure for websites and intranet services

Keep the existing monorepo and service boundaries initially. Resolve contracts before moving folders. Public pages and the meeting app can remain in one React build; separate them only if they need independent releases or hosting.

```text
Public visitors / employees
          |
     HTTPS entry point
          |
          +-- /, /pricing                public website
          +-- /app, /meeting/*            meeting client
          +-- /admin                      authenticated admin page
          +-- /api/auth/*                 auth service
          +-- /api/meetings/*             meeting service
          +-- /api/recordings/*           recording service
          +-- /ws                         signaling service
                                                 |
                                        private SFU control API
                                                 |
Clients <----------- WebRTC media -------------- SFU
     \--------------- TURN when needed ----------/

Private data network: PostgreSQL and MinIO
Optional, implemented separately: MCU and SIP/H.323 bridge
```

Suggested configuration organization once runtime issues are fixed:

```text
frontend/web/          existing public website and application
frontend/desktop/      separately built desktop client
services/             existing services; mark unfinished MCU unavailable
shared/               schemas and types imported by handlers and tests
db/                   one migration workflow
deploy/
  compose.base.yml    common service definitions
  compose.dev.yml     local-only infrastructure bindings and development UI
  compose.intranet.yml trusted HTTPS, LAN media address, internal services
  compose.internet.yml public HTTPS, public media address, TURN
docs/
  deployment-matrix.md implemented capabilities and required services
```

This is a proposed organization, not a directory migration performed by this review. Intranet and internet deployments should share application contracts and differ through deployment configuration. Reserve port 4002 for auth and give any real MCU a distinct port. Keep PostgreSQL, Redis, MinIO administration and media-control APIs private. For air-gapped operation, package fonts/icons locally and replace public speech/translation/STUN dependencies with internal services or disable those features.

## Verification and limits

- Inspected the tracked-file inventory (160 tracked files), README, workspace configuration, launchers, deployment definitions, CI, schema/migration runner and main website/application entry points.
- Read the primary auth, meeting, recording, signaling, SFU and MCU paths; traced browser join, media capability negotiation, scheduling, host controls and recording authorization. Searched feature call sites to distinguish connected paths from helpers.
- Executed the existing suite: **6 test files, 128 tests passed**.
- Executed TypeScript checks without emitting builds: **auth, meeting, recording, MCU and web passed; signaling failed with 7 errors; SFU failed with 11 errors** using the dependencies already installed locally.
- The pre-existing `package-lock.json` modification was preserved. This audit did not install dependencies or change application files.
- This is not a claim that every line of every file was read. Secondary UI components, all architecture prose, marketing PDF/PPTX content, CSS, dependency internals and generated/binary assets were not exhaustively reviewed. No smaller findings are counted or claimed beyond the 20 listed.
- Not checked: live deployment state, certificate trust/expiry, real browser rendering/accessibility, multi-device audio/video, SIP/H.323 hardware, Docker image builds, database execution, actual recording upload/download, internet connectivity or load limits. No secrets were reproduced in this report.

Verdict: Fix compilation, browser join, privileges and recording access first. Use the SFU for a verified two-device LAN call before expanding intranet features. Do not present the current MCU or quantum-safe claims as working production capabilities.
