# QS-VC: Phase-wise Roadmap

---

## Timeline Overview (36 Months)

```
Year 1                         Year 2                         Year 3
Q1    Q2    Q3    Q4          Q1    Q2    Q3    Q4          Q1    Q2    Q3    Q4
├─────┼─────┼─────┼───────────┼─────┼─────┼─────┼───────────┼─────┼─────┼─────┤
│◄─ PHASE 1 ──►│◄─ PHASE 2 ─────────►│◄─ PHASE 3 ─────────►│◄─ PHASE 4 ────►│
│  Foundation   │  Production MVP     │  Enterprise Scale    │  Global Domination
│  (6 months)   │  (9 months)         │  (9 months)          │  (12 months)    │
```

---

## Phase 1: Foundation (Months 1–6)

### Objective: Core platform with 1:1 and small group conferencing

| Month | Deliverable | Details |
|---|---|---|
| **M1–M2** | **Core Infrastructure** | K8s cluster setup, CI/CD pipeline, PostgreSQL/Redis, Vault |
| | mediasoup SFU | Single-node SFU, WebRTC transport, Simulcast |
| | Signaling Server | WebSocket + JSON-RPC, SDP exchange, ICE |
| | Auth Service | Keycloak + password/MFA, JWT issuance |
| **M3–M4** | **Web Client MVP** | React app: join, video grid (up to 9), mute/unmute, camera toggle |
| | Screen Sharing | Screen capture API, simulcast encoding |
| | Chat (basic) | In-meeting text chat, file sharing |
| | TURN/STUN | coturn cluster (India: Mumbai, Chennai) |
| **M5–M6** | **Recording (basic)** | Server-side composite recording (MP4) |
| | AI: Noise Suppression | RNNoise integration (client-side WASM) |
| | AI: Basic Captions | Whisper-medium STT, English only |
| | Admin Dashboard v1 | User management, meeting reports |

### Phase 1 Exit Criteria
- ✅ 1:1 and group calls (up to 25 participants) working
- ✅ Screen sharing functional
- ✅ Basic recording to cloud storage
- ✅ English captions with < 300ms latency
- ✅ CI/CD pipeline fully operational
- ✅ < 200ms audio latency (India region)

---

## Phase 2: Production MVP (Months 7–15)

### Objective: Feature parity with Zoom/Meet for SMB launch

| Month | Deliverable | Details |
|---|---|---|
| **M7–M8** | **SFU Cascade** | Multi-node SFU, support 100+ participants |
| | E2EE | Insertable Streams, SFrame encryption |
| | PQC: Hybrid TLS | Kyber + X25519 key exchange, Dilithium signatures |
| | Desktop App | Electron client (Windows, macOS, Linux) |
| **M9–M10** | **Meeting Features** | Waiting room, breakout rooms, raise hand, reactions |
| | Whiteboard | CRDT-based (Yjs), drawing, text, shapes |
| | Virtual Background | SegFormer model, blur + custom images |
| | Calendar Integration | Google Calendar, Outlook, CalDAV |
| **M11–M12** | **AI: Multi-language STT** | Hindi, Tamil, Telugu, Bengali, Marathi + 5 global |
| | AI: Translation | NLLB-200, real-time subtitle translation |
| | Live Streaming | RTMP → HLS/DASH via CDN |
| | PSTN Integration | SIP trunk, dial-in/dial-out |
| **M13–M15** | **Mobile Apps** | React Native (iOS + Android) |
| | Multi-tenant SaaS | Tenant isolation, billing, plans |
| | Admin Dashboard v2 | QoS monitoring, SLA tracking, analytics |
| | Compliance v1 | ISO 27001 audit prep, DPDP Act compliance |

### Phase 2 Exit Criteria
- ✅ 500+ participant meetings (SFU cascade)
- ✅ E2EE with PQC key exchange
- ✅ All core meeting features (breakout, whiteboard, recording)
- ✅ 12+ language STT + translation
- ✅ Mobile apps launched (App Store + Play Store)
- ✅ SaaS billing operational
- ✅ SOC 2 Type II audit initiated

---

## Phase 3: Enterprise & Scale (Months 16–24)

### Objective: Enterprise-grade platform, on-prem capability, full AI suite

| Month | Deliverable | Details |
|---|---|---|
| **M16–M18** | **On-Premise Deployment** | Air-gapped installer, Ansible playbooks, HSM integration |
| | AI: All Indian Languages | All 22 scheduled languages STT + translation |
| | AI: Meeting Summarization | LLaMA 3 summarization, action item extraction |
| | AI: Sentiment Analysis | Per-speaker emotion tracking |
| **M19–M21** | **SIP/H.323 Gateway** | Polycom, Cisco interop, FreeSWITCH bridge |
| | Room System Software | Embedded Linux + Qt, PTZ camera support |
| | AI: Voice-to-Voice | Full pipeline: STT → MT → TTS with voice cloning |
| | AI: Smart Camera | Auto-framing, person tracking, whiteboard mode |
| **M22–M24** | **Hybrid Deployment** | Edge nodes + cloud orchestration |
| | Global Expansion | US + EU regions, 100+ TURN PoPs |
| | Webinar Mode | 10K+ attendee webinars, Q&A, polls |
| | SSO/SCIM | SAML 2.0, OIDC, SCIM 2.0 directory sync |
| | Advanced Analytics | ClickHouse-powered, AI-driven insights |

### Phase 3 Exit Criteria
- ✅ On-premise deployment operational (bank/govt ready)
- ✅ All 22 Indian languages supported
- ✅ SIP/H.323 interop with major room systems
- ✅ Voice-to-voice translation functional
- ✅ Hybrid deployment model validated
- ✅ ISO 27001 certification achieved
- ✅ 10K+ participant webinars proven

---

## Phase 4: Global Dominance (Months 25–36)

### Objective: Global scale, quantum-safe maturity, market leadership

| Month | Deliverable | Details |
|---|---|---|
| **M25–M28** | **Full PQC Migration** | All certificates Dilithium, all key exchange Kyber, Q-TLS default |
| | FedRAMP Compliance | US government cloud authorization |
| | 100+ Language Support | Global language expansion |
| | API Marketplace | Third-party integrations, embeddable SDK |
| **M29–M32** | **AI: Advanced Features** | Real-time noise classification, speaker coaching, meeting insights |
| | 100K+ Broadcast | CDN-scale live events |
| | White-Label SDK | Embeddable video for third-party apps |
| | Edge AI Optimization | On-device AI for privacy-sensitive deployments |
| **M33–M36** | **Quantum Key Distribution** | QKD pilot with ISRO/DRDO (India govt) |
| | AR/VR Integration | Spatial meeting rooms (Meta Quest, Apple Vision) |
| | Digital Twin Rooms | Virtual room replicas of physical rooms |
| | Global PoP Expansion | 200+ edge nodes, 10+ regions |

---

## Milestone Summary

```
M6:   Foundation Complete → Internal alpha
M12:  Production MVP → Closed beta (100 orgs)
M15:  SaaS Launch → Public availability
M18:  On-Prem v1 → First bank/govt deployment
M24:  Enterprise Scale → 1M+ users target
M30:  Global Platform → International expansion
M36:  Market Leader → 10M+ users, full PQC
```
