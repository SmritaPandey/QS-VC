# QS-VC: Phase 1 — Sprint-Level Project Plan
## Foundation (Months 1–6 / Sprints 1–13)

---

## Program Increment Overview

| PI | Sprints | Duration | Theme |
|---|---|---|---|
| **PI-1** | Sprint 1–5 | Weeks 1–10 | Core Infrastructure + Media Engine |
| **PI-2** | Sprint 6–10 | Weeks 11–20 | Web Client + Meeting Features |
| **PI-3** | Sprint 11–13 | Weeks 21–26 | AI Integration + Polish + Alpha |

---

## Epics

| ID | Epic | Owner Team | Sprints |
|---|---|---|---|
| **E1** | Infrastructure & DevOps Foundation | DevOps/SRE | S1–S3 |
| **E2** | SFU Media Engine (mediasoup) | Media Engine | S1–S5 |
| **E3** | Signaling Server | Signaling & Networking | S2–S4 |
| **E4** | Authentication & Identity | Platform Backend | S2–S4 |
| **E5** | Meeting Orchestrator | Platform Backend | S3–S6 |
| **E6** | TURN/STUN Infrastructure | Signaling & Networking | S3–S5 |
| **E7** | Web Client MVP | Web Frontend | S4–S9 |
| **E8** | Screen Sharing | Media Engine + Frontend | S7–S8 |
| **E9** | In-Meeting Chat | Platform Backend + Frontend | S6–S8 |
| **E10** | Recording (Server-Side) | Media Engine + Backend | S8–S10 |
| **E11** | AI: Noise Suppression | AI/ML | S9–S10 |
| **E12** | AI: Live Captions (English) | AI/ML | S9–S12 |
| **E13** | Admin Dashboard v1 | Web Frontend + Backend | S10–S12 |
| **E14** | Security Hardening & PQC Prep | Security | S5–S13 |
| **E15** | QA & Performance Testing | QA | S6–S13 |

---

## PI-1: Core Infrastructure + Media Engine (Sprints 1–5)

---

### Sprint 1 (Weeks 1–2): Project Bootstrap

#### E1 — Infrastructure

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E1-001 | Story | Set up GitLab monorepo with branch policies and CI templates | P0 | 5 | DevOps Lead |
| E1-002 | Story | Provision dev K8s cluster (EKS/GKE — India region) | P0 | 8 | DevOps |
| E1-003 | Story | Set up container registry (Harbor) with vulnerability scanning | P0 | 3 | DevOps |
| E1-004 | Story | Deploy PostgreSQL 16 (RDS) with dev/staging schemas | P0 | 5 | DevOps |
| E1-005 | Story | Deploy Redis 7 cluster (ElastiCache) | P0 | 3 | DevOps |
| E1-006 | Story | Set up HashiCorp Vault (dev instance) with basic secrets engine | P1 | 5 | DevOps + Security |
| E1-007 | Story | Create Terraform modules for base infrastructure | P1 | 8 | DevOps |
| E1-008 | Task | Define coding standards, PR review process, commit conventions | P0 | 2 | Tech Lead |
| E1-009 | Task | Set up Prometheus + Grafana for cluster monitoring | P1 | 3 | DevOps |

**Sprint 1 Capacity: 42 points**

---

#### E2 — Media Engine: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E2-001 | Spike | Evaluate mediasoup vs Ion-SFU vs Janus — benchmark test | P0 | 5 | Media Lead |
| E2-002 | Story | Set up mediasoup dev environment with single Worker | P0 | 5 | Media Eng |
| E2-003 | Story | Implement basic Router creation and WebRtcTransport factory | P0 | 8 | Media Eng |

---

### Sprint 2 (Weeks 3–4): Media Transport + Signaling Bootstrap

