# QS-VC: Quantum-Safe Video Conferencing Platform

> Enterprise-grade video conferencing with quantum-safe cryptography, AI-powered features, and multi-tenant SaaS architecture.

---

## Architecture

```
┌────────────────┐     ┌──────────────┐     ┌─────────────┐
│   Web Client   │◄───►│  Signaling   │◄───►│  SFU (media  │
│   (React 18)   │ WS  │  (Node.js)   │ HTTP│  soup)       │
└────────────────┘     └──────┬───────┘     └─────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
   ┌─────▼─────┐       ┌─────▼─────┐       ┌─────▼──────┐
   │    Auth    │       │  Meeting  │       │  Recording │
   │  Service   │       │  Service  │       │   Service  │
   └─────┬─────┘       └─────┬─────┘       └─────┬──────┘
         │                    │                    │
    ┌────▼────────────────────▼────────────────────▼────┐
    │            PostgreSQL 16  +  Redis 7              │
    └───────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite |
| **Desktop** | Electron 28 |
| **SFU** | mediasoup (Node.js) |
| **Signaling** | WebSocket + JSON-RPC 2.0 |
| **Backend** | Express.js + Zod validation |
| **Database** | PostgreSQL 16 + Redis 7 |
| **Storage** | MinIO (S3-compatible) |
| **TURN/STUN** | coturn |
| **Reverse Proxy** | Nginx (TLS 1.2/1.3) |
| **CI/CD** | GitHub Actions |
| **Containerization** | Docker Compose |

## Services

| Service | Port | Description |
|---------|------|-------------|
| **SFU** | 4000 | mediasoup-based Selective Forwarding Unit |
| **Signaling** | 4001 | WebSocket signaling server (JSON-RPC 2.0) |
| **Auth** | 4002 | JWT authentication, user management, RBAC |
| **Meeting** | 4003 | Meeting CRUD, scheduling, participant tracking |
| **Recording** | 4004 | Recording lifecycle, MinIO storage integration |
| **Web** | 5173 | React frontend (Vite dev server) |

## Prerequisites

- **Node.js** ≥ 20.0.0
- **Docker** & **Docker Compose** (for infrastructure services)
- **PostgreSQL 16** (via Docker or local)
- **Redis 7** (via Docker or local)

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d postgres redis minio coturn
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run database migrations

```bash
npm run db:migrate
```

### 4. Start all services (development)

```bash
npm run dev
```

This starts all 5 backend services and the web frontend concurrently.

### 5. Open the app

Visit **http://localhost:5173**

## Docker (Full Stack)

```bash
# Development
docker compose up

# Production (requires SSL certs in ./certs/)
docker compose -f docker-compose.prod.yml up -d
```

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Project Structure

```
QS_VC/
├── architecture/          # 13 architecture documents
├── db/migrations/         # PostgreSQL migrations
├── docs/                  # OpenAPI spec + User Manual
├── frontend/
│   ├── web/               # React + Vite web client
│   └── desktop/           # Electron desktop client
├── services/
│   ├── sfu/               # mediasoup SFU server
│   ├── signaling/         # WebSocket signaling
│   ├── auth/              # Authentication & identity
│   ├── meeting/           # Meeting orchestration
│   └── recording/         # Recording management
├── shared/                # Shared validation schemas
├── nginx/                 # Reverse proxy config
├── certs/                 # SSL certificates
├── docker-compose.yml     # Development stack
└── docker-compose.prod.yml # Production stack
```

## Documentation

- [System Architecture](architecture/01_system_architecture.md)
- [Component Design](architecture/02_component_design.md)
- [AI Architecture](architecture/03_ai_architecture.md)
- [Quantum Security](architecture/04_quantum_security.md)
- [Deployment Models](architecture/05_deployment_models.md)
- [Database Design](architecture/06_database_design.md)
- [API Structure](architecture/07_api_structure.md)
- [UI/UX Design](architecture/08_ui_ux_design.md)
- [DevOps Pipeline](architecture/09_devops_pipeline.md)
- [Roadmap](architecture/10_roadmap.md)
- [OpenAPI Spec](docs/openapi.yaml)
- [User Manual](docs/USER_MANUAL.md)

## Default Dev Credentials

| Service | Credential |
|---------|-----------|
| PostgreSQL | `qsvc` / `qsvc_dev_2025` |
| MinIO Console | `qsvc_minio` / `qsvc_minio_secret` (http://localhost:9001) |
| Admin User | `admin@qsvc.dev` / `admin123` |

## License

Proprietary — All rights reserved.
