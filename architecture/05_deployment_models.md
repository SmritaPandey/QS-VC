# QS-VC: Deployment Models

---

## 1. Deployment Model Comparison

| Dimension | SaaS | On-Premise | Hybrid |
|---|---|---|---|
| **Target** | SMB, Enterprise, Edu | Banks, Govt, Defense | Large Enterprise |
| **Infrastructure** | QS-VC managed cloud | Customer data center | Split (edge + cloud) |
| **Data Residency** | Region-selectable | 100% on-site | Data on-prem, compute split |
| **AI Processing** | Cloud GPU cluster | Local AI appliance | Edge AI + cloud overflow |
| **Scaling** | Auto (K8s HPA) | Manual capacity planning | Auto + reserved capacity |
| **Updates** | Continuous (zero-downtime) | Quarterly release trains | Auto cloud + manual edge |
| **Internet** | Required | Not required (air-gapped) | Required for cloud tier |
| **Cost Model** | Per-user/month subscription | Perpetual license + AMC | Hybrid subscription |

---

## 2. SaaS Deployment (Multi-Tenant Cloud)

### Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│ SAAS MULTI-TENANT ARCHITECTURE                                             │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ TENANT ISOLATION                                                     │  │
│  │                                                                      │  │
│  │ • Namespace-per-tenant in Kubernetes                                │  │
│  │ • Tenant ID in every DB query (Row-Level Security)                 │  │
│  │ • Separate encryption keys per tenant (Vault)                      │  │
│  │ • Network policies isolating tenant namespaces                     │  │
│  │ • Tenant-specific S3 buckets (recordings)                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ KUBERNETES CLUSTER TOPOLOGY                                          │  │
│  │                                                                      │  │
│  │  Control Plane (managed K8s: EKS/GKE)                               │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │ Node Pool: API Services                                         │ │  │
│  │  │ • 8 vCPU, 32GB RAM instances                                   │ │  │
│  │  │ • HPA: min 3, max 50 pods per service                         │ │  │
│  │  │ • Services: auth, meeting-orchestrator, chat, admin, billing   │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │ Node Pool: Media (SFU)                                          │ │  │
│  │  │ • 16 vCPU, 64GB RAM, 10Gbps NIC                               │ │  │
│  │  │ • Bare-metal or dedicated instances (no noisy neighbors)       │ │  │
│  │  │ • HPA: based on bandwidth utilization                          │ │  │
│  │  │ • Affinity: spread across AZs                                  │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │ Node Pool: AI/GPU                                               │ │  │
│  │  │ • NVIDIA A10G / T4 GPU instances                               │ │  │
│  │  │ • HPA: based on inference queue depth                          │ │  │
│  │  │ • Spot instances for non-real-time AI (summarization)          │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  REGIONS: India (Mumbai+Chennai), US (Virginia+Oregon), EU (Frankfurt+     │
│           Ireland), APAC (Singapore+Sydney), MEA (Bahrain)                 │
└────────────────────────────────────────────────────────────────────────────┘
```

### Auto-Scaling Configuration

```yaml
# SFU HPA - bandwidth-based autoscaling
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: sfu-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: sfu-mediasoup
  minReplicas: 5
  maxReplicas: 200
  metrics:
    - type: Pods
      pods:
        metric:
          name: sfu_bandwidth_utilization
        target:
          type: AverageValue
          averageValue: "70"   # scale at 70% bandwidth
    - type: Pods
      pods:
        metric:
          name: sfu_active_rooms
        target:
          type: AverageValue
          averageValue: "40"   # scale at 40 rooms per pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 120
