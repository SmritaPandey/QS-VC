# QS-VC: DevOps Pipeline (CI/CD)

---

## 1. DevOps Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ DEVOPS PIPELINE                                                               │
│                                                                               │
│  Developer                                                                    │
│     │                                                                         │
│     │ git push                                                                │
│     ▼                                                                         │
│  ┌──────────┐    ┌────────────┐    ┌────────────┐    ┌──────────────────┐    │
│  │ GitLab   │───►│ CI Pipeline│───►│ Container  │───►│ ArgoCD           │    │
│  │ (Source) │    │ (GitLab CI)│    │ Registry   │    │ (GitOps Deploy)  │    │
│  │          │    │            │    │ (Harbor)   │    │                  │    │
│  │ • Mono-  │    │ • Build    │    │            │    │ • Sync to K8s   │    │
│  │   repo   │    │ • Test     │    │ • Signed   │    │ • Canary/Blue-  │    │
│  │ • MR/PR  │    │ • Scan     │    │   images   │    │   Green         │    │
│  │   gates  │    │ • Package  │    │ • Vuln scan│    │ • Auto-rollback │    │
│  └──────────┘    └────────────┘    └────────────┘    └──────────────────┘    │
│                                                               │               │
│                                                               ▼               │
│                                                    ┌──────────────────────┐  │
│                                                    │ Kubernetes Clusters   │  │
│                                                    │ ┌─────┐ ┌─────┐     │  │
│                                                    │ │ Dev │ │ Stg │     │  │
│                                                    │ └─────┘ └─────┘     │  │
│                                                    │ ┌─────┐ ┌─────┐     │  │
│                                                    │ │ Prod│ │ Prod│     │  │
│                                                    │ │(Ind)│ │(US) │     │  │
│                                                    │ └─────┘ └─────┘     │  │
│                                                    └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CI Pipeline Stages

```yaml
# .gitlab-ci.yml (simplified)
stages:
  - validate
  - build
  - test
  - security
  - package
  - deploy-dev
  - integration-test
  - deploy-staging
  - performance-test
  - deploy-production

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STAGE 1: VALIDATE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lint:
  stage: validate
  parallel:
    matrix:
      - SERVICE: [meeting-service, auth-service, recording-service, ai-service]
  script:
    - cd services/$SERVICE
    - golangci-lint run ./...     # Go services
    - eslint --ext .ts ./src     # Node.js services
  rules:
    - changes: ["services/$SERVICE/**"]

schema-validate:
  stage: validate
  script:
    - sqlfluff lint db/migrations/
    - buf lint proto/

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STAGE 2: BUILD
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
build:
  stage: build
  parallel:
    matrix:
      - SERVICE: [meeting-service, auth-service, recording-service, 
                   signaling-service, ai-service, admin-service, sfu-worker]
  script:
    - docker build -t $REGISTRY/$SERVICE:$CI_COMMIT_SHA services/$SERVICE/
    - docker push $REGISTRY/$SERVICE:$CI_COMMIT_SHA
  cache:
    key: $SERVICE-$CI_COMMIT_REF_SLUG
    paths: [".cache/go-build", "node_modules"]

build-frontend:
  stage: build
  script:
    - cd frontend/web
    - npm ci
    - npm run build
    - docker build -t $REGISTRY/web-app:$CI_COMMIT_SHA .

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STAGE 3: TEST
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
unit-test:
  stage: test
  parallel:
    matrix:
      - SERVICE: [meeting-service, auth-service, recording-service]
  script:
    - cd services/$SERVICE
    - go test -v -race -coverprofile=coverage.out ./...
    - go tool cover -func=coverage.out
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
  coverage: '/total:\s+\(statements\)\s+(\d+.\d+)%/'

frontend-test:
  stage: test
  script:
    - cd frontend/web
    - npm run test -- --coverage --ci
    - npx playwright test  # E2E tests

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STAGE 4: SECURITY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
sast:
  stage: security
  script:
    - semgrep --config=auto services/
    - gosec ./services/...

container-scan:
  stage: security
  script:
    - trivy image --severity HIGH,CRITICAL $REGISTRY/$SERVICE:$CI_COMMIT_SHA
  allow_failure: false  # block on critical vulnerabilities

dependency-scan:
  stage: security
  script:
    - snyk test --all-projects --severity-threshold=high
    - npm audit --audit-level=high

secret-scan:
  stage: security
  script:
    - gitleaks detect --source . --verbose

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STAGE 5: PACKAGE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
helm-package:
  stage: package
  script:
    - helm lint charts/qsvc/
    - helm package charts/qsvc/ --version $VERSION
    - helm push qsvc-$VERSION.tgz oci://$REGISTRY/charts
    # Sign with cosign (PQC-compatible)
    - cosign sign $REGISTRY/$SERVICE:$CI_COMMIT_SHA

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STAGE 6-8: DEPLOY (ArgoCD-driven)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
deploy-dev:
  stage: deploy-dev
  script:
    - argocd app set qsvc-dev --parameter image.tag=$CI_COMMIT_SHA
    - argocd app sync qsvc-dev --prune
    - argocd app wait qsvc-dev --health

deploy-staging:
  stage: deploy-staging
  script:
    - argocd app set qsvc-staging --parameter image.tag=$CI_COMMIT_SHA
    - argocd app sync qsvc-staging
  when: manual  # manual gate for staging

deploy-production:
  stage: deploy-production
  script:
    # Canary deployment: 5% → 25% → 50% → 100%
    - argocd app set qsvc-prod --parameter canary.weight=5
    - argocd app sync qsvc-prod
    - sleep 300  # 5 min canary observation
    - check_error_rate qsvc-prod 0.1%  # abort if error > 0.1%
    - argocd app set qsvc-prod --parameter canary.weight=100
  when: manual
  only: [main]
  environment:
    name: production
    url: https://meet.qsvc.io
```

