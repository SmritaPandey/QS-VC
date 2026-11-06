# QS-VC On-Premises Delivery — Implementation Plan

Version 1.0 · 6 November 2026 · Owner: QS-VC engineering

> **For the coding agent (Codex, Cursor, Claude Code or similar).** This plan turns the `QS-VC-private` repository into a **release bundle** that a customer installs on their own intranet **without receiving the source repository**. Work phase by phase, in order. Every task names the files to touch and ends with acceptance checks. Do not change how the internet (`start-internet.js`) or AWS deployments behave. Never commit secrets, real keys, or real passwords. Run the existing tests after every phase (`npm test`, `services/asr` and `services/mt` pytest).

---

## 0. What the customer runs and what we must give them

**Customer environment (as told to us)**

- MCU server on **Rocky Linux** (assume Rocky Linux 9.x).
- **Airtel** link to a central **hub** (hub-and-spoke MPLS to branches).
- **Polycom** room devices that call using **assigned numbers**.
- A caller who dials a number lands **directly in the room assigned to that number** (no host action, no lobby).
- Their own **AI cloud / GPU servers** for captions, translation and AI minutes.
- Users on **Windows, Mac and Linux** desktops, plus plain browsers.

**What they receive (and only this)**

| Item | Form | Not included |
| --- | --- | --- |
| Server software | Signed container images (`.tar`), minified, no source maps | Git repo, TypeScript/Python sources, tests, build scripts |
| AI models | Pre-downloaded model archives | Our HF token / API keys |
| MCU (FreeSWITCH) | Container image **and** Rocky 9 RPMs + configs | Our build machine |
| Installer | `qsvcctl` command-line tool | — |
| Desktop apps | Windows `.exe`/`.msi`, macOS `.zip`, Linux `.rpm`/`.deb`/`.tar.gz` | Electron sources |
| Docs | Install, admin, Polycom, network, AI, troubleshooting (PDF + MD) | Internal audits, `Claude outputs/` |

**Honest limit to state to management:** container images can be unpacked. Bundling and minifying (Node) and compiling (Python) make the code hard to read and reuse, but they do not make it impossible. Real protection is the **licence agreement + signed licence file (Phase 9)**.

**Target layout of the bundle**

```
qsvc-onprem-<version>/
  INSTALL.pdf, INSTALL.md, RELEASE_NOTES.md, EULA.txt, THIRD_PARTY_NOTICES.txt
  SHA256SUMS, SHA256SUMS.sig, qsvc-release.pub
  qsvcctl                         # installer / admin tool (bash)
  images/                         # docker save archives
    qsvc-core-<ver>.tar           # auth, meeting, signaling, sfu, recording, web
    qsvc-ai-gpu-<ver>.tar         # asr (GPU), mt (GPU)
    qsvc-ai-cpu-<ver>.tar         # asr/mt CPU fallback
    qsvc-mcu-<ver>.tar            # freeswitch + drachtio
    third-party-<ver>.tar         # postgres, redis, minio, coturn, nginx, caddy, ollama (pinned digests)
  models/                         # whisper, indicconformer, indictrans2, LLM (optional)
  rpms/rocky9/                    # freeswitch + deps, for hosts that forbid containers
  compose/                        # core.yml, ai.yml, mcu.yml, single-box.yml
  config/                         # .env templates, nginx, Caddyfile, freeswitch templates, firewalld, devices.csv template
  clients/windows|macos|linux/    # installers + workspace.json.example
  docs/
```

---

## Phase 1 — Clean the repo of secrets and our identities (do first)

Nothing leaves our hands until this phase passes.

**Human tasks (not the agent):** rotate the Hugging Face token and OpenRouter key that were placed in `.env.example`; change the shared admin password; regenerate `certs/privkey.pem`.

**Agent tasks**

