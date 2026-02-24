# QS-VC — User & Operations Manual

**Quantum-Safe Video Conferencing Platform**
Version 0.1.0 | Last Updated: Feb 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Prerequisites & Installation](#2-prerequisites--installation)
3. [Local Development Deployment](#3-local-development-deployment)
4. [Production Deployment](#4-production-deployment)
5. [User Guide — Meetings](#5-user-guide--meetings)
6. [User Guide — Scheduling](#6-user-guide--scheduling)
7. [User Guide — In-Meeting Controls](#7-user-guide--in-meeting-controls)
8. [Admin Dashboard](#8-admin-dashboard)
9. [Architecture Reference](#9-architecture-reference)
10. [API Reference](#10-api-reference)
11. [Configuration Reference](#11-configuration-reference)
12. [Troubleshooting](#12-troubleshooting)
13. [Security Features](#13-security-features)

---

## 1. System Overview

QS-VC is a full-featured video conferencing platform built for security, scalability, and ease of use. It includes:

| Feature | Description |
|---------|-------------|
| **Video Conferencing** | WebRTC-based multi-party video calls via SFU |
| **Virtual Background** | MediaPipe SelfieSegmentation (blur/image/color) |
| **Noise Suppression** | RNNoise WASM via AudioWorklet |
| **Live Captions** | Web Speech API real-time transcription |
| **Screen Sharing** | Full screen, window, or tab sharing |
| **End-to-End Encryption** | Insertable Streams + SFrame with Kyber-1024 |
| **Meeting Recording** | Server-side MediaRecorder with S3 storage |
| **Chat & Reactions** | Real-time chat with emoji reactions |
| **Waiting Room** | Host-controlled participant admission |
| **Scheduling** | Schedule future meetings with recurrence & invitations |
| **Admin Dashboard** | Real-time monitoring, user management, analytics |

---

## 2. Prerequisites & Installation

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | v20+ | v24+ |
| Docker | v20+ | v29+ |
| RAM | 4 GB | 8 GB |
| Storage | 2 GB | 10 GB |
| OS | Windows 10/11, Linux, macOS | Windows 11, Ubuntu 22+ |
| Browser | Chrome 90+, Edge 90+ | Latest Chrome/Edge |

### Step 1: Clone the Repository

```bash
git clone <repository-url> QS_VC
cd QS_VC
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs dependencies for all workspaces (6 projects) using npm workspaces:
- `services/sfu` — SFU Media Engine (mediasoup)
- `services/signaling` — WebSocket Signaling Server
- `services/auth` — Authentication Service
- `services/meeting` — Meeting Management Service
- `services/recording` — Recording Service
- `frontend/web` — React + Vite Web Frontend

### Step 3: Verify Installation

```bash
# Run all tests (49 tests expected to pass)
npx vitest run --reporter=verbose
```

---

## 3. Local Development Deployment

### Step 1: Start Docker Infrastructure

Open **Docker Desktop** on your system, then run:

```bash
docker compose up -d postgres redis minio
```

This starts:
| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 | 5432 | Database |
| Redis 7 | 6379 | Session & pub/sub |
| MinIO | 9000 / 9001 | Recording storage (S3-compatible) |

> **MinIO Console**: http://localhost:9001  
> Login: `qsvc_minio` / `qsvc_minio_secret`

### Step 2: Start All Backend Services

Open **5 separate terminals** and run one command per terminal:

```bash
# Terminal 1 — SFU Media Engine (port 4000)
cd services\sfu && npx tsx watch src/index.ts

# Terminal 2 — Signaling Server (port 4001)
cd services\signaling && npx tsx watch src/index.ts

# Terminal 3 — Auth Service (port 4002)
cd services\auth && npx tsx watch src/index.ts

# Terminal 4 — Meeting Service (port 4003)
cd services\meeting && npx tsx watch src/index.ts

# Terminal 5 — Recording Service (port 4004)
cd services\recording && npx tsx watch src/index.ts
```

### Step 3: Start the Frontend

```bash
# Terminal 6 — Vite Dev Server (port 5173 or 5174)
cd frontend\web && npx vite
```

### Step 4: Open the Application

Open your browser and navigate to:

> **http://localhost:5173** (or 5174 if 5173 is busy)

### Quick Verification

After all services start, you should see these log messages:

```
🔧 QS-VC SFU running on port 4000
🚀 QS-VC Signaling running on port 4001
🔐 QS-VC Auth running on port 4002
📋 QS-VC Meeting Service running on port 4003
🎬 QS-VC Recording running on port 4004
```

### Service Health Checks

```bash
curl http://localhost:4001/health   # Signaling
curl http://localhost:4002/health   # Auth
curl http://localhost:4003/health   # Meeting
curl http://localhost:4004/health   # Recording
```

---

## 4. Production Deployment

### Using Docker Compose (Recommended)

1. Copy the environment template:
   ```bash
   cp .env.production.example .env.production
   ```

2. Edit `.env.production` with your values (domain, passwords, JWT secret)

3. Place SSL certificates in `./certs/`:
   - `fullchain.pem`
   - `privkey.pem`

4. Deploy:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

### CI/CD Pipeline

A GitHub Actions workflow is included in `.github/workflows/ci.yml`:
- **Lint** → **Test** → **Build** → **Docker Image Build** (on main branch)

---

## 5. User Guide — Meetings

### Creating an Instant Meeting

1. Open the QS-VC landing page
2. Click **"📹 Create Meeting"**
3. You'll be taken to the **Pre-Meeting** screen:
   - Preview your camera/microphone
   - Set your display name
   - Toggle audio/video before joining
4. Click **"Join Meeting"** to enter the room
5. Share the **meeting code** or **meeting link** with participants

### Joining a Meeting

1. Enter the **meeting code** in the "Join Meeting" field on the landing page
2. Click **"Join"**
3. Preview your devices in the Pre-Meeting screen
4. Click **"Join Meeting"**

### Meeting Link Format

```
http://localhost:5173/meeting/<meeting-code>/preview
```

---

## 6. User Guide — Scheduling

### Schedule a Future Meeting

1. From the landing page, click **"📅 Schedule for Later"**
2. Fill in the scheduling form:

| Field | Description |
|-------|-------------|
| **Title** | e.g., "Weekly Team Standup" |
| **Description** | Optional agenda or notes |
| **Date** | Future date picker |
| **Time** | Time picker |
| **Duration** | 15 min to 2 hours |
| **Recurrence** | None, Daily, Weekly, Biweekly, Monthly |
| **Repeat Until** | End date for recurring meetings |

3. **Invite Participants**:
   - Type an email address and press Enter or click "+ Add"
   - Invitees appear as removable chips
   - Add as many participants as needed

4. **Configure Settings**:
   - 🚪 Waiting Room — require host approval before joining
   - 🔐 End-to-End Encryption — enable E2EE
   - 🎥 Allow Recording — enable meeting recording
   - Max Participants — 2 to 500
   - Meeting Password — optional access protection

5. Review the **Calendar Preview** panel
6. Click **"📅 Schedule Meeting"**

### After Scheduling

- A confirmation screen shows all meeting details
- Click **"📋 Copy Invitation"** to copy a formatted invitation:
  ```
  You're invited to a meeting!

  📋 Weekly Team Standup
  📅 2/25/2026, 10:00:00 AM
  ⏱ 60 minutes
  🔗 http://localhost:5173/meeting/ABC-DEF-GHI/preview
  📝 Code: ABC-DEF-GHI

  Powered by QS-VC
  ```

---

## 7. User Guide — In-Meeting Controls

### Control Bar (Bottom of Screen)

| Button | Function |
|--------|----------|
| 🎤 / 🔇 **Mute** | Toggle microphone |
| 📹 / 📵 **Video** | Toggle camera |
| 🔔 / 🔕 **Denoise** | Toggle noise suppression |
| 🖥️ / 🛑 **Share** | Start/stop screen sharing |
| ⏺️ / ⏹️ **Record** | Start/stop recording |
| 🌄 / 🖼️ **BG** | Toggle virtual background |
| ✋ / 🙋 **Raise** | Raise/lower hand |
| 👥 **People** | Show/hide participants panel |
| 💬 **Chat** | Show/hide chat panel |
| 💬 / 📝 **CC** | Toggle live captions |
| 📞 **Leave** | Leave the meeting |

### Virtual Background Modes

- **Blur** — Gaussian blur on background (default 12px)
- **Image** — Replace background with a custom image
- **Color** — Replace background with a solid color

### Live Captions

Powered by the Web Speech API:
- Real-time speech-to-text transcription
- Interim results shown as they're being spoken
- Final results displayed with speaker name
- Works best in Chrome

### Noise Suppression

Uses RNNoise WASM module:
- Removes background noise from microphone
- Falls back to DynamicsCompressor if WASM unavailable

---

## 8. Admin Dashboard

Access the admin dashboard at:

> **http://localhost:5173/admin**

### Tabs Overview

| Tab | Description |
|-----|-------------|
| **📊 Overview** | 6 KPI cards (active meetings, participants, users, recordings, meetings today, avg duration) + service health dots |
| **📹 Meetings** | Live active meeting table with join action |
| **👤 Users** | Searchable/filterable user management table with role badges (admin/user/guest) and status badges (active/suspended/invited) |
| **🎙️ Recordings** | Browseable recording list with playback navigation |
| **📈 Analytics** | Meeting volume bar chart, participant trend line, feature usage breakdown, peak hours heatmap |
| **⚙️ System** | Service endpoint configuration, health checks, feature flags |

### System Health Indicators

| Color | Status |
|-------|--------|
| 🟢 Green | Healthy |
| 🟡 Yellow | Degraded |
| 🔴 Red | Down |

---

## 9. Architecture Reference

### Service Architecture

```
┌──────────────────────────────────────────────────┐
│                   FRONTEND                        │
│          React + Vite (Port 5173)                 │
└───────────────┬──────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐  ┌───▼───┐  ┌───▼───┐  ┌────────┐  ┌──────────┐
│ Auth  │  │Meeting│  │  Sig  │  │  SFU   │  │Recording │
│ :4002 │  │ :4003 │  │ :4001 │  │ :4000  │  │  :4004   │
└───┬───┘  └───┬───┘  └───┬───┘  └───┬────┘  └────┬─────┘
    │          │          │          │              │
┌───▼──────────▼──────────▼──────────▼──────────────▼─────┐
│          PostgreSQL (5432) + Redis (6379)                │
│                  + MinIO (9000)                          │
└─────────────────────────────────────────────────────────┘
```

### Directory Structure

```
QS_VC/
├── frontend/web/           # React + Vite frontend
│   ├── src/
│   │   ├── components/     # ControlBar, VideoGrid, ChatPanel, etc.
│   │   ├── pages/          # Landing, PreMeeting, MeetingRoom, ScheduleMeeting
│   │   ├── lib/            # media, signaling, e2ee, virtual-bg, noise-suppression
│   │   └── styles/         # Design system (index.css)
│   └── index.html
├── services/
│   ├── sfu/                # mediasoup SFU media engine
│   ├── signaling/          # WebSocket signaling + JSON-RPC 2.0
│   ├── auth/               # JWT auth, user management
│   ├── meeting/            # Meeting lifecycle, scheduling
│   └── recording/          # MediaRecorder + S3 storage
├── db/migrations/          # PostgreSQL schema
├── nginx/                  # Production reverse proxy config
├── docker-compose.yml      # Development infrastructure
├── docker-compose.prod.yml # Production with TLS
└── .github/workflows/      # CI pipeline
```

---

## 10. API Reference

### Auth Service (port 4002)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/profile` | Get current user profile |
| PUT | `/api/auth/profile` | Update profile |
| GET | `/health` | Health check |

### Meeting Service (port 4003)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/meetings` | Create meeting (instant/scheduled) |
| GET | `/api/meetings/:code` | Get meeting details |
| PUT | `/api/meetings/:code/status` | Update meeting status |
| POST | `/api/meetings/:code/join` | Join meeting |
| POST | `/api/meetings/:code/chat` | Send chat message |
| GET | `/health` | Health check |

### Recording Service (port 4004)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/recordings/start` | Start recording |
| POST | `/api/recordings/:id/chunk` | Upload recording chunk |
| POST | `/api/recordings/:id/complete` | Complete recording |
| GET | `/api/recordings` | List all recordings |
| GET | `/health` | Health check |

### Signaling Server (port 4001)

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| WebSocket | `ws://localhost:4001/ws` | JSON-RPC 2.0 signaling |
| HTTP | `/health` | Health check |

---

## 11. Configuration Reference

### Environment Variables

All variables have sensible **defaults for local development**. Override for production.

#### Auth Service

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_PORT` | 4002 | HTTP port |
| `JWT_SECRET` | dev-jwt-secret... | JWT signing key |
| `JWT_EXPIRY` | 24h | Token expiration |
| `POSTGRES_HOST` | localhost | Database host |
| `POSTGRES_PORT` | 5432 | Database port |
| `POSTGRES_DB` | qsvc | Database name |
| `POSTGRES_USER` | qsvc | Database user |
| `POSTGRES_PASSWORD` | qsvc_dev_2025 | Database password |
| `CORS_ORIGINS` | * | Allowed origins |

#### Signaling Service

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGNALING_PORT` | 4001 | HTTP/WS port |
| `SFU_INTERNAL_URL` | http://localhost:4000 | SFU backend URL |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |

#### SFU Service

| Variable | Default | Description |
|----------|---------|-------------|
| `SFU_PORT` | 4000 | HTTP port |
| `SFU_ANNOUNCED_IP` | 127.0.0.1 | WebRTC announced IP |
| `SFU_NUM_WORKERS` | 2 | mediasoup workers |
| `SFU_MIN_PORT` | 40000 | RTC port range start |
| `SFU_MAX_PORT` | 49999 | RTC port range end |

---

## 12. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **PowerShell script execution blocked** | Use `cmd /c "command"` or run `Set-ExecutionPolicy RemoteSigned` as admin |
| **Docker Desktop not running** | Open Docker Desktop app, wait for it to fully start |
| **Port already in use** | Kill the process: `netstat -ano \| findstr :PORT` then `taskkill /PID <PID> /F` |
| **mediasoup build fails** | Install Visual Studio Build Tools with C++ workload |
| **CORS errors in browser** | Ensure services are running on expected ports |
| **WebSocket connection fails** | Check signaling server is running on port 4001 |
| **Camera/mic not working** | Allow browser permissions, use HTTPS or localhost |
| **Virtual background not loading** | Requires Chrome; MediaPipe CDN must be accessible |
| **Live captions unavailable** | Requires Chrome (Web Speech API not in Firefox) |

### Logs

All services log to stdout with `pino` logger. View logs in each terminal window.

### Restart a Service

Simply stop (Ctrl+C) and restart the command in that terminal.

---

## 13. Security Features

| Feature | Implementation |
|---------|---------------|
| **Input Validation** | Zod schemas on all 20+ API endpoints |
| **JWT Authentication** | bcrypt password hashing + JWT tokens |
| **WebSocket Auth** | Token from `?token=` query or `Authorization` header |
| **CORS** | Configurable origin allowlist via `CORS_ORIGINS` |
| **Rate Limiting** | express-rate-limit on all services (Auth: 10 req/15min for login) |
| **E2EE** | Insertable Streams + SFrame with Kyber-1024 PQC key exchange |
| **XSS Prevention** | HTML tag stripping on user inputs |
| **Error Handling** | Global Express error handler prevents stack trace leaks |
| **Env Validation** | Services crash on missing required vars |

---

## Quick Start Cheat Sheet

```bash
# 1. Install dependencies
npm install

# 2. Run tests
npx vitest run

# 3. Start Docker infrastructure
docker compose up -d postgres redis minio

# 4. Start services (each in a separate terminal)
cd services\signaling && npx tsx watch src/index.ts
cd services\auth && npx tsx watch src/index.ts
cd services\meeting && npx tsx watch src/index.ts
cd services\recording && npx tsx watch src/index.ts

# 5. Start frontend
cd frontend\web && npx vite

# 6. Open browser
start http://localhost:5173
```

---

*QS-VC — Quantum-Safe Video Conferencing Platform*
*Built with ❤️ using React, TypeScript, mediasoup, and WebRTC*
