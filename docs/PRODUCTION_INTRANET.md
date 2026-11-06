# Production intranet deployment (Linux x86_64)

This is the supported production path for a private enterprise network. `start-intranet.js` is a development launcher and does not provide production TLS or service hardening. The Compose profile runs one signaling instance because live room state is process-local; restarting it disconnects active calls. Do not add signaling replicas until room state and connection limits are shared.

## 1. Prepare the Linux host

Use a supported x86_64 Linux host with Docker Engine, the Docker Compose plugin, persistent storage, split-horizon DNS, and an address reachable by every meeting client. No database, Redis, SFU, or TURN ports should be exposed to the enterprise client VLAN directly.

Allow these inbound ports from approved enterprise networks only:

| Port | Purpose |
|---|---|
| TCP 443 | Web app, APIs, signaling over TLS |
| TCP 80 | HTTP to HTTPS redirect and internal certificate routing |
| UDP 3478 and TCP 3478 | TURN connectivity |
| UDP 40000–40100 | mediasoup SFU media |
| UDP 49152–49200 | TURN relay media |

Keep PostgreSQL 5432, Redis 6379, MinIO 9000/9001, and service ports 4000–4004 private to the Docker network.

## 2. Create deployment secrets

Copy `.env.production.example` to `.env.production` and replace every `REPLACE_...` value with a unique secret. Set `DOMAIN` to the intranet DNS name and `SFU_ANNOUNCED_IP` to the host's LAN address reachable by clients. Do not commit or package `.env.production`.

## 3. Build and scan the offline bundle

On an internet-connected Linux release machine, install Docker, Syft, and Grype. Then run:

```bash
bash scripts/package-intranet-images.sh .env.production release/intranet
```

The script builds the six QS-VC images, creates a CycloneDX SBOM for each runtime image, fails on a high or critical finding, saves the images, records their image IDs and source revision, and writes checksums. It intentionally excludes the environment file. Resolve scanner findings before distributing the archive.

Copy `release/intranet/` to the isolated Linux host. Verify the archive checksums before loading it:

```bash
cd /opt/qsvc
sha256sum -c SHA256SUMS
docker load --input qsvc-intranet-images.tar
```

## 4. Initialize the database and service roles

For a new database, the PostgreSQL image runs the checked-in migrations during first initialization. Start only the infrastructure first:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis minio coturn
```

Create the separate non-superuser application logins. Copy the script into the database container and run it as the private database administrator; `psql` prompts for each application password:

```bash
docker compose cp db/create-application-accounts.sql postgres:/tmp/create-application-accounts.sql
docker compose exec -it postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/create-application-accounts.sql'
```

`qs_auth_app` and `qs_meeting_app` must remain non-superusers with `BYPASSRLS` disabled. The Auth service can look up a sign-in identity across tenants because email sign-in happens before the tenant is known. The Meeting role is tenant-scoped and cannot read another tenant's meetings, transcripts, participants, chat, room numbers, or room devices.

Run the synthetic privilege and tenant-isolation check as the database administrator:

```bash
docker compose cp db/verify-access.sql postgres:/tmp/verify-access.sql
docker compose exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/verify-access.sql'
```

For an existing database, back it up first and apply pending migrations with the migration-only database administrator. The runner refuses to replay an existing schema when its migration ledger is missing; review the deployed migration history and record a reviewed baseline before proceeding.

## 5. Start the application

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

The Caddy proxy provisions a private internal CA certificate. After Caddy starts, export only its public root certificate and distribute it through the enterprise device-management process:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > qsvc-intranet-root.crt
```

Never export `/data/caddy/pki/authorities/local/root.key`. Clients must trust the root certificate and resolve `DOMAIN` to the intranet server for camera and microphone access over HTTPS.

## 6. Verify each release

Check service health, test sign-in with both application roles, and run two-device meeting checks from the real enterprise network. Confirm TLS trust, join approval, TURN fallback, SFU media, screen sharing, reconnect behavior, and database cross-tenant denial. The CI workflow also builds each app image, stores its SBOM as a workflow artifact, and scans it with Grype before passing the release gate.

No capacity target is published until the deployment is load-tested. Back up PostgreSQL and MinIO data on a schedule and rehearse restoration. A signaling restart loses in-memory room state and ends live calls. Keep one signaling instance in this profile.

For public internet deployment, use the separate AWS profile and its public TLS configuration; do not expose this internal-CA profile as a public service.

## Deployment smoke check

After every install or upgrade, run from a computer on the users' network:

```bash
npm run smoke:deploy -- https://<your-meeting-domain> [--ca <internal-ca.crt>] [--token <session token>]
```

It verifies TLS, the gateway, signaling → SFU service discovery, every published TURN server
(STUN answer plus an authenticated relay allocation) and the SFU's announced UDP media address
(a real ICE connectivity check, the same one browsers send). Exit code 0 means users can connect
and carry audio/video; any FAIL line names the setting to fix.

