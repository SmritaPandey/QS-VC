# On-prem release evidence

| Check | Result |
|---|---|
| Fresh origin/main clone | Clean at 5943143. GitHub reported public visibility. |
| JavaScript tests | 708 passed. Five AI gateway tests passed separately. |
| ASR and MT pytest | ASR 13 passed. MT 4 passed. Tests used a Python 3.11 virtual environment and fake model backends. |
| AMD64 Caddy with Alpine update | zlib upgraded to 1.4-r0. Loopback negotiated X25519MLKEM768 with TLS 1.3 and rejected TLS 1.2. |
| Initial patched Caddy scan | FAILED. Critical zlib finding cleared. Three High Go dependency findings remained. |
| Caddy rebuilt with updated Go dependencies | PASS. No High/Critical Grype matches. Verified TLS 1.3 with X25519MLKEM768 and TLS 1.2 rejection on the rebuilt AMD64 image. |
| Redis AMD64 rebuild | PASS. No High/Critical Grype matches. |
| PostgreSQL AMD64 rebuild with updated gosu | PASS. No High/Critical Grype matches. Isolated database startup and SELECT 1 passed. |
| Original app image scans | Auth, meeting, recording, signaling and web passed on the initial images. The pinned SFU Trixie candidate starts its mediasoup worker but has 58 High matches marked wont-fix. |
| Original coturn AMD64 scan | FAILED. The replacement coturn 4.18 Alpine candidate reduced findings to four High SQLite matches with no fix version reported. TURN allocation and media acceptance remain untested. |
| coturn 4.19.0 built from source without SQLite or any database backend | PASS on an Ubuntu 24.04 build host (not yet as the Alpine image). Binary links only OpenSSL and libevent. Through `deploy/turn/start.sh`: shared-secret allocation and relay to the allowed SFU address worked with 0% loss; a private peer without `TURN_ALLOWED_SFU_IP` was refused (403); a wrong secret was refused. |
| coturn start-up flag | FIXED. coturn 4.17+ rejects `--no-dtls` and would not start with the old `start.sh` (this also affected the 4.18 candidate). `start.sh` now adds it only when the installed coturn supports it. |
| Rebuilt coturn image (Alpine 3.24) Grype scan | PASS 13 Nov (Mac build host, linux/amd64): 0 Critical, 0 High; no SQLite packages in the image. Container TURN allocation not yet run. |
| SFU on distroless runtime (`gcr.io/distroless/cc-debian12:nonroot`) | FAILED gate on 13 Nov: built, 2 Critical + 16 High (13 Debian 12 glibc/GCC-runtime won't-fix, 5 libssl3 with fixes not yet in the base). Replaced by the Wolfi Node runtime below. |
| SFU on Wolfi runtime (`cgr.dev/chainguard/node`) | Scan PASS 13 Nov: 0 Critical, 0 High, 0 Medium. Image runs `node` (package-script check). Worker start, health check and two-person call NOT RUN yet. |
| Signed release and target downloads | NOT RUN. Requires passing scans and production release keys. |
| Clean Rocky 9 installation and activation | NOT RUN. Requires guided installer and VM. |
| Appliance import and desktop packages | NOT RUN. Requires build and target platforms. |
| Polycom | NOT RUN. Requires lab endpoint and an installed deployment. |

Before publishing, use the release checklist. For device download acceptance,
download signed out on Windows, macOS and mobile and compare SHA-256. On Rocky 9
with egress blocked, verify the archive, install, check service health and join
a meeting. In the Poly lab, dial 1001 before a browser joins, verify both media
directions, then test unknown numbers, PIN, disabled endpoints and activation.

13 Nov full image gate (scan-run-1): auth, caddy, coturn, meeting, postgres, recording, redis, sfu, signaling and web all 0 Critical / 0 High. Bases: alpine:3.24@sha256:f59abe65…, node:22-bookworm-slim@sha256:e9f565d3…, cgr.dev/chainguard/node (digest in IMAGE-MANIFEST.txt). Not yet signed or staged.
