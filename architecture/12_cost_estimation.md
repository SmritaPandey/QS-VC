# QS-VC: Cost Estimation Model

---

## 1. Infrastructure Costs (SaaS Mode — Monthly)

### Cloud Infrastructure (AWS/GCP — India + US + EU)

| Component | Specification | Monthly Cost (USD) |
|---|---|---|
| **K8s Cluster (API/Services)** | 20x c6i.2xlarge (8 vCPU, 16GB) across 3 regions | $14,400 |
| **SFU Media Nodes** | 30x c6i.4xlarge (16 vCPU, 32GB, Enhanced NW) | $32,400 |
| **GPU Nodes (AI)** | 8x g5.2xlarge (A10G, 8 vCPU, 32GB) | $16,800 |
| **GPU Nodes (AI — Summarization)** | 2x p4d.24xlarge (A100, spot) | $6,500 |
| **PostgreSQL (RDS)** | 3x db.r6g.2xlarge (Multi-AZ, 2TB) | $5,400 |
| **Redis (ElastiCache)** | 3x cache.r6g.xlarge cluster | $2,700 |
| **Kafka (MSK)** | 3x kafka.m5.xlarge (3-node cluster) | $2,100 |
| **ClickHouse (self-hosted)** | 3x r6i.2xlarge | $2,700 |
| **Elasticsearch** | 3x r6i.xlarge (managed) | $3,000 |
| **S3 / Object Storage** | 50TB recordings + assets | $1,200 |
| **CloudFront CDN** | 100TB egress/month | $8,500 |
| **TURN/STUN Servers** | 15x c6i.xlarge (global PoPs) | $5,400 |
| **Load Balancers** | 6x ALB + 6x NLB across regions | $1,800 |
| **Vault (HashiCorp)** | Enterprise license + HSM backend | $3,000 |
| **Monitoring (Datadog/Grafana Cloud)** | Enterprise plan | $3,000 |
| **Networking (VPC, VPN, DirectConnect)** | Inter-region + data transfer | $4,000 |
| **DNS (Route53 / CloudDNS)** | GeoDNS, health checks | $500 |
| **Miscellaneous** | Secrets, KMS, backups, logs | $2,000 |
| | | |
| **TOTAL INFRASTRUCTURE** | | **$115,400/mo** |
| **Annual Infrastructure** | | **$1,384,800/yr** |

### Scaling Cost Model

| Scale (Concurrent Users) | SFU Nodes | GPU Nodes | Total Infra/mo |
|---|---|---|---|
| 10,000 | 15 | 4 | $70,000 |
| 50,000 | 30 | 8 | $115,000 |
| 200,000 | 80 | 16 | $280,000 |
| 500,000 | 150 | 30 | $520,000 |
| 1,000,000 | 300 | 50 | $950,000 |

---

## 2. Development Costs (People)

### Phase 1–2 (Months 1–15)

| Role Category | Headcount | Avg CTC (INR/yr) | Annual Cost (INR) | Annual Cost (USD) |
|---|---|---|---|---|
| **Principal/Staff Engineers** | 5 | ₹60,00,000 | ₹3,00,00,000 | $360,000 |
| **Senior Engineers** | 20 | ₹40,00,000 | ₹8,00,00,000 | $960,000 |
| **Mid-Level Engineers** | 25 | ₹25,00,000 | ₹6,25,00,000 | $750,000 |
| **Junior Engineers** | 10 | ₹12,00,000 | ₹1,20,00,000 | $144,000 |
| **AI/ML Specialists** | 10 | ₹45,00,000 | ₹4,50,00,000 | $540,000 |
| **Product Managers** | 2 | ₹35,00,000 | ₹70,00,000 | $84,000 |
| **UX Designers** | 2 | ₹25,00,000 | ₹50,00,000 | $60,000 |
| **DevOps / SRE** | 5 | ₹35,00,000 | ₹1,75,00,000 | $210,000 |
| **QA Engineers** | 6 | ₹20,00,000 | ₹1,20,00,000 | $144,000 |
| **Security Specialists** | 5 | ₹45,00,000 | ₹2,25,00,000 | $270,000 |
| **Engineering Managers** | 4 | ₹50,00,000 | ₹2,00,00,000 | $240,000 |
| **CTO + VP Eng** | 2 | ₹80,00,000 | ₹1,60,00,000 | $192,000 |
| | | | | |
| **Total (96 people)** | **96** | | **₹32,95,00,000** | **$3,954,000/yr** |
| **With 30% overhead** | | | | **$5,140,000/yr** |

(Overhead includes: office, benefits, insurance, equipment, training, travel)

---

## 3. Software Licenses & Third-Party Services

| Service | Annual Cost (USD) |
|---|---|
| **GitLab Enterprise** (100 seats) | $50,000 |
| **HashiCorp Vault Enterprise** | $120,000 |
| **Keycloak** (open-source, support) | $20,000 |
| **NVIDIA AI Enterprise** (GPU runtime) | $80,000 |
| **Twilio / Telnyx** (PSTN, SIP trunks) | $60,000 |
| **Figma** (design) | $6,000 |
| **LaunchDarkly** (feature flags) | $18,000 |
| **PagerDuty** (alerting) | $12,000 |
| **Snyk** (security scanning) | $24,000 |
| **Domain, SSL, Code Signing** | $5,000 |
| **Legal / Compliance (ISO audit)** | $80,000 |
| **Miscellaneous SaaS** | $25,000 |
| | |
| **Total Licenses** | **$500,000/yr** |

---

## 4. On-Premise Hardware Costs (per customer)