1. `.env.example`, `.env.production.example`: placeholders only (`HF_TOKEN=`, `MINUTES_LLM_API_KEY=`); `MINUTES_LLM_URL` example must end in `/api/v1`.
2. `services/auth/src/platform-admins.ts`: the built-in admin emails (madylabs, neurqai, smrita) must **not** apply in on-prem mode. Add `QSVC_DEPLOYMENT=onprem`; when set, admins come **only** from `QSVC_ADMIN_EMAILS`, and startup fails if it is empty.
3. `services/auth/src/enterprise-access.ts`, `frontend/web/src/lib/intranet-url.ts`: replace `qsvcmeet.com` defaults with config (`QSVC_PUBLIC_URL`, `VITE_DEFAULT_WORKSPACE_URL`). In on-prem builds the default must be empty so the app asks for the organisation address.
4. `services/signaling/src/translation.ts`: in on-prem mode the Google provider is disabled unless explicitly enabled; default provider = the bundled `mt` service.
5. Add a release guard `scripts/release/check-clean.cjs` that fails if the bundle staging folder contains: `.git`, `*.ts` sources, `*.map`, `.env` (non-template), `*.pem` private keys, `Claude outputs/`, `.venv*`, `docker-data/`, `node_modules` outside images, or strings matching `hf_[A-Za-z0-9]{20,}`, `sk-or-`, `Intranet26`.
6. Add to `.gitignore`: `Claude outputs/`, `.venv*/`, `docker-data/`, `certs/*.pem`, `release/`. (Removing them from history is a separate human decision; the bundle never contains them either way.)

**Acceptance:** `node scripts/release/check-clean.cjs <staging>` passes; auth refuses to start in on-prem mode without `QSVC_ADMIN_EMAILS`; web app with no workspace configured shows the organisation-address screen.

---

## Phase 2 — Product changes for "dial a number → land in the room"

Today the room address is a random UUID per meeting (`services/signaling/src/room-manager.ts` `uuidv4()`), every Poly call is parked in a lobby (`deploy/poly-bridge/freeswitch/dialplan/qsvc.xml` `qsvc_lobby`), and lobby events for rooms without a running bridge are dropped (`deploy/poly-bridge/src/index.ts`, `if (!rooms.has(e.room)) return`), leaving the caller parked forever. This phase fixes that.

### 2.1 Data model — new migration `db/migrations/015_room_numbers_and_devices.sql`

