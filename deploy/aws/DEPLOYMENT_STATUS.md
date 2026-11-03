# AWS backend preparation

Status: prepared locally; not provisioned or deployed. No live account settings
were changed in this task. No database credentials were retrieved.

## Observed in the authenticated console

- Existing `qs-db` PostgreSQL database is Available in Mumbai, ap-south-1c.
- Database VPC: vpc-04b920198a94df294. Publicly accessible: No.
- Database security group: sg-00959f7a8c88ab900; no inbound rule was displayed.
- Selected subnet: subnet-0969bcb33ff3a985a, ap-south-1a, in the same VPC.
- Its route table has an Active 0.0.0.0/0 route to an Internet gateway.
- Hostinger shows Cloudflare nameservers for qsvcmeet.com. DNS changes belong in
  Cloudflare; Hostinger's DNS records are inactive under this delegation.

## Prepared resources and scope

`backend-stack.json`: one t3.medium Amazon Linux 2023 host, 40 GiB encrypted gp3,
Standard CPU credits, IMDSv2, Elastic IPv4, SSM-only management role, public
HTTP/HTTPS and media/TURN ports, and private database ingress from the backend
security group only. No public SSH or database port. No new database, NAT gateway
or load balancer. Application source, credentials and DNS are separate steps.

Runtime config now separates backend DOMAIN from public WEB_URL/CORS_ORIGINS.
The Worker forwards the existing admin/user and ICE discovery routes as well as
auth/meeting/recording/signaling routes. Backend authorization still owns access.

## Scoped engineering self-review

Scope: AWS stack/config/proxy files and connected Cloudflare route allowlist.
Assumed load: small concurrent demo meetings, no high-availability guarantee.

- Correctness: full service/frontend build passes; three Worker tests pass,
  including additional public API forwarding. Stack JSON parses and structural
  assertions pass. Bootstrap passes bash syntax check and matches stack user data.
- Security/data loss: no secrets in template or user data; no SSH/database public
  ingress; RDS remains private; instance role is SSM Core only. No migrations or
  production writes executed. Public service access and IAM creation await approval.
- Concurrency/load: one host and a bounded media range, suitable for evaluation;
  no load measurements, redundancy or capacity claim.
- Tests: no AWS CloudFormation service validation, host boot, container runtime,
  real WebSocket handshake, HTTPS, media or RDS connectivity verified yet.
- Speed: no extra gateway/load balancer or application dependencies; browser
  build retains its pre-existing large-bundle warning.
- Lean: reuses existing Docker Compose services and existing RDS. No duplicate
  database or orchestration service introduced.

Verdict: ready for user review of the proposed creation/access scope, not a live
deployment pass. Docker is unavailable locally, so Compose/Caddy runtime checks
remain unverified. AWS launch permissions, pricing, quota, database application
accounts and private source transfer still need verification during deployment.