### Small Deployment (50 concurrent meetings)

| Item | Qty | Unit Cost (USD) | Total |
|---|---|---|---|
| Application Server (32c/128GB/2TB NVMe) | 1 | $12,000 | $12,000 |
| AI Appliance (16c/64GB/2x A10 GPU) | 1 | $25,000 | $25,000 |
| Storage Server (8c/32GB/20TB RAID-10) | 1 | $8,000 | $8,000 |
| Network Switch (10GbE, 24-port) | 1 | $3,000 | $3,000 |
| UPS (3kVA rack) | 1 | $2,000 | $2,000 |
| | | **Total** | **$50,000** |

### Medium Deployment (200 concurrent meetings)

| Item | Qty | Unit Cost (USD) | Total |
|---|---|---|---|
| Application Server | 3 | $15,000 | $45,000 |
| AI Appliance (A10 GPU) | 2 | $25,000 | $50,000 |
| Storage Server (replicated) | 2 | $10,000 | $20,000 |
| Load Balancer (F5/HAProxy) | 1 | $8,000 | $8,000 |
| HSM (Thales Luna) | 1 | $15,000 | $15,000 |
| Network (25GbE switches) | 2 | $5,000 | $10,000 |
| Rack + UPS | 1 | $5,000 | $5,000 |
| | | **Total** | **$153,000** |

### Large Deployment (1000+ concurrent meetings)

| Item | Qty | Unit Cost (USD) | Total |
|---|---|---|---|
| Application Servers | 10 | $15,000 | $150,000 |
| Dedicated SFU Servers (bare-metal) | 5 | $20,000 | $100,000 |
| AI Appliances (A100 GPU) | 4 | $45,000 | $180,000 |
| Storage (Ceph cluster) | 3 | $15,000 | $45,000 |
| PostgreSQL HA servers | 2 | $12,000 | $24,000 |
| Redis cluster | 3 | $5,000 | $15,000 |
| Kafka cluster | 3 | $8,000 | $24,000 |
| HSM (active-passive) | 2 | $15,000 | $30,000 |
| Network (25GbE spine-leaf) | 4 | $8,000 | $32,000 |
| Rack + UPS + cooling | 2 | $10,000 | $20,000 |
| | | **Total** | **$620,000** |

---

## 5. Total Cost Summary (3-Year Projection)

### SaaS Business Model

| Category | Year 1 | Year 2 | Year 3 | 3-Year Total |
|---|---|---|---|---|
| **People** | $5,140,000 | $7,200,000 | $9,500,000 | $21,840,000 |
| **Infrastructure** | $840,000 | $1,400,000 | $2,400,000 | $4,640,000 |
| **Licenses & Services** | $500,000 | $600,000 | $700,000 | $1,800,000 |
| **Compliance & Legal** | $200,000 | $150,000 | $150,000 | $500,000 |
| **Marketing & Sales** | $300,000 | $800,000 | $1,500,000 | $2,600,000 |
| **Office & Operations** | $400,000 | $500,000 | $600,000 | $1,500,000 |
| | | | | |
| **Total OPEX** | **$7,380,000** | **$10,650,000** | **$14,850,000** | **$32,880,000** |
| **Total OPEX (INR)** | **₹61.5 Cr** | **₹88.7 Cr** | **₹123.7 Cr** | **₹274 Cr** |

---

## 6. Revenue Model

### Pricing Tiers (SaaS)

| Plan | Price/user/month | Features |
|---|---|---|
| **Free** | $0 | 40-min meetings, 100 participants, no recording |
| **Pro** | $12.99 | 24h meetings, 300 participants, cloud recording, AI captions |
| **Business** | $19.99 | 500 participants, translation, SSO, admin, analytics |
| **Enterprise** | Custom ($25–40) | 1000+ participants, E2EE, on-prem, PQC, SLA, dedicated support |

### On-Premise Licensing

| Size | License (perpetual) | AMC (20%/yr) |
|---|---|---|
| **Small** (up to 500 users) | $100,000 | $20,000/yr |
| **Medium** (up to 2000 users) | $300,000 | $60,000/yr |
| **Large** (up to 10000 users) | $750,000 | $150,000/yr |
| **Unlimited** | $1,500,000 | $300,000/yr |

### Break-Even Analysis

```
Assumptions:
- Year 1: 5,000 paying users (avg $15/user/mo)
- Year 2: 50,000 paying users
- Year 3: 200,000 paying users
- On-prem: 5 deals in Y2, 15 deals in Y3

Revenue:
  Year 1: $0.9M  (SaaS) + $0 (On-Prem)        = $0.9M
  Year 2: $9.0M  (SaaS) + $1.5M (On-Prem)     = $10.5M
  Year 3: $36.0M (SaaS) + $5.0M (On-Prem)     = $41.0M

Break-Even: Month 24–28 (early Year 3)
```

---

## 7. Cost Optimization Strategies

| Strategy | Savings |
|---|---|
| **Spot/Preemptible instances** for non-real-time AI (summarization) | 60–70% on GPU costs |
| **Reserved instances** (1-year commit) for SFU nodes | 30–40% on compute |
| **Codec efficiency** (AV1 → 30% less bandwidth vs VP9) | 20–30% on CDN costs |
| **Edge caching** (TURN co-located at ISP PoPs) | 15–20% on bandwidth |
| **Autoscaling** (scale-to-zero for dev/staging) | 40–50% on non-prod |
| **Open-source stack** (mediasoup, Keycloak, MinIO, PostgreSQL) | $0 license cost for core |
| **India-based engineering** (vs US-based) | 60–70% on payroll |