- `room_numbers`: `number` (text, unique, `^[0-9]{3,10}$`), `tenant_id`, `meeting_code` (stable), `display_name`, `pin_hash` (nullable), `auto_admit` (bool, default true), `max_participants`, `encryption` (`required|optional`), `created_by`, timestamps.
- `room_devices`: `id`, `tenant_id`, `name`, `model`, `protocol` (`sip|h323`), `extension` (unique, the device's own number), `sip_password_hash` + encrypted secret for FreeSWITCH directory export, `allowed_cidr`, `default_room_number` (FK), `enabled`, timestamps.
- Grants for `qs_meeting_app` only, matching the pattern in `003_service_database_access.sql`.

### 2.2 Persistent rooms in signaling

- `room-manager.ts`: add `getOrCreatePersistentRoom(meetingCode, opts)` that returns the live room for a stable meeting code, creating it with **no browser host** if needed (room owner = the `room_numbers.created_by` user; host controls go to the first signed-in owner/admin who joins).
- Empty-room teardown: a device-only room closes 60 s after the last participant (browser or device) leaves.
- New internal RPC (control-token protected, not exposed to browsers): `resolveDialedNumber(number) → { roomId, meetingCode, autoAdmit, pinRequired, encryption }`.
- Existing scheduled meetings are unchanged.

### 2.3 Bridge changes (`deploy/poly-bridge`)

- `sfuAdapter.ts`: add `resolveDialedNumber(number)` and `ensureBridge(roomId)` to the adapter interface.
- `index.ts` lobby handler: when a call arrives for a number:
  1. resolve number → room (unknown number → play "number not in service" and hang up);
  2. start the room bridge if it isn't running (`RoomBridge.start()`);
  3. if `autoAdmit` and the caller's IP/extension is a registered device → `fs.admit(uuid, roomId)` immediately;
  4. otherwise keep today's lobby flow (host admits).
- Keep `/rooms/:room/start` for the existing host-button flow.

### 2.4 FreeSWITCH dialplan and directory

- `freeswitch/dialplan/qsvc.xml`: new extension `qsvc_number` before `qsvc_lobby`: `^(\d{3,10})$` → `set qsvc_number=$1`, optional `play_and_get_digits` for PIN when `pinRequired`, then `park` (the bridge picks it up via ESL and admits). Keep the `##<room>` H.323 form.
- Device registration: add `freeswitch/directory/qsvc-devices.xml.tmpl` and a generator (`qsvcctl devices sync`) that writes one `<user id="<extension>">` per enabled device with its SIP password, `user_context=qsvc-rooms`, caller name. Alternative for later: `mod_xml_curl` against the meeting service.
- `sip_profiles/qsvc-poly.xml`: keep `auth-calls=true`; ACL bypass only for the device VLAN list.

### 2.5 Admin tools

- First release: CLI only — `qsvcctl rooms add|list|remove`, `qsvcctl devices import devices.csv|list|disable|sync`.
- Later: an Admin console page "Room numbers & devices" (see `claude/QS-VC_UIUX_plan.md`, Admin/NOC console).
- `config/devices.csv` template columns: `name,model,protocol,extension,ip_or_cidr,room_number,auto_admit`.

**Acceptance (lab):** with no browser in the meeting, a SIP Poly dials `1001` → joins room 1001 directly; a browser user opening the matching meeting code sees and hears it; a second device dialing `1001` joins the same room; an unknown number is rejected; a PIN-protected room asks for the PIN; existing host-button flow still works. Add unit tests in `services/signaling` and `deploy/poly-bridge`.

---

## Phase 3 — Build the release images (no source inside)

Create `scripts/release/` with one entry point `build-release.sh <version>`.

1. **Node services** (auth, meeting, signaling, sfu, recording, poly-bridge): add `Dockerfile.release` per service:
   - build stage: `esbuild` bundle of `src/index.ts` → single `server.js`, `--minify`, `--sourcemap=false`, `--legal-comments=none`; native deps (`mediasoup`, `pg-native` if used) kept as external `node_modules` installed with `--omit=dev`.
   - runtime stage: `node:20-slim` (mediasoup needs glibc), non-root user, only `server.js` + required `node_modules` + migrations SQL where needed.
2. **Web** (`frontend/web`): `vite build` with `build.sourcemap=false`; served by nginx image; runtime config via `/config.js` generated at container start from env (no rebuild per customer).
3. **Python AI services** (`services/asr`, `services/mt`): `Dockerfile.release` that compiles `app.py` with **Nuitka** (`--module` or standalone) or, minimum, ships only `.pyc` (`python -m compileall -b` then delete `.py`). GPU variant base `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`, CPU variant `python:3.11-slim`. Tests run against the compiled image.
4. **MCU image** `qsvc-mcu`: Debian 12 base, FreeSWITCH 1.10 from SignalWire repo (token used **only on our build machine**), `mod_conference mod_av mod_vpx mod_opus mod_sofia mod_event_socket mod_h26x`; mod_h323 built from source in a separate stage if Phase 6 decides H.323 is needed; drachtio as a second image. Runs with `network_mode: host`, so the Rocky host OS doesn't matter.
5. **Third-party images**: pin every image by digest (replace `minio:latest`, `coturn:latest`, etc.), `docker save` into `images/third-party-<ver>.tar`.
6. **Models**: script `scripts/release/fetch-models.sh` downloads Whisper large-v3-turbo + small, IndicConformer, IndicTrans2, and (optional) the minutes LLM for Ollama into `models/*.tar`; record each model's licence in `THIRD_PARTY_NOTICES.txt`.
7. Image labels: `org.qsvc.version`, `org.qsvc.build`; **no** `COPY . .` of the repo anywhere.
8. `SHA256SUMS` over the bundle, signed with our release key (`cosign sign-blob` or GPG); public key shipped as `qsvc-release.pub`.

**Acceptance:** `docker run --rm qsvc-signaling:<ver> sh -c 'find / -name "*.ts" -o -name "*.map" | grep -v node_modules'` returns nothing; `check-clean.cjs` passes on the extracted image filesystems; all images start and pass health checks.

---

## Phase 4 — Rocky Linux 9 MCU host without containers (option)

Some government IT teams forbid Docker on the MCU. Provide RPMs.

1. `scripts/release/rpm/` build in a `rockylinux:9` container: enable EPEL + CRB; build `libks`, `signalwire-c`, `sofia-sip`, `spandsp`, FreeSWITCH 1.10 with the module list above; package as RPMs with `fpm` or spec files; install prefix `/usr`, configs `/etc/freeswitch`.
2. Ship a systemd unit `freeswitch.service` (user `freeswitch`, `LimitNOFILE=100000`, real-time priority off by default).
3. `config/firewalld/qsvc-mcu.xml` service definition: TCP 5060, 5061, 1720, 8021 (ESL; restrict to the core server), UDP 5060, 16384–32768.
4. SELinux: start in enforcing; provide `semanage port` commands for non-default ports and a small policy module if denials appear (`audit2allow` output reviewed, not blanket).
5. drachtio: RPM is not standard — run it on the **core server** in a container (it belongs with the SFU anyway).

**Acceptance:** fresh Rocky 9 VM with no internet: `dnf install ./rpms/rocky9/*.rpm`, configs applied by `qsvcctl mcu configure`, `fs_cli -x status` OK, SELinux enforcing with no AVC denials during a test call.

---

## Phase 5 — The installer `qsvcctl`

A single bash script (no internet needed) in the bundle root. Supports **Rocky Linux 9** and **Ubuntu 22.04/24.04**; Docker CE or Podman 4+ (`podman compose`/`docker compose`).

| Command | Does |
| --- | --- |
| `qsvcctl preflight [core\|ai\|mcu]` | Checks OS, CPU, RAM, disk, ports free, container runtime, GPU + driver ≥ 535 + NVIDIA toolkit (ai role), SELinux/firewalld state, time sync, DNS, reachability to the other roles |
| `qsvcctl load` | Verifies `SHA256SUMS.sig`, then `docker load` of the needed image archives and model archives |
| `qsvcctl configure` | Interactive or `--answers answers.yml`: domain, server IPs (private MPLS addresses), TLS (customer CA cert or built-in internal CA), admin emails, AI node address, MCU address, SMTP (optional). Generates `.env` with random secrets (`JWT_SECRET`, `SFU_CONTROL_TOKEN` = `BRIDGE_API_TOKEN`, `FS_ESL_PASSWORD`, `DRACHTIO_SECRET`, DB/Redis/MinIO/TURN secrets, `ASR_API_KEY`, `MT_API_KEY`) |
| `qsvcctl up / down / status / logs <svc>` | Compose wrappers per role |
| `qsvcctl migrate` | Runs `db/migrate.js` inside the meeting image |
| `qsvcctl admin create` | Wraps `create-platform-admins.cjs`; password read from prompt, never from argv |
| `qsvcctl rooms …`, `qsvcctl devices …` | Phase 2.5 |
| `qsvcctl mcu configure` | Renders FreeSWITCH templates (`vars.xml`, ACLs, profiles, dialplan, directory) from `.env` |
| `qsvcctl netcheck --from-branch` | Run at a branch: tests TCP/UDP reachability to SFU, TURN, MCU, measures RTT/jitter/loss |
| `qsvcctl backup / restore` | Postgres dump, MinIO data, `.env`, FreeSWITCH configs, encrypted with a customer passphrase |
| `qsvcctl upgrade <bundle>` | Load new images, run migrations, rolling restart, keep previous images for `rollback` |
| `qsvcctl support-bundle` | Logs + versions + redacted `.env` (secrets replaced) for sending to us |

**Deployment roles**

- **core** (hub data centre): nginx, web, auth, meeting, signaling, sfu (+ poly-bridge mounted), recording, postgres, redis, minio, coturn, drachtio. Sizing start: 8 vCPU, 16 GB RAM, 200 GB SSD for ~100 concurrent users.
- **ai** (customer AI cloud / GPU): asr, mt, optional ollama, Caddy with IP allowlist (reuse `deploy/e2e/Caddyfile` with `route` ordering). 1 × GPU 24 GB recommended (16 GB minimum). Without a GPU: CPU images, or captions fall back to browser recognition.
- **mcu** (Rocky Linux server): FreeSWITCH (container or RPM). 4 vCPU / 8 GB per ~10 transcoded HD streams.
- **single-box** compose for labs and demos.

**Acceptance:** on clean VMs with networking limited to the lab subnet (no internet), the full sequence `preflight → load → configure → migrate → admin create → up` brings up all three roles; `status` all green; a browser meeting works.

---

## Phase 6 — Polycom integration package

1. **Decision gate (ask the customer, record in `config/answers.yml`):**
   - What MCU is on their Rocky server today: nothing yet (we supply FreeSWITCH), FreeSWITCH, Poly RMX/DMA, or another product?
   - Endpoint list: models, firmware, SIP or H.323.
   - Number plan (e.g. 4-digit rooms 1000–1999, device extensions 2000–2999) and any existing call control/gatekeeper.
2. **If we supply the MCU (default):** devices register to FreeSWITCH over SIP/TLS with their extension (Phase 2.4). Recommend switching HDX/Group Series to **SIP mode**; H.323-only devices need either mod_h323 (built in Phase 3.4, unencrypted, no H.239) or the customer's Poly DMA/RMX as the H.323 front end. Note the requirement for a gatekeeper if H.323 devices must dial by number.
3. **If the customer already has an MCU:** "trunk mode" — QS-VC rooms are reached over a SIP trunk to their MCU. Requires a new control adapter next to `deploy/poly-bridge/src/esl.ts` (interface `McuControl`: admit, kick, mute, list, dialOut) with an implementation for their product's API. Scope separately once the product is known.
4. **Docs** `docs/onprem/POLYCOM_SETUP.md`: per family (Group Series/HDX, Studio X/G7500, Trio C60) the exact menu path to set SIP registrar = MCU IP, user = extension, auth password, transport TLS, SRTP required, G.722 + H.264, H.323 settings; how to put room numbers in the device directory/speed dial; known limits (no H.239/BFCP content through FreeSWITCH, v1 composite includes browser tiles).
5. Run acceptance test AT-01 with `deploy/poly-bridge/scripts/verify-at01.sh` and fill `QSVC_Poly_Interop_Tracker.xlsx`.

---

## Phase 7 — Airtel hub-and-spoke network kit

`docs/onprem/NETWORK.md` + `config/network/`:

- **Topology:** core + MCU at the hub; AI node at the hub or customer AI cloud reachable over MPLS; branches reach the hub only.
- **Port matrix** (generated from compose files so it never drifts): HTTPS 443; SFU RTC UDP 40000–40100 (make range configurable and size it: ~2 ports per participant); TURN 3478 TCP/UDP + 49152–49200 UDP; SIP 5060/5061, H.323 1720, FreeSWITCH RTP 16384–32768; ESL 8021 and bridge RTP legs **only** core↔MCU; AI 8000/5000 or 443 via Caddy **only** core↔AI.
- **Addresses:** `SFU_ANNOUNCED_IP`, `BRIDGE_RTP_ANNOUNCED_IP`, FreeSWITCH `local_ip_v4` = private MPLS addresses; TURN only if a branch is behind NAT.
- **QoS request to Airtel:** real-time class; DSCP EF (46) for audio, AF41 (34) for video, preserved end to end. Add DSCP marking options to FreeSWITCH (`rtp-*` tos settings) and document OS-level marking for the SFU host.
- **Bandwidth calculator** (`config/network/bandwidth.xlsx` or table): per Polycom call 720p ≈ 1–1.5 Mbps, 1080p ≈ 2–4 Mbps, browser user ≈ 1.2 Mbps up / 2–3 Mbps down; branch link = peak concurrent calls × rate × 1.25.
- Router checklist: SIP ALG off; MTU/MSS clamping on the MPLS edge; SIP over TCP/TLS to avoid UDP fragmentation.
- `qsvcctl netcheck` (Phase 5) gives the branch IT team a pass/fail.

---

## Phase 8 — Desktop clients (Windows, Mac, Linux) and browsers

Electron app in `frontend/desktop` already targets NSIS (Windows), zip (macOS), tar.gz (Linux).

1. Add targets: Windows **MSI** (for GPO/SCCM deployment), Linux **rpm** (Rocky/RHEL desktops) and **deb**, keep tar.gz. AppImage optional.
2. On-prem build flavour: no default workspace URL; reads `workspace.json` next to the executable (Windows), in `/etc/qsvc/workspace.json` (Linux), or a managed preference (macOS `defaults`/configuration profile).
3. Signing: Windows Authenticode and macOS notarisation with **our** certificates when available; otherwise document SmartScreen/Gatekeeper steps (as in today's intranet guide). Customers may re-sign the MSI with their own certificate.
4. Installer checksums go into `SHA256SUMS`.
5. Browsers: Chrome/Edge/Firefox current versions work with no install; document that the site must be HTTPS with a certificate the PCs trust (customer CA pushed by GPO).
6. Replace `frontend/desktop/INTRANET_SETUP.md` content in the bundle with a **customer** version with no passwords and no vendor admin accounts.

**Acceptance:** install and two-person meeting tested on real Windows 11, macOS (Apple Silicon and Intel) and Rocky 9 / Ubuntu desktop.

---

## Phase 9 — Licence file and support (protects the product)

1. `services/auth`: verify a signed licence file `/etc/qsvc/license.json` (Ed25519 signature with our public key compiled in): customer name, tenant ids, max concurrent users, max room devices, enabled modules (ai, poly, recording), expiry. On failure: start in read-only/admin-only mode with a clear message, never silently break meetings in progress.
2. `scripts/release/issue-license.cjs` (stays in our repo only) to create licence files.
3. No phone-home: the intranet may be air-gapped. Usage counts are shown in the admin console and included in `support-bundle`.
4. Support process: customer sends `support-bundle` output; we reply with fixes as a new signed bundle (`qsvcctl upgrade`).

---

## Phase 10 — Documentation set in the bundle

Generate from `docs/onprem/*.md` to PDF in the build:

1. `INSTALL` — roles, sizing, preflight, offline install, first admin, TLS.
2. `ADMIN_GUIDE` — users, rooms/numbers, devices, recording, backups, upgrades.
3. `POLYCOM_SETUP` — Phase 6.
4. `NETWORK` — Phase 7.
5. `AI_SETUP` — reuse `docs/INTRANET_AI_PREREQUISITES.md` and `docs/MULTILINGUAL_CAPTIONS.md` (on-prem parts only); GPU driver + NVIDIA container toolkit on **Rocky 9 and Ubuntu**; CPU fallback; model choices.
6. `CLIENTS` — Phase 8.
7. `TROUBLESHOOTING` and `SECURITY` (ports, secrets, TLS/SRTP, E2EE vs MCU sessions are mutually exclusive per meeting).

Exclude: internal audits, gap assessments, `Claude outputs/`, AWS/Cloudflare/E2E Networks guides.

---

## Phase 11 — End-to-end acceptance before first delivery

Run on lab VMs that mirror the customer: core (Rocky 9), mcu (Rocky 9), ai (GPU, Ubuntu 22.04 or Rocky 9), a "branch" subnet behind a router with shaped bandwidth (512 kbps–4 Mbps, 1–5 % loss).

| # | Test | Pass when |
| --- | --- | --- |
| 1 | Offline install of all roles from the bundle | No internet access attempted; all health checks green |
| 2 | Bundle contains no source / secrets | `check-clean.cjs` on bundle and extracted images |
| 3 | Browser + Windows + Mac + Linux client meeting | 4 users, audio/video/screen share |
| 4 | Polycom dials room number, no browser present | Joins directly; browser joining later sees it |
| 5 | Two Polycoms + browsers in one room (AT-01) | All audio/video directions confirmed by people, tracker filled |
| 6 | PIN room, unknown number, disabled device | PIN prompted; rejected; rejected |
| 7 | Captions + translation via customer AI node | Hindi/English captions ≤ 1.5 s on GPU |
| 8 | Branch over shaped link | Usable 720p call at planned bandwidth |
| 9 | Backup → restore on a fresh core VM | Users, rooms, devices, recordings back |
| 10 | Upgrade to next bundle and rollback | Meetings work after both |
| 11 | Licence expired / wrong tenant | Admin-only mode, clear message |

---

## Order of work and rough effort

| Phase | Effort (1 engineer + agent) | Depends on |
| --- | --- | --- |
| 1 Clean secrets/identities | 1–2 days | — |
| 2 Numbers + direct room entry | 1.5–2 weeks | 1 |
| 3 Release images | 1 week | 1 |
| 4 Rocky 9 RPMs | 1 week (only if containers forbidden) | 3 |
| 5 `qsvcctl` installer | 1 week | 3 |
| 6 Polycom package | 1 week + customer decision | 2, 5 |
| 7 Network kit | 2–3 days | 5 |
| 8 Clients | 3–4 days (+ signing certs) | 1 |
| 9 Licence | 3–4 days | 3 |
| 10 Docs | 3–4 days, in parallel | all |
| 11 Acceptance | 1 week with lab devices | all |

**Open decisions to settle with the customer before Phase 6:** existing MCU product on Rocky (if any), endpoint models and SIP vs H.323, number plan and gatekeeper, whether containers are allowed on each server, GPU model in their AI cloud, and who signs the desktop installers.