```

---

## 3. On-Premise Deployment (Air-Gapped)

### Hardware Specification

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ON-PREMISE DEPLOYMENT — REFERENCE HARDWARE                               │
│                                                                          │
│ SMALL (50 concurrent meetings, 500 users)                                │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ 1x Application Server (2U Rack)                                     │ │
│ │ • 32 vCPU, 128GB RAM, 2TB NVMe SSD                                 │ │
│ │ • 2x 10GbE NIC                                                     │ │
│ │ • Runs: K3s (lightweight K8s), all microservices                   │ │
│ │                                                                     │ │
│ │ 1x AI Appliance (2U Rack)                                          │ │
│ │ • 16 vCPU, 64GB RAM, 1TB NVMe                                     │ │
│ │ • 2x NVIDIA A10 GPU                                                │ │
│ │ • Runs: Triton, all AI models                                      │ │
│ │                                                                     │ │
│ │ 1x Storage Server                                                   │ │
│ │ • 8 vCPU, 32GB RAM, 20TB RAID-10                                  │ │
│ │ • MinIO (S3-compatible), PostgreSQL                                │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ MEDIUM (200 concurrent meetings, 2000 users)                             │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ 3x Application Servers (clustered K8s)                              │ │
│ │ 2x AI Appliances (load-balanced Triton)                            │ │
│ │ 2x Storage Servers (replicated MinIO + PG)                         │ │
│ │ 1x Hardware Load Balancer (F5/HAProxy)                             │ │
│ │ 1x HSM (Thales Luna / AWS CloudHSM on-prem)                       │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ LARGE (1000+ concurrent meetings, 10000+ users)                         │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ 10x Application Servers (full K8s cluster)                          │ │
│ │ 5x Dedicated SFU Media Servers (bare-metal, 10GbE)                 │ │
│ │ 4x AI Appliances (A100 GPUs, clustered Triton)                    │ │
│ │ 3x Storage Servers (Ceph/MinIO distributed)                        │ │
│ │ 2x PostgreSQL HA (Patroni cluster)                                 │ │
│ │ 2x Redis Sentinel clusters                                        │ │
│ │ 1x Kafka cluster (3-node)                                         │ │
│ │ 2x HSMs (active-passive)                                           │ │
│ │ Network: 25GbE spine-leaf fabric                                   │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### Air-Gapped Installation Process

```
┌───────────────────────────────────────────────────────────────────┐
│ INSTALLATION WORKFLOW (Air-Gapped)                                 │
│                                                                    │
│ 1. MEDIA PREPARATION (at QS-VC facility)                          │
│    • Build all container images                                   │
│    • Package as OCI bundles on encrypted USB/HDD                 │
│    • Include: K8s binaries, Helm charts, AI model files          │
│    • Sign all packages with Dilithium digital signature           │
│    • Include offline Helm repo + container registry               │
│                                                                    │
│ 2. HARDWARE SETUP (at customer site)                              │
│    • Rack & stack servers                                         │
│    • Configure network (VLAN isolation, firewall rules)          │
│    • Initialize HSM with ceremony (split key holders)            │
│                                                                    │
│ 3. SOFTWARE DEPLOYMENT                                            │
│    • Boot installer from encrypted media                          │
│    • Verify digital signatures on all packages                   │
│    • Deploy private container registry (Harbor)                  │
│    • Push container images to private registry                   │
│    • Deploy K8s cluster (kubeadm / RKE2)                        │
│    • Apply Helm charts for all services                          │
│    • Initialize databases with schema + seed data               │
│    • Load AI models into Triton                                  │
│                                                                    │
│ 4. CONFIGURATION                                                   │
│    • Tenant setup (org name, branding, policies)                 │
│    • LDAP/AD integration                                          │
│    • TLS certificate installation                                 │
│    • TURN server configuration (internal IPs)                    │
│    • Recording storage path configuration                        │
│                                                                    │
│ 5. VALIDATION                                                      │
│    • Automated smoke test suite                                   │
│    • Media quality test (internal calls)                          │
│    • AI feature validation                                        │
│    • Security scan (CIS benchmarks)                              │
│    • Performance baseline measurement                            │
│                                                                    │
│ Total Installation Time: 4-8 hours (automated)                    │
└───────────────────────────────────────────────────────────────────┘
```

---

## 4. Hybrid Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HYBRID DEPLOYMENT                                                        │
│                                                                          │
│  CUSTOMER PREMISES (Edge)           QS-VC CLOUD (Central)               │
│  ┌────────────────────────┐        ┌────────────────────────────────┐   │
│  │ Edge Media Node         │        │ Central Orchestrator           │   │
│  │ • SFU (local meetings)  │◄──────►│ • Meeting scheduling           │   │
│  │ • TURN relay             │  VPN  │ • User management              │   │
│  │ • Local recording        │ tunnel│ • License enforcement          │   │
│  │ • AI inference (edge GPU)│       │ • Analytics aggregation        │   │
│  │                          │       │ • Software updates             │   │
│  │ Data that stays local:   │       │                                │   │
│  │ • Media streams          │       │ Data in cloud:                 │   │
│  │ • Recordings             │       │ • Config & policies            │   │
│  │ • Chat logs              │       │ • Aggregated analytics         │   │
│  │ • Transcripts            │       │ • License state                │   │
│  └────────────────────────┘        │ • Software artifacts           │   │
│                                     └────────────────────────────────┘   │
│                                                                          │
│  Cross-site meetings:                                                    │
│  • Signaling via cloud orchestrator                                     │
│  • Media: direct edge-to-edge (if connectivity allows)                  │
│  • Fallback: media via cloud SFU relay                                  │
│                                                                          │
│  Offline Mode:                                                           │
│  • Edge node operates independently if cloud connection lost            │
│  • Local meetings continue uninterrupted                                │
│  • State syncs when connection restores                                 │
│  • License grace period: 72 hours offline                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Low Bandwidth Optimization (India-Critical)

### Adaptive Bitrate Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│ BANDWIDTH ADAPTIVE STRATEGY                                           │
│                                                                       │
│ Bandwidth Detection:                                                  │
│ • WebRTC getStats() API — continuous monitoring                      │
│ • RTCP Receiver Reports — packet loss, jitter                        │
│ • Google Congestion Control (GCC) — send-side BWE                    │
│                                                                       │
│ TIER 1: EXCELLENT (> 2 Mbps per participant)                         │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ Video: 720p/1080p @ 30fps, VP9/AV1                               │ │
│ │ Audio: Opus 48kHz stereo, 128kbps                                │ │
│ │ Features: Full AI, screen share HD, virtual background           │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ TIER 2: GOOD (500 Kbps — 2 Mbps)                                    │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ Video: 360p @ 30fps, VP8                                         │ │
│ │ Audio: Opus 48kHz mono, 64kbps                                   │ │
│ │ Features: AI captions, screen share (reduced res)                │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ TIER 3: LIMITED (100 Kbps — 500 Kbps)                                │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ Video: 180p @ 15fps, VP8 (active speaker ONLY)                   │ │
│ │ Audio: Opus 16kHz mono, 32kbps                                   │ │
│ │ Features: Text captions only, no screen share                    │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ TIER 4: AUDIO ONLY (< 100 Kbps)                                     │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ Video: DISABLED                                                   │ │
│ │ Audio: Opus 8kHz mono, 16kbps (voice-optimized)                  │ │
│ │ Features: Audio + text chat only                                  │ │
│ │ Fallback: PSTN dial-in bridge                                    │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ TIER 5: OFFLINE SYNC (No connectivity)                               │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ • Meeting scheduled for async mode                               │ │
│ │ • Participants record audio/video messages offline               │ │
│ │ • Messages sync when connectivity restored                      │ │
│ │ • AI processes and summarizes async                              │ │
│ └───────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Edge Caching for India

```
Edge Cache Nodes at ISP Level:
┌──────────────────────────────┐
│ • Jio / Airtel / BSNL PoPs  │
│ • Cache: UI assets, WASM     │
│   modules, AI model shards   │
│ • TURN relay co-location     │
│ • Total: 50+ edge PoPs       │
│   across Tier-1, Tier-2,     │
│   Tier-3 Indian cities       │
└──────────────────────────────┘
```
