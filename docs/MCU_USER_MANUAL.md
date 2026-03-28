# QS-VC MCU-Based Video Conferencing — User & Operations Manual

**Quantum-Safe Enterprise Video Conferencing — MCU (Multipoint Control Unit) Edition**
Version 1.0.0 | March 2026

---

## Table of Contents

1. [Introduction & Overview](#1-introduction--overview)
2. [MCU vs SFU — When to Use MCU](#2-mcu-vs-sfu--when-to-use-mcu)
3. [System Architecture](#3-system-architecture)
4. [Prerequisites & Hardware Requirements](#4-prerequisites--hardware-requirements)
5. [Installation & Setup](#5-installation--setup)
6. [Configuration Reference](#6-configuration-reference)
7. [Starting the MCU Platform](#7-starting-the-mcu-platform)
8. [User Guide — Joining Meetings](#8-user-guide--joining-meetings)
9. [User Guide — SIP/H.323 Endpoints](#9-user-guide--siph323-endpoints)
10. [User Guide — Meeting Controls & Layouts](#10-user-guide--meeting-controls--layouts)
11. [Recording & Live Streaming](#11-recording--live-streaming)
12. [Admin Guide — MCU Management](#12-admin-guide--mcu-management)
13. [API Reference](#13-api-reference)
14. [Security & Encryption](#14-security--encryption)
15. [Network & Firewall Configuration](#15-network--firewall-configuration)
16. [Air-Gapped / On-Premise Deployment](#16-air-gapped--on-premise-deployment)
17. [Production Deployment (Docker)](#17-production-deployment-docker)
18. [Troubleshooting](#18-troubleshooting)
19. [Appendix — Supported Endpoints](#19-appendix--supported-endpoints)

---

## 1. Introduction & Overview

QS-VC MCU Edition is the **enterprise/intranet variant** of the QS-VC Quantum-Safe Video Conferencing Platform. It is designed for **secured deployments** within organizations such as banks, government agencies, defence establishments, and large enterprises that require:

- **Private network operation** (MPLS VPN / IPSec VPN / LAN) — no public internet
- **Legacy endpoint support** (SIP/H.323 room systems — Polycom, Cisco, etc.)
- **Server-side video composition** — single composite stream per participant
- **Bandwidth efficiency** — MCU transcodes and composes centrally
- **On-premise recording** with tamper-proof audit logging
- **Quantum-safe encryption** (CRYSTALS-Kyber-1024 + Dilithium-5)
- **Air-gapped deployment** capability

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Video Composition** | Grid, speaker, presentation, spotlight, and filmstrip layouts |
| **Audio Mixing** | Multipoint audio bridge with server-side mixing |
| **Transcoding** | H.264/H.265/VP8/VP9/AV1 ↔ any codec conversion |
| **SIP Gateway** | Connect SIP-based room systems and desk phones |
| **H.323 Gateway** | Connect legacy H.323 video conferencing hardware |
| **RTMP Ingest** | Live stream to external platforms |
| **Composite Recording** | Server-side MP4 recording of composed video |
| **500 Participants/Room** | Up to 500 participants per MCU room |
| **100 Concurrent Rooms** | Up to 100 simultaneous MCU rooms per instance |
| **Quantum-Safe E2EE** | Kyber-1024 + X25519 hybrid key exchange |

---

## 2. MCU vs SFU — When to Use MCU

| Aspect | SFU (SaaS Mode) | MCU (Enterprise Mode) |
|--------|------------------|----------------------|
| **Architecture** | Selective Forwarding Unit — forwards streams as-is | Multipoint Control Unit — transcodes & composes |
| **Client bandwidth** | High (receives N streams) | Low (receives 1 composite stream) |
| **Client CPU** | High (decodes multiple streams) | Low (decodes single stream) |
| **Server CPU** | Low (forward only) | High (transcode + compose) |
| **Legacy devices** | WebRTC only | SIP, H.323, any codec |
| **Recording** | External composition needed | Native composite recording |
| **Network** | Public internet + TURN | Private MPLS VPN / LAN |
| **Meeting initiation** | Shareable links (URL) | Corporate calendar / directory |
| **Guest access** | Yes | No — corporate identity only |
| **Best for** | Small groups, modern browsers, SaaS | Large rooms, room systems, secure environments |

### Decision Matrix

| Condition | Recommended Mode |
|-----------|------------------|
| Participants on different networks (home/office/mobile) | **SFU** |
| All participants on same corporate MPLS VPN | **MCU** |
| Need to connect Polycom/Cisco room systems | **MCU** |
| Bandwidth-constrained MPLS links | **MCU** |
| Compliance requires on-premise recording | **MCU** |
| Meeting size > 50 participants | **MCU** (or SFU cascade) |
| Internet-facing SaaS product | **SFU** |

---

## 3. System Architecture

### MCU Mode Architecture

```
┌──────────────┐     MPLS VPN / L3VPN     ┌──────────────┐
│ Endpoint A    │ ─── SRTP ──────────────► │              │
│ (Branch HQ)   │                          │   MCU        │
└──────────────┘                           │ (On-Premise) │
                                           │              │
┌──────────────┐     MPLS VPN / L3VPN     │ • Transcoding│
│ Endpoint B    │ ─── SRTP ──────────────► │ • Composition│
│ (Data Center) │                          │ • Recording  │
└──────────────┘                           │ • AI (local) │
                                           └──────────────┘
┌──────────────┐     MPLS VPN / L3VPN           │
│ Endpoint C    │ ─── SRTP ──────────────────────┘
│ (Branch Delhi)│
└──────────────┘

No TURN/STUN needed — all endpoints on same private network
No NAT traversal — direct IP connectivity within VPN
```

### Service Architecture (Intranet Mode)

```
┌──────────────────────────────────────────────────┐
│                   FRONTEND                        │
│        React + Vite (Port 5173)                   │
│        MCU_ENABLED=true, MODE=intranet            │
└───────────────┬──────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐  ┌───▼───┐  ┌───▼───┐
│  Sig  │  │  MCU  │  │  Web  │
│ :4001 │  │ :4002 │  │ :5173 │
│       │  │       │  │       │
│WebSock│  │GStream│  │ Vite  │
│JSON-  │  │Compos.│  │ Dev   │
│RPC 2.0│  │SIP/H. │  │Server │
│       │  │323 GW │  │       │
└───┬───┘  └───┬───┘  └───────┘
    │          │
┌───▼──────────▼─────────────────────────────────┐
│       PostgreSQL (5432) + Redis (6379)          │
│                + MinIO (9000)                    │
└─────────────────────────────────────────────────┘
```

---

## 4. Prerequisites & Hardware Requirements

### Software Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Node.js** | v20+ | v24+ |
| **Docker** | v20+ | v29+ |
| **OS** | Windows 10/11, Ubuntu 20+, RHEL 8+ | Windows 11, Ubuntu 22+ |
| **Browser** | Chrome 90+, Edge 90+ | Latest Chrome/Edge |
| **GStreamer** | — (dev mode uses abstraction) | v1.22+ (production) |

### Hardware Requirements

#### Small Deployment (50 concurrent meetings, 500 users)

| Component | Specification |
|-----------|--------------|
| **Application Server** | 32 vCPU, 128 GB RAM, 2 TB NVMe SSD, 2× 10GbE NIC |
| **AI Appliance** | 16 vCPU, 64 GB RAM, 1 TB NVMe, 2× NVIDIA A10 GPU |
| **Storage Server** | 8 vCPU, 32 GB RAM, 20 TB RAID-10 |

#### Medium Deployment (200 concurrent meetings, 2000 users)

| Component | Specification |
|-----------|--------------|
| **Application Servers** | 3× clustered K8s nodes |
| **AI Appliances** | 2× load-balanced Triton servers |
| **Storage Servers** | 2× replicated MinIO + PostgreSQL |
| **Load Balancer** | 1× F5 / HAProxy |
| **HSM** | 1× Thales Luna / AWS CloudHSM on-prem |

#### Large Deployment (1000+ concurrent meetings, 10000+ users)

| Component | Specification |
|-----------|--------------|
| **Application Servers** | 10× full K8s cluster |
| **Dedicated SFU/MCU Servers** | 5× bare-metal, 10GbE |
| **AI Appliances** | 4× A100 GPUs, clustered Triton |
| **Storage Servers** | 3× Ceph/MinIO distributed |
| **PostgreSQL HA** | 2× Patroni cluster |
| **Redis Sentinel** | 2× clusters |
| **Kafka** | 3-node cluster |
| **HSMs** | 2× active-passive |
| **Network** | 25GbE spine-leaf fabric |

---

## 5. Installation & Setup

### Development Setup

#### Step 1: Clone the Repository

```bash
git clone <repository-url> QS_VC
cd QS_VC
```

#### Step 2: Install Dependencies

```bash
npm install
```

This installs dependencies for all workspaces including the MCU service (`@qsvc/mcu`).

#### Step 3: Start Docker Infrastructure

Ensure Docker Desktop is running, then:

```bash
docker compose up -d postgres redis minio
```

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 | 5432 | Database |
| Redis 7 | 6379 | Sessions & pub/sub |
| MinIO | 9000 / 9001 | Recording storage (S3-compatible) |

> **MinIO Console**: http://localhost:9001
> Login: `qsvc_minio` / `qsvc_minio_secret`

#### Step 4: Verify Installation

```bash
# Run all tests
npx vitest run --reporter=verbose
```

#### Step 5: Start MCU Platform

```bash
node start-intranet.js
```

This single command starts all three MCU-mode services sequentially. See [Section 7](#7-starting-the-mcu-platform) for details.

---

## 6. Configuration Reference

### MCU Service Configuration

The MCU service is configured via environment variables and defaults defined in `services/mcu/src/index.ts`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MCU_PORT` | `4002` | MCU HTTP API port |
| `maxRooms` | `100` | Maximum concurrent MCU rooms |
| `maxParticipantsPerRoom` | `500` | Maximum participants per room |
| `defaultLayout` | `speaker` | Default video composition layout |
| `outputResolution` | `1920×1080` | Composite output resolution |
| `outputFps` | `30` | Composite output frame rate |
| `outputVideoBitrate` | `4000 kbps` | Composite video bitrate |
| `outputAudioBitrate` | `128 kbps` | Composite audio bitrate |
| `outputVideoCodec` | `h264` | Output video codec |
| `outputAudioCodec` | `opus` | Output audio codec |
| `recordingEnabled` | `true` | Enable server-side recording |
| `recordingPath` | `./recordings` | Recording output directory |
| `sipEnabled` | `true` | Enable SIP gateway |
| `sipPort` | `5060` | SIP signaling port |
| `h323Enabled` | `true` | Enable H.323 gateway |
| `h323Port` | `1720` | H.323 control port |
| `rtmpEnabled` | `true` | Enable RTMP ingest/streaming |

### SIP/H.323 Gateway Configuration

Configured in `services/mcu/src/sip-gateway-config.ts`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sipListenPort` | `5060` | SIP UDP/TCP port |
| `sipTlsPort` | `5061` | SIP TLS port |
| `sipDomain` | `sip.qsvc.local` | SIP domain / registrar |
| `sipTransport` | `tls` | Default transport (udp/tcp/tls/ws/wss) |
| `sipTrunkEnabled` | `true` | Enable PSTN SIP trunking |
| `sipTrunkProvider` | `twilio` | SIP trunk provider |
| `h323ListenPort` | `1720` | H.323 TCP port |
| `h323GatekeeperMode` | `discover` | Gatekeeper mode (none/discover/required) |
| `rtpPortRange` | `20000–30000` | RTP media port range |
| `srtpEnabled` | `true` | Enable SRTP encryption |
| `dtmfMode` | `rfc2833` | DTMF signaling method |

### Supported Video Codecs

`H.264`, `H.265`, `VP8`, `VP9`, `AV1`, `H.263`

### Supported Audio Codecs

`Opus`, `G.722`, `G.711 µ-law (PCMU)`, `G.711 A-law (PCMA)`, `AAC-LD`

### Intranet-Mode Environment Variables

When launched via `start-intranet.js`, these variables are automatically set:

| Variable | Value | Target Service |
|----------|-------|----------------|
| `CORS_ORIGINS` | `*` | Signaling |
| `MCU_ENABLED` | `true` | Signaling |
| `MCU_URL` | `http://localhost:4002` | Signaling |
| `VITE_MCU_ENABLED` | `true` | Web Frontend |
| `VITE_MCU_URL` | `http://localhost:4002` | Web Frontend |
| `VITE_DEPLOYMENT_MODE` | `intranet` | Web Frontend |

---

## 7. Starting the MCU Platform

### One-Command Launch (Recommended)

```bash
node start-intranet.js
```

This launches the enterprise MCU platform with a single command. The script:

1. **Starts Signaling Server** (port 4001) — WebSocket signaling with MCU mode enabled
2. **Starts MCU Service** (port 4002) — GStreamer video composition + SIP/H.323 gateway
3. **Starts Vite Web UI** (port 5173) — React frontend in intranet mode

#### Expected Output

```
╔═══════════════════════════════════════════════════════╗
║   QS-VC — Enterprise Intranet Deployment (MCU Mode)  ║
║   🏢 On-Premise • SIP/H.323 • Quantum-Safe E2EE     ║
║   MCU Video Composition + Audio Mixing                ║
╚═══════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🏢 QS-VC ENTERPRISE (Intranet MCU Mode) is RUNNING!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📌 ACCESS URLs (share within your intranet):
     Local:       http://localhost:5173
     LAN (eth0):  http://192.168.x.x:5173

  📡 SERVICES:
     Signaling:   http://localhost:4001
     MCU:         http://localhost:4002
     MCU Health:  http://localhost:4002/health
     Web UI:      http://localhost:5173

  🎬 MCU CAPABILITIES:
     Layouts:     grid | speaker | presentation | spotlight | filmstrip
     Recording:   Server-side composite (MP4)
     SIP Gateway: sip:<meeting-code>@localhost:5060
     H.323:       localhost:1720
     RTMP Ingest: rtmp://localhost/live

  📞 SIP/H.323 ENDPOINT SUPPORT:
     ✓ Polycom HDX/Group/Trio/Studio/G7500
     ✓ Cisco TelePresence SX/MX/Room Kit/Board
     ✓ PeopleLink Ultra/Sky/Blaze/Auro
     ✓ Lifesize Icon/Cloud
     ✓ Avaya Scopia/B-Series
     ✓ Huawei TE/CE Series

  🔐 SECURITY:
     ✓ Quantum-Safe E2EE (Kyber-1024 + Dilithium-5)
     ✓ NIST FIPS 203/204/205 compliant
     ✓ AES-256-GCM symmetric encryption

  Press Ctrl+C to stop all services
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Manual Start (Alternative)

If you need to start services individually:

```bash
# Terminal 1 — Signaling
cd services\signaling && npx tsx watch src/index.ts

# Terminal 2 — MCU
cd services\mcu && npx tsx watch src/index.ts

# Terminal 3 — Web Frontend
cd frontend\web && npx vite --host 0.0.0.0
```

### Verifying Service Health

```bash
# MCU Health (shows capabilities)
curl http://localhost:4002/health

# Expected response:
# {
#   "status": "ok",
#   "service": "qsvc-mcu",
#   "rooms": 0,
#   "capabilities": {
#     "videoCodecs": ["h264","h265","vp8","vp9","av1"],
#     "audioCodecs": ["opus","pcma","pcmu","g722","aac"],
#     "maxParticipants": 500,
#     "layouts": ["grid","speaker","presentation","spotlight","filmstrip"],
#     "sipEnabled": true,
#     "h323Enabled": true,
#     "rtmpEnabled": true,
#     "recordingEnabled": true
#   }
# }

# Signaling Health
curl http://localhost:4001/health

# SIP/H.323 Gateway Status
curl http://localhost:4002/api/gateway/status
```

---

## 8. User Guide — Joining Meetings

### For WebRTC Participants (Browser / Desktop App)

**MCU (Secured) meeting flow differs from SaaS:**

| Step | SaaS (Link Sharing) | MCU (Enterprise) |
|------|---------------------|-------------------|
| 1 | User clicks "New Meeting" | Admin creates meeting in corporate calendar (Exchange/Lotus) |
| 2 | Shares link via email/chat | Calendar invite sent to internal participants only |
| 3 | Anyone with link joins | Participants click calendar link on corporate device |
| 4 | Browser → SFU (internet) | Native app → MCU via VPN (no browser required) |
| 5 | Host ends meeting | Meeting ends per schedule or host action |
| 6 | Recording to cloud S3 | Recording to on-premise MinIO, transcript to PostgreSQL |

#### Secured Meeting Lifecycle

```
1. SCHEDULE → Admin creates meeting in corporate calendar (Exchange/Lotus)
2. INVITE   → Calendar invite sent to participants (internal only)
3. JOIN     → Participants click calendar link on corporate device
              → App connects to MCU via VPN (no browser — native app)
              → SSO + device certificate validated
4. MEDIA    → H.323/SIP/WebRTC via MCU (MPLS VPN, no internet)
5. END      → Meeting ends per schedule or host action
6. ARTIFACT → Recording saved to on-premise MinIO
              → Transcript saved to on-premise PostgreSQL
              → Audit log written (tamper-proof, hash-chained)
```

#### Authentication in Secured Mode

| Layer | Implementation |
|-------|----------------|
| **Network** | Only corporate MPLS VPN IPs can reach the MCU |
| **Device** | Mutual TLS with device certificates (issued by internal CA) |
| **Identity** | SAML 2.0 / OIDC via corporate IdP (AD FS / Keycloak) |
| **Session** | JWT with Dilithium-5 signature, 1-hour expiry |
| **Meeting** | Per-meeting RBAC (host, participant) from directory group |

---

## 9. User Guide — SIP/H.323 Endpoints

### Connecting Room Systems

The MCU service includes a built-in SIP/H.323 gateway that bridges legacy video conferencing hardware to QS-VC meetings.

#### SIP Dial-In

1. On your SIP endpoint (e.g., Polycom Group 500), navigate to **Place a Call**
2. Enter the SIP URI:
   ```
   sip:<meeting-code>@sip.qsvc.local
   ```
3. The MCU will answer and bridge you into the meeting room
4. You will see the composite video layout (all participants in one view)

#### H.323 Dial-In

1. On your H.323 endpoint (e.g., Cisco TelePresence SX80), dial:
   ```
   sip.qsvc.local##<meeting-code>
   ```
   Or dial `sip.qsvc.local` and enter the conference ID when prompted.
2. The MCU will bridge you into the meeting

#### PSTN Dial-In

For audio-only phone participation:

1. Call any of the configured dial-in numbers:

   | Country | Number |
   |---------|--------|
   | India | +91-11-4000-XXXX |
   | India (Toll-free) | +91-1800-XXX-XXXX |
   | US | +1-646-XXX-XXXX |
   | UK | +44-20-XXXX-XXXX |
   | Singapore | +65-XXXX-XXXX |
   | UAE | +971-4-XXX-XXXX |

2. Enter the conference ID followed by `#`
3. DTMF controls:
   - `*6` — Mute/unmute
   - `*9` — Raise/lower hand

### Connection Types & Auto-Codec Selection

| Connection Type | Auto-Selected Video Codec | Auto-Selected Audio Codec |
|-----------------|--------------------------|--------------------------|
| **WebRTC** | VP9 | Opus |
| **SIP** | VP9 | PCMA (G.711 A-law) |
| **H.323** | H.264 | PCMA (G.711 A-law) |
| **RTMP** | VP9 | Opus |

The MCU automatically transcodes between codecs, so endpoints with different codecs can communicate seamlessly.

---

## 10. User Guide — Meeting Controls & Layouts

### Video Composition Layouts

The MCU composes all participant videos into a single output stream. Available layouts:

| Layout | Description | Best For |
|--------|-------------|----------|
| **Grid** | Equal-size tiles in a grid pattern | Team meetings, all-hands |
| **Speaker** | Active speaker large, others in small strip | Presentations, discussions |
| **Presentation** | Screen share large, participants in side strip | Training, demos |
| **Spotlight** | Single speaker full screen | Executive addresses |
| **Filmstrip** | Horizontal strip at bottom of screen | Webinars, panels |
| **Custom** | Admin-defined custom layout | Special events |

### Grid Position Calculation

In grid layout, participants are arranged automatically:
- The grid columns = √(number of participants), rounded up
- Each participant is assigned a `(row, col)` position
- When participants join or leave, the grid recalculates automatically

### Active Speaker Detection

- The MCU monitors audio levels from all participants
- The participant with the highest audio level is automatically flagged as the **active speaker**
- In `speaker` layout, the active speaker appears in the large central area
- Active speaker changes are announced to all participants

### Changing Layout (Admin/Host)

Hosts can change the composition layout via the REST API:

```bash
curl -X POST http://localhost:4002/api/mcu/rooms/<roomId>/layout \
  -H "Content-Type: application/json" \
  -d '{"layout": "grid"}'
```

---

## 11. Recording & Live Streaming

### Server-Side Composite Recording

MCU recording captures the composed video output (all participants in one view), unlike SFU recording which captures individual streams.

#### Start Recording

```bash
curl -X POST http://localhost:4002/api/mcu/rooms/<roomId>/recording/start
```

**Response:**
```json
{
  "recording": true,
  "path": "./recordings/MEETING-CODE_1711155600000.mp4"
}
```

#### Stop Recording

```bash
curl -X POST http://localhost:4002/api/mcu/rooms/<roomId>/recording/stop
```

Recording files are saved in the configured `recordingPath` directory (`./recordings` by default) as MP4 files.

#### Recording Format

| Property | Value |
|----------|-------|
| Container | MP4 |
| Video Codec | H.264 |
| Video Resolution | 1920×1080 (configurable) |
| Video FPS | 30 |
| Video Bitrate | 4000 kbps |
| Audio Codec | Opus (or AAC for compatibility) |
| Audio Bitrate | 128 kbps |

### Live Streaming (RTMP)

Stream the meeting to an external platform (YouTube Live, Facebook Live, custom RTMP server):

```bash
curl -X POST http://localhost:4002/api/mcu/rooms/<roomId>/stream \
  -H "Content-Type: application/json" \
  -d '{"rtmpUrl": "rtmp://live.youtube.com/stream-key-here"}'
```

The GStreamer pipeline composites all participants and pushes the output via RTMP.

---

## 12. Admin Guide — MCU Management

### Viewing All Active Rooms

```bash
curl http://localhost:4002/api/mcu/rooms
```

**Response:**
```json
{
  "rooms": [
    {
      "id": "uuid-1",
      "meetingCode": "BOARD-MTG-001",
      "participantCount": 12,
      "layout": "speaker",
      "recording": true
    }
  ]
}
```

### Viewing Room Details

```bash
curl http://localhost:4002/api/mcu/rooms/<roomId>
```

**Response includes:**
- Room ID, meeting code, layout
- All participants (name, connection type, audio/video status, grid position)
- Recording status
- Composition state (resolution, FPS, active speaker)
- SIP dial-in number and conference ID
- Room uptime

### Removing a Participant

```bash
curl -X DELETE http://localhost:4002/api/mcu/rooms/<roomId>/participants/<peerId>
```

### Setting Active Speaker Manually

```bash
curl -X POST http://localhost:4002/api/mcu/rooms/<roomId>/active-speaker \
  -H "Content-Type: application/json" \
  -d '{"peerId": "participant-id"}'
```

### Gateway Status

Monitor the SIP/H.323/RTMP gateway:

```bash
curl http://localhost:4002/api/gateway/status
```

**Response:**
```json
{
  "sip": {
    "enabled": true,
    "port": 5060,
    "protocol": "SIP/TLS",
    "registrar": "sip.qsvc.local",
    "supportedCodecs": ["opus", "pcma", "pcmu", "g722"],
    "activeCalls": 0
  },
  "h323": {
    "enabled": true,
    "port": 1720,
    "gatekeeper": "gk.qsvc.local",
    "supportedCodecs": ["h264", "h263", "pcma", "pcmu"],
    "activeCalls": 0,
    "supportedEndpoints": [
      "Polycom HDX/VVX/Group/Trio",
      "Cisco TelePresence/SX/MX/DX",
      "Tandberg Edge/Codec",
      "Lifesize Icon/Cloud",
      "Avaya Scopia",
      "Huawei TE/CE Series",
      "StarLeaf",
      "PeopleLink Ultra/Sky/Blaze"
    ]
  },
  "rtmp": {
    "enabled": true,
    "ingestUrl": "rtmp://mcu.qsvc.local/live",
    "activeStreams": 0
  }
}
```

---

## 13. API Reference

### MCU Service (Port 4002)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health + capabilities |
| `POST` | `/api/mcu/rooms/join` | Join or create an MCU room |
| `GET` | `/api/mcu/rooms` | List all active rooms |
| `GET` | `/api/mcu/rooms/:roomId` | Get room details |
| `POST` | `/api/mcu/rooms/:roomId/layout` | Change composition layout |
| `POST` | `/api/mcu/rooms/:roomId/active-speaker` | Set active speaker |
| `POST` | `/api/mcu/rooms/:roomId/recording/start` | Start composite recording |
| `POST` | `/api/mcu/rooms/:roomId/recording/stop` | Stop recording |
| `POST` | `/api/mcu/rooms/:roomId/stream` | Start RTMP live stream |
| `DELETE` | `/api/mcu/rooms/:roomId/participants/:peerId` | Remove participant |
| `GET` | `/api/gateway/status` | SIP/H.323/RTMP gateway status |

### Join Room — Request Body

```json
{
  "meetingCode": "BOARD-MTG-001",
  "peerId": "user-uuid-123",
  "displayName": "Dr. Sharma",
  "connectionType": "webrtc"  // or "sip", "h323", "rtmp"
}
```

### Join Room — Response

```json
{
  "roomId": "room-uuid",
  "participantId": "user-uuid-123",
  "layout": "speaker",
  "compositionUrl": "/api/mcu/rooms/room-uuid/stream",
  "sipDialIn": "+91-1234567890",
  "sipConferenceId": "abc12345",
  "compositionState": {
    "outputResolution": { "width": 1920, "height": 1080 },
    "fps": 30,
    "activeSpeakerId": null,
    "presenterId": null
  }
}
```

### Change Layout — Request Body

```json
{
  "layout": "grid"  // grid | speaker | presentation | spotlight | filmstrip | custom
}
```

### Signaling Service (Port 4001)

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| WebSocket | `ws://localhost:4001/ws` | JSON-RPC 2.0 signaling |
| HTTP | `/health` | Health check |

---

## 14. Security & Encryption

### Zero Trust Security Architecture

The QS-VC MCU platform implements a 5-layer security model:

| Layer | Implementation |
|-------|----------------|
| **Identity & Access** | PQC Identity (Keycloak + Dilithium), MFA/FIDO2, RBAC + ABAC |
| **Transport (Q-TLS)** | Hybrid: X25519 + Kyber-1024 key exchange, Ed25519 + Dilithium-5 signatures |
| **Media Encryption** | SFrame E2EE with per-frame AES-256-GCM, Kyber-wrapped keys |
| **Data at Rest** | AES-256-GCM encrypted recordings, TDE for PostgreSQL, encrypted MinIO |
| **Audit & Compliance** | Tamper-proof logs (Merkle tree), SIEM integration, compliance dashboards |

### Quantum-Safe Cryptography

| Algorithm | Use Case | Standard |
|-----------|----------|----------|
| **CRYSTALS-Kyber-1024** | Key encapsulation / key exchange | NIST FIPS 203 |
| **CRYSTALS-Dilithium-5** | Digital signatures (JWT, certs, audit logs) | NIST FIPS 204 |
| **X25519** | Classical key exchange (hybrid fallback) | RFC 7748 |
| **Ed25519** | Classical signatures (hybrid fallback) | RFC 8032 |
| **AES-256-GCM** | Symmetric encryption (media, data at rest) | NIST SP 800-38D |
| **SHA-3-256** | Hash function (audit log chain) | NIST FIPS 202 |

### Key Rotation Schedule

| Key Type | Rotation Interval | Method |
|----------|-------------------|--------|
| TLS Certificates | 90 days | ACME auto-renewal |
| TURN Secrets | 1 hour | Vault dynamic secrets |
| JWT Signing Keys | 24 hours | Dual-key overlap period |
| Meeting Keys (E2EE) | 60 seconds | HKDF epoch derivation |
| Recording DEKs | Per-recording | Unique key per recording |
| Database TDE | 30 days | Online re-encryption |
| Root CA | 5 years | HSM ceremony |

### Compliance

| Regulation | Status |
|------------|--------|
| **ISO 27001** | ISMS implementation, annual audit |
| **IT Act 2000 (India)** | LEA interface (court-ordered), audit logs |
| **DPDP Act (India)** | Data localization, consent, DPO dashboard |
| **CCA (India)** | PQC certificate compliance |
| **GDPR (EU)** | Data minimization, right to erasure |
| **SOC 2 Type II** | Continuous monitoring |

---

## 15. Network & Firewall Configuration

### Required Ports (MCU Mode)

| Port | Protocol | Service | Direction |
|------|----------|---------|-----------|
| `4001` | TCP | Signaling (WebSocket) | Inbound |
| `4002` | TCP | MCU REST API | Inbound |
| `5060` | UDP/TCP | SIP Signaling | Inbound |
| `5061` | TCP | SIP TLS | Inbound |
| `1720` | TCP | H.323 Control | Inbound |
| `5173` | TCP | Web UI (dev) | Inbound |
| `20000–30000` | UDP | RTP Media (SIP/H.323) | Inbound/Outbound |
| `5432` | TCP | PostgreSQL | Internal only |
| `6379` | TCP | Redis | Internal only |
| `9000/9001` | TCP | MinIO API / Console | Internal only |

### Network Topology for MCU Mode

```
Enterprise MPLS VPN / Private WAN
├── Branch HQ ──────────── MCU Server (Data Center)
├── Branch Office A ────── MCU Server
├── Branch Office B ────── MCU Server
├── Branch Office C ────── MCU Server
└── Remote VPN Users ───── MCU Server (via IPSec VPN)

No TURN/STUN needed — all endpoints on same private network
No NAT traversal — direct IP connectivity within VPN
No public internet traffic — all media stays within corporate WAN
```

---

## 16. Air-Gapped / On-Premise Deployment

For fully air-gapped environments with **no internet connectivity**:

### Installation Workflow

```
1. MEDIA PREPARATION (at QS-VC facility)
   • Build all container images (Docker)
   • Package as OCI bundles on encrypted USB/HDD
   • Include: K8s binaries, Helm charts, AI model files
   • Sign all packages with Dilithium digital signature
   • Include offline Helm repo + container registry

2. HARDWARE SETUP (at customer site)
   • Rack & stack servers per hardware specification
   • Configure network (VLAN isolation, firewall rules)
   • Initialize HSM with key ceremony (split key holders)

3. SOFTWARE DEPLOYMENT
   • Boot installer from encrypted media
   • Verify digital signatures on all packages
   • Deploy private container registry (Harbor)
   • Push container images to private registry
   • Deploy K8s cluster (kubeadm / K3s / RKE2)
   • Apply Helm charts for all services
   • Initialize databases with schema + seed data
   • Load AI models into Triton Inference Server

4. CONFIGURATION
   • Tenant setup (organization name, branding, policies)
   • LDAP/AD integration (Keycloak LDAP federation)
   • TLS certificate installation (internal CA)
   • TURN server configuration (internal IPs — if needed)
   • Recording storage path configuration
   • SIP/H.323 gateway configuration

5. VALIDATION
   • Automated smoke test suite
   • Media quality test (internal video calls)
   • SIP/H.323 endpoint connectivity test
   • AI feature validation (captions, translation)
   • Security scan (CIS benchmarks)
   • Performance baseline measurement

Total Installation Time: 4–8 hours (automated)
```

---

## 17. Production Deployment (Docker)

### Step 1: Configure Environment

```bash
cp .env.production.example .env.production
```

Edit `.env.production` with production values:
- Domain name
- Strong passwords for PostgreSQL, Redis, MinIO
- Secure JWT secret
- TURN secret
- SFU announced IP

### Step 2: SSL Certificates

Place certificates in `./certs/`:
- `fullchain.pem` — Full certificate chain
- `privkey.pem` — Private key

### Step 3: Deploy

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts the full production stack with:
- **Nginx** reverse proxy with TLS termination (ports 80/443)
- **PostgreSQL 16** with health checks
- **Redis 7** with AOF persistence and password auth
- **MinIO** object storage with health checks
- **coturn** TURN/STUN server
- **SFU** (mediasoup) with host networking
- **Signaling** server
- **Auth, Meeting, Recording** services
- **Web** frontend

---

## 18. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **MCU service won't start** | Check port 4002 is free: `netstat -ano \| findstr :4002` |
| **SIP endpoint can't connect** | Verify SIP port 5060 is open, check firewall rules |
| **H.323 endpoint can't connect** | Verify port 1720 open, check gatekeeper config |
| **No audio from SIP endpoint** | Check RTP port range (20000–30000) is open for UDP |
| **Video quality is poor** | Check `outputVideoBitrate` in MCU config, verify network bandwidth |
| **Recording fails to start** | Verify `recordingPath` directory exists and is writable |
| **"Maximum MCU rooms reached"** | Increase `maxRooms` config or close inactive rooms |
| **Participant can't join** | Check `maxParticipantsPerRoom` limit, verify authentication |
| **Layout not changing** | Verify correct `roomId` in API call, check room exists |
| **PowerShell script blocked** | Use `cmd /c "command"` or `Set-ExecutionPolicy RemoteSigned` |
| **Docker not starting** | Ensure Docker Desktop is running and fully initialized |

### Health Check Commands

```bash
# MCU Health
curl http://localhost:4002/health

# Gateway Status
curl http://localhost:4002/api/gateway/status

# Active Rooms
curl http://localhost:4002/api/mcu/rooms

# Signaling Health
curl http://localhost:4001/health
```

### Logs

All services log to stdout. When using `start-intranet.js`, logs are prefixed with timestamps and service names:

```
[12:30:15] [Signaling] ✓ Signaling service is ready
[12:30:17] [MCU] ✓ MCU service is ready (GStreamer compositor + SIP/H.323 bridge)
[12:30:20] [Vite] ✓ Vite dev server is ready
```

### Graceful Shutdown

Press `Ctrl+C` in the terminal running `start-intranet.js` — all services will be stopped cleanly.

---

## 19. Appendix — Supported Endpoints

### Polycom

| Model | Max Resolution | SIP | H.323 | Dual Stream | Encryption |
|-------|---------------|-----|-------|-------------|------------|
| HDX 7000/8000/9000 | 4K | ✅ | ✅ | ✅ (BFCP) | SRTP |
| VVX 500/600 | 1080p | ✅ | ✅ | ✅ | SRTP |
| Group 300/500/700 | 4K | ✅ | ✅ | ✅ | SRTP |
| Trio 8500/8800 | 1080p | ✅ | ✅ | ✅ | SRTP |
| Studio X30/X50/X70 | 4K | ✅ | ✅ | ✅ | SRTP |
| G7500 | 4K | ✅ | ✅ | ✅ | SRTP |

### Cisco

| Model | Max Resolution | SIP | H.323 | Dual Stream | Encryption |
|-------|---------------|-----|-------|-------------|------------|
| TelePresence SX10/20/80 | 4K | ✅ | ✅ | ✅ (BFCP) | SRTP |
| MX200/300/700/800 | 4K | ✅ | ✅ | ✅ | SRTP |
| Room Kit/Mini/Plus | 4K | ✅ | ✅ | ✅ | SRTP |
| Board 55/85 | 4K | ✅ | ✅ | ✅ | SRTP |
| Desk Pro | 4K | ✅ | ✅ | ✅ | SRTP |
| DX70/DX80 | 4K | ✅ | ✅ | ✅ | SRTP |

### PeopleLink

| Model | Max Resolution | SIP | H.323 | Dual Stream | Encryption |
|-------|---------------|-----|-------|-------------|------------|
| Ultra HD | 1080p | ✅ | ✅ | ✅ | SRTP |
| Sky 100/200 | 1080p | ✅ | ✅ | ✅ | SRTP |
| Blaze 300/400/500 | 1080p | ✅ | ✅ | ✅ | SRTP |
| Ivory 100S | 1080p | ✅ | ✅ | ✅ | SRTP |
| Auro 500 | 1080p | ✅ | ✅ | ✅ | SRTP |

### Lifesize

| Model | Max Resolution | SIP | H.323 | Dual Stream | Encryption |
|-------|---------------|-----|-------|-------------|------------|
| Icon 300/450/500/700 | 4K | ✅ | ✅ | ✅ | SRTP |
| Cloud | 4K | ✅ | ✅ | ✅ | SRTP |

### Avaya

| Model | Max Resolution | SIP | H.323 | Dual Stream | Encryption |
|-------|---------------|-----|-------|-------------|------------|
| Scopia XT5000 | 1080p | ✅ | ✅ | ✅ | H.235 |
| B179 | 1080p | ✅ | ✅ | ✅ | H.235 |
| IX Meeting Server | 1080p | ✅ | ✅ | ✅ | H.235 |

### Huawei

| Model | Max Resolution | SIP | H.323 | Dual Stream | Encryption |
|-------|---------------|-----|-------|-------------|------------|
| TE30/40/50/60 | 4K | ✅ | ✅ | ✅ | SRTP |
| CE200/CE400 | 4K | ✅ | ✅ | ✅ | SRTP |

---

*QS-VC — Quantum-Safe Enterprise Video Conferencing Platform (MCU Edition)*
*Built for Banks, Government, Defence & Large Enterprises*
*Quantum-Safe E2EE • SIP/H.323 Interop • On-Premise • Air-Gapped Ready*
