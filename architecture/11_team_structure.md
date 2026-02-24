# QS-VC: Team Structure

---

## 1. Organization Chart

```
                        ┌─────────────────┐
                        │ CEO / Founder   │
                        └────────┬────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌────────────────┐    ┌────────────────┐    ┌────────────────────┐
│ CTO            │    │ VP Product     │    │ VP Operations      │
│ (Chief Tech)   │    │                │    │ & Infra             │
└───────┬────────┘    └───────┬────────┘    └───────┬────────────┘
        │                     │                     │
   ┌────┴────┐           ┌────┴────┐           ┌────┴────┐
   │Eng Teams│           │Product  │           │DevOps/  │
   │(below)  │           │Design   │           │SRE/     │
   │         │           │QA       │           │Security │
   └─────────┘           └─────────┘           └─────────┘
```

---

## 2. Engineering Teams (Phase 1–2: ~70 engineers)

### Team Breakdown

| Team | Size | Focus | Tech Stack |
|---|---|---|---|
| **Media Engine** | 8 | SFU, WebRTC, SRTP, codec optimization, ABR | C++, Rust, Node.js |
| **Signaling & Networking** | 5 | WebSocket server, TURN/STUN, ICE, SIP gateway | Node.js, Go |
| **Platform Backend** | 8 | Meeting orchestration, scheduling, user mgmt, billing | Go, Java |
| **AI/ML** | 10 | STT, translation, NLP, noise suppression, auto-framing | Python, C++, CUDA |
| **Web Frontend** | 8 | React web client, WebRTC integration, whiteboard | TypeScript, React |
| **Desktop Client** | 4 | Electron app, native modules (noise cancel, camera) | TypeScript, Rust |
| **Mobile** | 6 | React Native (iOS + Android) | TypeScript, RN |
| **Security & Cryptography** | 5 | PQC implementation, E2EE, Vault, audit, compliance | Go, Rust, Python |
| **DevOps / SRE** | 5 | K8s, CI/CD, monitoring, infrastructure | Terraform, Helm, Go |
| **QA & Test Automation** | 6 | E2E testing, media quality testing, load testing | Python, Playwright |
| **Data & Analytics** | 3 | ClickHouse, analytics pipelines, QoS dashboards | Python, SQL |
| **Product & Design** | 4 | PM (2), UX Designer (1), UX Researcher (1) | Figma |
| **Total Phase 1–2** | **72** | | |

### Phase 3 Additions (+30)

| Team | Add | New Focus |
|---|---|---|
| **Media Engine** | +3 | SFU cascade, MCU, large meetings |
| **AI/ML** | +5 | Voice-to-voice, smart camera, summarization |
| **Security** | +3 | PQC migration, FedRAMP, govt compliance |
| **On-Prem / Edge** | +6 (new) | Air-gapped deployment, edge computing, room systems |
| **SIP / Interop** | +4 (new) | SIP/H.323 gateway, Polycom/Cisco interop |
| **Solutions Engineering** | +4 (new) | Customer onboarding, on-prem installation |
| **Support / Operations** | +5 (new) | 24/7 NOC, customer support |
| **Total Phase 3** | **~102** | |

### Phase 4 Scale (~150)

| Team | Notes |
|---|---|
| **All engineering teams** | +20% for scale & multi-region |
| **API / Developer Relations** | +4 (SDK, docs, partner integrations) |
| **International** | +6 (localization, regional compliance) |
| **AR/VR** | +5 (spatial computing, immersive meetings) |
| **Total Phase 4** | **~150** |

---

## 3. Key Leadership Roles

| Role | Responsibility | Ideal Background |
|---|---|---|
| **CTO** | Technical vision, architecture decisions, team building | 15+ yrs, WebRTC/real-time systems |
| **VP Engineering** | Execution, delivery, engineering excellence | 12+ yrs, scaled eng teams to 100+ |
| **Head of AI** | AI strategy, model selection, ML infrastructure | PhD/MS ML, experience with production AI |
| **Head of Security** | PQC strategy, compliance, security architecture | CISSP, PQC research background |
| **Head of Media** | SFU/MCU, codec optimization, media quality | 10+ yrs, Zoom/Webex/Obelit background |
| **Head of SRE** | Reliability, infrastructure, global operations | 10+ yrs, scaled to millions of users |
| **Head of Product** | Product roadmap, customer feedback, market fit | 10+ yrs, video conferencing domain |

---

## 4. Hiring Strategy

### Phase 1 Critical Hires (First 3 Months)

```
MUST HIRE FIRST:
1. Head of Media Engineering (SFU expert)
2. 3x Senior WebRTC Engineers
3. 2x Senior Go/Rust Backend Engineers
4. 2x AI/ML Engineers (STT specialist)
5. 1x Security Architect (PQC)
6. 2x Senior React Engineers
7. 1x DevOps Lead
8. 1x Product Manager

HIRING SOURCES:
• Ex-Zoom, Ex-Cisco Webex, Ex-Google Meet engineers
• PeopleLink / Obelit alumni (India domain expertise)
• IIT/NIT graduates with systems programming background
• Open-source contributors: mediasoup, Jitsi, Obelit
• PQC researchers from IITM, IISc, IIITD
```

---

## 5. Development Methodology

```
┌──────────────────────────────────────────────────────────┐
│ DEVELOPMENT PROCESS                                       │
│                                                           │
│ Methodology: SAFe (Scaled Agile Framework) — adapted     │
│                                                           │
│ Sprint: 2 weeks                                          │
│ PI (Program Increment): 5 sprints (10 weeks)             │
│ PI Planning: quarterly, all teams                        │
│                                                           │
│ Daily:                                                    │
│ • Standup (per team, 15 min)                             │
│ • Cross-team sync (leads, 30 min)                        │
│                                                           │
│ Weekly:                                                   │
│ • Architecture review (Thursday)                         │
│ • Security review (rotating)                             │
│ • Demo session (Friday)                                  │
│                                                           │
│ Sprint:                                                   │
│ • Planning (Monday Day 1)                                │
│ • Review + Retrospective (Friday Day 10)                 │
│                                                           │
│ Code Quality:                                            │
│ • PR review: 2 approvals required                        │
│ • Coverage: 80%+ for backend, 70%+ for frontend         │
│ • Security: SAST + DAST on every MR                     │
│ • Performance: media quality regression tests            │
└──────────────────────────────────────────────────────────┘
```