#### E2 — Media Engine

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E2-004 | Story | Implement Producer/Consumer lifecycle (audio + video) | P0 | 8 | Media Eng |
| E2-005 | Story | Configure Simulcast encoding (3 spatial layers) | P0 | 5 | Media Eng |
| E2-006 | Story | Implement DTLS/SRTP transport with AES-256-GCM | P0 | 5 | Media Eng |
| E2-007 | Story | Add bandwidth estimation (GCC) and REMB feedback | P1 | 5 | Media Eng |
| E2-008 | Task | Write unit tests for Router, Transport, Producer, Consumer | P0 | 3 | Media Eng |

#### E3 — Signaling Server: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E3-001 | Story | Create Node.js WebSocket server with JSON-RPC 2.0 protocol | P0 | 5 | Signaling Eng |
| E3-002 | Story | Implement connection lifecycle (auth, heartbeat, reconnect) | P0 | 5 | Signaling Eng |
| E3-003 | Story | Implement `joinRoom` / `leaveRoom` signaling handlers | P0 | 5 | Signaling Eng |
| E3-004 | Story | Implement `createTransport` / `connectTransport` handlers | P0 | 5 | Signaling Eng |

#### E4 — Auth: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E4-001 | Story | Deploy Keycloak instance, configure realm and client | P0 | 5 | Backend Eng |
| E4-002 | Story | Implement user registration + password login API | P0 | 5 | Backend Eng |

**Sprint 2 Capacity: 56 points (ramping up)**

---

### Sprint 3 (Weeks 5–6): End-to-End 1:1 Call

#### E2 — Media Engine

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E2-009 | Story | Implement dynamic Simulcast layer switching per consumer | P0 | 8 | Media Eng |
| E2-010 | Story | Add NACK + FEC (FlexFEC) for packet loss recovery | P1 | 5 | Media Eng |
| E2-011 | Story | Implement active speaker detection (audio energy analysis) | P1 | 5 | Media Eng |

#### E3 — Signaling Server

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E3-005 | Story | Implement `produce` / `consume` signaling handlers | P0 | 5 | Signaling Eng |
| E3-006 | Story | Implement room state broadcast (new producer, participant left) | P0 | 5 | Signaling Eng |
| E3-007 | Story | Add Redis PubSub for multi-instance signaling coordination | P1 | 5 | Signaling Eng |

#### E4 — Auth

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E4-003 | Story | Implement JWT token issuance with RS256 signing | P0 | 3 | Backend Eng |
| E4-004 | Story | Add MFA support (TOTP via authenticator app) | P1 | 5 | Backend Eng |
| E4-005 | Story | Implement session management with Redis-backed tokens | P0 | 3 | Backend Eng |

#### E5 — Meeting Orchestrator: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E5-001 | Story | Create Meeting Service (Go) — CRUD APIs for meetings | P0 | 8 | Backend Eng |
| E5-002 | Story | Implement meeting code generation (human-readable) | P0 | 2 | Backend Eng |

#### E6 — TURN/STUN: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E6-001 | Story | Deploy coturn server (dev — single instance) | P0 | 3 | Networking Eng |
| E6-002 | Story | Implement TURN credential generation (HMAC time-limited) | P0 | 3 | Networking Eng |

**Sprint 3 Goal: Achieve first 1:1 audio/video call between two browser tabs**

---

### Sprint 4 (Weeks 7–8): Multi-Party Calls + Auth Complete

