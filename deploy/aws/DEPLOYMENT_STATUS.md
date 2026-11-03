# Live AWS demo deployment

Verified 2026-11-03.

- Backend origin: https://backend.qsvcmeet.com
- Website: https://qsvcmeet.com
- AWS region: ap-south-1 (Mumbai)
- CloudFormation stack: qsvc-backend
- EC2 instance: i-06746b0582544f1c6, t3.small, Elastic IP 13.201.247.97
- Existing private PostgreSQL: qs-db; application connections use separate restricted accounts and verified TLS.
- Private recordings bucket: qsvc-backend-recordingsbucket-sxdmpqufwgrm. No automatic recording expiry; host deletes recordings.
- Runtime configuration: /opt/qsvc/deploy/aws/.env on EC2, mode 0600. No secrets copied into this report or repository.
- Services running: auth, meeting, signaling, sfu, recording, TURN, Caddy and web fallback. Auth and meeting readiness checks passed.
- Cloudflare Worker version: 1c0f380f-ec1f-4012-a8f5-594fa29ece6e.
- Worker runtime variable BACKEND_ORIGIN=https://backend.qsvcmeet.com; static website assets remain served by Cloudflare.
- DNS: backend.qsvcmeet.com A record points directly to the Elastic IP (DNS only).

## Verification

- Backend /health: HTTPS 200.
- Website /api/health: 200, runtime worker.
- Website /api/auth/login with an empty test request: expected validation error, HTTP 400. This verifies backend routing without creating an account.
- Website recording listing without authentication: expected HTTP 401.
- Recording service can access the private S3 bucket using the instance role.
- Website production build passed during deployment.

## Remaining validation and operational limits

A real signed-in meeting, two-participant media/TURN connection, recording upload, playback, sharing and deletion still need end-to-end verification. Infrastructure checks do not establish those behaviors.

This is a single-server demo using AWS credits; it is not a guaranteed free or highly available production deployment. EC2, disk, public IPv4, RDS, storage and traffic can incur AWS charges according to the account plan and credit balance.

Existing database migrations and application accounts were reused; no passwords were rotated. Temporary password input files remain root-only on EC2 and are not mounted into running services. Administrator credentials are not present in runtime service configuration.

The deployment used the current local source. No Git commit or push was made, so Git-connected future deployments must include the Worker configuration and code before rebuilding from main.