---

## 3. Monitoring & Observability Stack

```
┌──────────────────────────────────────────────────────────────────────────┐
│ OBSERVABILITY STACK                                                       │
│                                                                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │ METRICS          │  │ LOGGING          │  │ TRACING                 │  │
│  │ (Prometheus)     │  │ (Loki/ELK)       │  │ (Jaeger/Tempo)          │  │
│  │                  │  │                  │  │                         │  │
│  │ • SFU bandwidth  │  │ • Structured JSON│  │ • Request flow across   │  │
│  │ • QoS scores     │  │ • Log levels     │  │   all microservices     │  │
│  │ • API latency    │  │ • Correlation IDs│  │ • Media path tracing    │  │
│  │ • GPU utilization│  │ • Audit events   │  │ • Latency breakdown     │  │
│  │ • Meeting counts │  │                  │  │                         │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────────┬────────────┘  │
│           │                    │                          │               │
│           └────────────────────┴──────────────────────────┘               │
│                                │                                          │
│                                ▼                                          │
│                    ┌──────────────────────┐                               │
│                    │ GRAFANA              │                               │
│                    │ Unified Dashboard    │                               │
│                    │                      │                               │
│                    │ • Platform Overview  │                               │
│                    │ • SFU Cluster Health │                               │
│                    │ • AI Pipeline Perf.  │                               │
│                    │ • QoS by Region      │                               │
│                    │ • Error Budget/SLO   │                               │
│                    └──────────────────────┘                               │
│                                │                                          │
│                                ▼                                          │
│                    ┌──────────────────────┐                               │
│                    │ ALERTING             │                               │
│                    │ (PagerDuty/OpsGenie) │                               │
│                    │                      │                               │
│                    │ P1: SFU node down    │                               │
│                    │ P2: MOS < 3.0        │                               │
│                    │ P3: API latency > 2s │                               │
│                    │ P4: High error rate  │                               │
│                    └──────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key SLOs (Service Level Objectives)

| SLI | SLO Target | Alert Threshold |
|---|---|---|
| Meeting join success rate | > 99.9% | < 99.5% |
| Audio MOS (global avg) | > 4.0 | < 3.5 |
| API response time (P99) | < 500ms | > 1000ms |
| Media latency (P95) | < 200ms | > 400ms |
| Recording availability | > 99.99% | < 99.9% |
| AI caption latency (P95) | < 300ms | > 500ms |

---

## 4. Infrastructure as Code

```
Repository Structure:
infrastructure/
├── terraform/
│   ├── modules/
│   │   ├── eks-cluster/         # K8s cluster
│   │   ├── rds-postgresql/      # Database
│   │   ├── elasticache-redis/   # Cache
│   │   ├── s3-storage/          # Object storage
│   │   ├── cloudfront-cdn/      # CDN
│   │   ├── vpc-networking/      # Network
│   │   └── gpu-nodegroup/       # AI compute
│   ├── environments/
│   │   ├── dev/
│   │   ├── staging/
│   │   └── production/
│   │       ├── india/           # Region-specific
│   │       ├── us/
│   │       └── eu/
│   └── main.tf
├── helm/
│   └── charts/
│       └── qsvc/
│           ├── Chart.yaml
│           ├── values.yaml
│           ├── values-dev.yaml
│           ├── values-staging.yaml
│           ├── values-prod-india.yaml
│           └── templates/
│               ├── deployment-sfu.yaml
│               ├── deployment-api.yaml
│               ├── deployment-signaling.yaml
│               ├── deployment-ai.yaml
│               ├── hpa.yaml
│               ├── pdb.yaml
│               ├── networkpolicy.yaml
│               └── servicemonitor.yaml
├── ansible/
│   └── on-premise/
│       ├── playbooks/
│       │   ├── install.yml
│       │   ├── configure.yml
│       │   └── upgrade.yml
│       └── roles/
│           ├── k8s-setup/
│           ├── gpu-drivers/
│           ├── hsm-init/
│           └── security-hardening/
└── packer/
    └── images/
        ├── sfu-node.pkr.hcl       # Optimized SFU AMI
        └── ai-node.pkr.hcl        # GPU-optimized AMI
```

---

## 5. Release Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│ RELEASE STRATEGY                                                      │
│                                                                       │
│ SaaS Releases:                                                        │
│ • Continuous deployment to dev (every merge)                         │
│ • Weekly release to staging (Monday)                                 │
│ • Bi-weekly production release (canary → full)                       │
│ • Hotfix: fast-track pipeline (< 2 hour to production)              │
│                                                                       │
│ On-Premise Releases:                                                  │
│ • Quarterly release trains (Q1, Q2, Q3, Q4)                         │
│ • Critical security patches: ad-hoc with fast verification          │
│ • Packaged as: signed OCI bundles + Helm charts + AI model packs    │
│ • Delivery: secure download portal or encrypted USB media           │
│                                                                       │
│ Feature Flags:                                                        │
│ • LaunchDarkly / Unleash integration                                │
│ • Per-tenant feature rollout                                         │
│ • Kill switches for any feature                                      │
│ • A/B testing for UI changes                                        │
└──────────────────────────────────────────────────────────────────────┘
```