#### E2 — Media Engine

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E2-012 | Story | Support multi-party rooms (up to 9 participants) | P0 | 8 | Media Eng |
| E2-013 | Story | Implement Last-N optimization (only forward top N active speakers' video) | P1 | 5 | Media Eng |
| E2-014 | Story | Add media statistics collection (bitrate, loss, jitter per stream) | P0 | 5 | Media Eng |

#### E3 — Signaling Server

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E3-008 | Story | Implement mute/unmute commands (host → participant) | P0 | 3 | Signaling Eng |
| E3-009 | Story | Implement raise hand / lower hand signaling | P1 | 2 | Signaling Eng |
| E3-010 | Story | Add connection quality monitoring + reporting to client | P1 | 3 | Signaling Eng |

#### E4 — Auth: Complete

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E4-006 | Story | Implement role-based access control (admin/host/user/guest) | P0 | 5 | Backend Eng |
| E4-007 | Story | Add API key management for programmatic access | P1 | 3 | Backend Eng |
| E4-008 | Story | Implement rate limiting per user/API key (Redis-based) | P1 | 3 | Backend Eng |

#### E5 — Meeting Orchestrator

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E5-003 | Story | Implement meeting scheduling with calendar invite generation | P0 | 5 | Backend Eng |
| E5-004 | Story | Add waiting room / lobby functionality | P0 | 5 | Backend Eng |
| E5-005 | Story | Implement meeting password protection | P0 | 3 | Backend Eng |

#### E6 — TURN/STUN

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E6-003 | Story | Deploy coturn cluster (Mumbai + Chennai) with GeoDNS | P0 | 5 | Networking Eng |
| E6-004 | Story | Configure TLS on TURN (port 443 for firewall bypass) | P0 | 3 | Networking Eng |
| E6-005 | Story | Implement ICE candidate gathering with fallback strategy | P0 | 3 | Networking Eng |

**Sprint 4 Goal: Multi-party calls (up to 9) with auth, waiting room, and TURN relay**

---

### Sprint 5 (Weeks 9–10): Scale to 25 Participants + Security Foundation

#### E2 — Media Engine

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E2-015 | Story | Scale single-node SFU to 25 participants with load testing | P0 | 8 | Media Eng |
| E2-016 | Story | Implement adaptive bitrate control per consumer | P0 | 5 | Media Eng |
| E2-017 | Task | Performance benchmarking: CPU, memory, bandwidth per participant | P0 | 3 | Media Eng |

#### E5 — Meeting Orchestrator

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E5-006 | Story | Implement SFU node selection (basic — single region) | P0 | 5 | Backend Eng |
| E5-007 | Story | Add meeting duration enforcement and auto-end | P1 | 3 | Backend Eng |
| E5-008 | Story | Implement host controls (mute all, lock meeting, end for all) | P0 | 5 | Backend Eng |

#### E14 — Security: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E14-001 | Story | Implement TLS 1.3 across all services with cert rotation | P0 | 5 | Security Eng |
| E14-002 | Story | Set up mTLS between microservices (Istio service mesh) | P0 | 8 | Security Eng |
| E14-003 | Story | Implement audit logging framework (structured, hash-chained) | P0 | 5 | Security Eng |
| E14-004 | Spike | PQC library evaluation — liboqs, pqcrypto-rs, Bouncy Castle PQC | P1 | 5 | Security Eng |

**Sprint 5 Goal: Stable 25-person meetings, mTLS service mesh, audit logging**

---

## PI-2: Web Client + Meeting Features (Sprints 6–10)

---

### Sprint 6 (Weeks 11–12): Web Client Foundation

#### E7 — Web Client MVP: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E7-001 | Story | Create React 18 + TypeScript project scaffold with Vite | P0 | 3 | Frontend Lead |
| E7-002 | Story | Implement design system: colors, typography, spacing, components | P0 | 8 | Frontend + UX |
| E7-003 | Story | Build pre-meeting screen (camera preview, device selector, join button) | P0 | 8 | Frontend Eng |
| E7-004 | Story | Implement WebRTC SDK wrapper (mediasoup-client integration) | P0 | 8 | Frontend Eng |
| E7-005 | Story | Build video grid layout (2x2, 3x3 responsive) | P0 | 5 | Frontend Eng |
| E7-006 | Story | Implement audio level meters on video tiles | P1 | 3 | Frontend Eng |

#### E9 — Chat: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E9-001 | Story | Create chat service (Node.js) with Redis Streams backend | P0 | 5 | Backend Eng |
| E9-002 | Story | Implement WebSocket chat message send/receive | P0 | 5 | Backend Eng |

#### E15 — QA: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E15-001 | Story | Set up Playwright E2E test framework for web client | P0 | 5 | QA Eng |
| E15-002 | Story | Create WebRTC test harness (simulated peers for load testing) | P0 | 8 | QA Eng |

---

### Sprint 7 (Weeks 13–14): Web Client Meeting Experience

#### E7 — Web Client

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E7-007 | Story | Build control bar (mute, camera, leave, reactions) | P0 | 5 | Frontend Eng |
| E7-008 | Story | Implement active speaker highlight + speaker view layout | P0 | 5 | Frontend Eng |
| E7-009 | Story | Build side panel (tabbed: Chat, People, Settings) | P0 | 5 | Frontend Eng |
| E7-010 | Story | Implement participant list with role badges and controls | P0 | 5 | Frontend Eng |
| E7-011 | Story | Add meeting info bar (title, duration timer, meeting code) | P0 | 3 | Frontend Eng |
| E7-012 | Story | Implement device settings modal (camera/mic/speaker selection) | P0 | 5 | Frontend Eng |

#### E8 — Screen Sharing: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E8-001 | Story | Implement screen capture Producer (getDisplayMedia API) | P0 | 5 | Media Eng |
| E8-002 | Story | Add screen share layout mode (content + thumbnails) | P0 | 5 | Frontend Eng |

---

### Sprint 8 (Weeks 15–16): Screen Share + Chat + Reactions

#### E7 — Web Client

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E7-013 | Story | Implement emoji reactions (floating animations) | P1 | 3 | Frontend Eng |
| E7-014 | Story | Build waiting room UI (host approval flow) | P0 | 5 | Frontend Eng |
| E7-015 | Story | Implement network quality indicator on video tiles (1–5 bars) | P1 | 3 | Frontend Eng |
| E7-016 | Story | Add dark mode support (system preference detection) | P1 | 3 | Frontend Eng |

#### E8 — Screen Sharing: Complete

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E8-003 | Story | Add annotation toolbar on shared screen (pointer, highlight) | P1 | 5 | Frontend Eng |
| E8-004 | Story | Implement content-optimized encoding for screen share (high res, low fps) | P0 | 5 | Media Eng |

#### E9 — Chat: Complete

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E9-003 | Story | Build chat UI (message list, input, emoji picker) | P0 | 5 | Frontend Eng |
| E9-004 | Story | Implement file sharing in chat (upload → S3/MinIO → share link) | P1 | 5 | Backend + Frontend |
| E9-005 | Story | Add chat message persistence to PostgreSQL (post-meeting access) | P1 | 3 | Backend Eng |
| E9-006 | Story | Implement @mentions with autocomplete | P2 | 3 | Frontend Eng |

#### E10 — Recording: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E10-001 | Spike | Evaluate GStreamer vs FFmpeg for server-side composite recording | P0 | 3 | Media Eng |
| E10-002 | Story | Implement PlainRtpTransport tap from SFU to recording pipeline | P0 | 8 | Media Eng |

---

### Sprint 9 (Weeks 17–18): Recording Pipeline + AI Bootstrap

#### E10 — Recording

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E10-003 | Story | Build GStreamer composite recording pipeline (grid layout → MP4) | P0 | 8 | Media Eng |
| E10-004 | Story | Implement recording start/stop API and signaling commands | P0 | 5 | Backend Eng |
| E10-005 | Story | Add recording indicator UI (red dot + notification) | P0 | 2 | Frontend Eng |
| E10-006 | Story | Store recordings to MinIO/S3 with encryption at rest | P0 | 5 | Backend Eng |

#### E11 — Noise Suppression: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E11-001 | Story | Compile RNNoise to WebAssembly (WASM) module | P0 | 5 | AI Eng |
| E11-002 | Story | Integrate RNNoise WASM into WebRTC audio pipeline (AudioWorklet) | P0 | 8 | AI Eng + Frontend |
| E11-003 | Story | Add noise suppression toggle in meeting settings UI | P0 | 2 | Frontend Eng |

#### E12 — Live Captions: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E12-001 | Story | Deploy Whisper-medium model on NVIDIA Triton (dev GPU instance) | P0 | 5 | AI Eng |
| E12-002 | Story | Build streaming audio pipeline (Opus → PCM → 500ms chunks) | P0 | 8 | AI Eng |

---

### Sprint 10 (Weeks 19–20): Recording Complete + AI Captions Pipeline

#### E10 — Recording: Complete

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E10-007 | Story | Implement recording playback page (video player + download) | P0 | 5 | Frontend Eng |
| E10-008 | Story | Build post-processing pipeline (transcode, thumbnail, encrypt) | P1 | 5 | Media Eng |
| E10-009 | Story | Add recording management API (list, download URL, delete) | P0 | 3 | Backend Eng |

#### E12 — Live Captions

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E12-003 | Story | Implement streaming STT with partial/final result handling | P0 | 8 | AI Eng |
| E12-004 | Story | Add speaker diarization alignment (label who said what) | P1 | 5 | AI Eng |
| E12-005 | Story | Implement caption distribution via WebSocket (captionUpdate messages) | P0 | 5 | AI Eng + Signaling |

#### E13 — Admin Dashboard: Start

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E13-001 | Story | Create admin web app scaffold (React, separate route group) | P0 | 3 | Frontend Eng |
| E13-002 | Story | Build user management page (CRUD, roles, status) | P0 | 5 | Frontend + Backend |
| E13-003 | Story | Build meeting history/reports page with filters | P0 | 5 | Frontend + Backend |

---

## PI-3: AI Integration + Polish + Alpha (Sprints 11–13)

---

### Sprint 11 (Weeks 21–22): Captions UI + Admin Analytics

#### E12 — Live Captions: Complete

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E12-006 | Story | Build caption overlay UI (bottom of video area, configurable size) | P0 | 5 | Frontend Eng |
| E12-007 | Story | Add caption settings (enable/disable, font size S/M/L/XL) | P0 | 3 | Frontend Eng |
| E12-008 | Story | Implement caption transcript persistence (save to DB) | P1 | 3 | Backend Eng |
| E12-009 | Task | Optimize Whisper inference latency to < 200ms per chunk | P0 | 5 | AI Eng |
| E12-010 | Task | Load test STT pipeline with 50 concurrent streams | P0 | 5 | AI Eng + QA |

#### E11 — Noise Suppression: Complete

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E11-004 | Task | Tune RNNoise parameters for Indian accent audio profiles | P1 | 3 | AI Eng |
| E11-005 | Task | Performance testing: CPU usage across device tiers | P0 | 3 | QA |

#### E13 — Admin Dashboard

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E13-004 | Story | Build real-time dashboard (active meetings, online users, SFU health) | P0 | 8 | Frontend Eng |
| E13-005 | Story | Implement QoS monitoring page (per-meeting quality metrics) | P1 | 5 | Frontend + Data |
| E13-006 | Story | Add meeting recordings management (list, play, delete) | P0 | 3 | Frontend Eng |

---

### Sprint 12 (Weeks 23–24): Integration Testing + Security Hardening

#### E14 — Security

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E14-005 | Story | Implement CSRF, XSS, and injection protections across all APIs | P0 | 5 | Security Eng |
| E14-006 | Story | Add content security policy (CSP) headers to web client | P0 | 3 | Security Eng |
| E14-007 | Story | Implement API input validation with JSON Schema on all endpoints | P0 | 5 | Security Eng |
| E14-008 | Story | Set up automated DAST scanning (OWASP ZAP) in CI pipeline | P0 | 5 | Security + DevOps |
| E14-009 | Story | Conduct threat modeling workshop and document findings | P0 | 3 | Security Eng |

#### E15 — QA & Testing

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E15-003 | Story | Write E2E tests: join meeting, audio/video, screen share, chat | P0 | 8 | QA Eng |
| E15-004 | Story | Write E2E tests: recording, captions, waiting room | P0 | 5 | QA Eng |
| E15-005 | Story | Load testing: 100 concurrent meetings / 1000 participants | P0 | 8 | QA Eng |
| E15-006 | Story | Media quality regression suite (MOS scoring, latency measurement) | P0 | 5 | QA Eng |
| E15-007 | Task | Cross-browser testing (Chrome, Firefox, Safari, Edge) | P0 | 5 | QA Eng |

#### E1 — DevOps

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| E1-010 | Story | Set up staging environment (mirror of prod) | P0 | 5 | DevOps |
| E1-011 | Story | Implement blue-green deployment strategy for SFU pods | P1 | 5 | DevOps |
| E1-012 | Story | Set up centralized logging (Loki/ELK) with correlation IDs | P0 | 5 | DevOps |

---

### Sprint 13 (Weeks 25–26): Alpha Release + Bug Fixes

#### All Teams — Alpha Polish

| ID | Type | Title | Priority | Points | Assignee |
|---|---|---|---|---|---|
| ALPHA-001 | Story | Implement meeting join via URL (no login required for guests) | P0 | 5 | Backend + Frontend |
| ALPHA-002 | Story | Add meeting invite email template with join link + dial-in | P1 | 3 | Backend Eng |
| ALPHA-003 | Story | Implement reconnection logic (auto-rejoin on network drop) | P0 | 8 | Frontend + Signaling |
| ALPHA-004 | Story | Add virtual background (basic blur only) | P1 | 5 | AI Eng + Frontend |
| ALPHA-005 | Story | Polish UI: loading states, error handling, empty states | P0 | 5 | Frontend Eng |
| ALPHA-006 | Story | Implement meeting end summary page (duration, participants, recording link) | P1 | 3 | Frontend Eng |
| ALPHA-007 | Task | Fix all P0/P1 bugs from Sprint 12 testing | P0 | 13 | All Teams |
| ALPHA-008 | Task | Performance audit: memory leaks, CPU profiling, network usage | P0 | 5 | All Teams |
| ALPHA-009 | Task | Documentation: API docs (OpenAPI), developer setup guide | P1 | 5 | Tech Lead |
| ALPHA-010 | Task | Internal alpha deployment + dogfooding kickoff | P0 | 3 | DevOps |

**Sprint 13 Goal: Internal alpha release — stable for daily team use**

---

## Phase 1 Exit Criteria Verification

| Criteria | Sprint | Verification Method |
|---|---|---|
| 1:1 and group calls (up to 25 participants) | S5 | Load test: 25-person meeting, 30-min stability |
| Screen sharing functional | S8 | E2E test: share screen, verify on receiver |
| Basic recording to cloud storage | S10 | E2E test: record, download, playback |
| English captions with < 300ms latency | S12 | Perf test: measure STT latency P95 |
| CI/CD pipeline fully operational | S12 | Verify: push → build → test → deploy in < 15 min |
| < 200ms audio latency (India region) | S12 | WebRTC stats: measure RTT between Mumbai clients |

---

## Velocity & Capacity Planning

| Metric | Value |
|---|---|
| **Sprint Length** | 2 weeks |
| **Team Size (Phase 1)** | ~40 engineers (subset of 72, ramping up) |
| **Avg Story Points per Sprint** | 55–65 |
| **Total Phase 1 Story Points** | ~780 |
| **Buffer** | 15% for unplanned work / bugs |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| mediasoup performance at 25+ users | Medium | High | Early load testing (S5), fallback to Janus |
| Whisper latency > 300ms | Medium | Medium | Model distillation, INT8 quantization, batch tuning |
| TURN relay bandwidth costs | Low | Medium | Deploy at ISP PoPs, negotiate peering |
| Hiring delays (Media Engine lead) | High | High | Start recruitment in parallel, consider contractors |
| Cross-browser WebRTC inconsistencies | Medium | Medium | Early Safari/Firefox testing, polyfill strategy |
| GPU shortage for AI inference | Low | High | Reserve capacity, support CPU fallback models |

---

## Dependencies

```
E1 (Infra)  ──► E2 (SFU needs K8s) ──► E7 (Web needs SFU)
    │                                        │
    ├──► E4 (Auth needs DB) ──► E5 (Orchestrator needs Auth)
    │                                        │
    ├──► E6 (TURN needs infra) ──────────────┘
    │
    └──► E12 (AI needs GPU nodes) ──► E7 (Web shows captions)

Critical Path:
E1 → E2 → E3 → E7 → E8/E9/E10 → E12 → ALPHA
```
