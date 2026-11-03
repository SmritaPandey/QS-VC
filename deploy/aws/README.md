# AWS demo deployment (separate from Windows intranet)

## Proposed AWS resources — approval required before creation

- Region: Mumbai, ap-south-1; existing default VPC shared with private qs-db.
- One Amazon Linux 2023 x86_64 EC2 t3.medium (2 vCPU, 4 GiB RAM).
- 40 GiB encrypted gp3 root disk; one Elastic IPv4 address.
- Instance metadata requires IMDSv2; CPU credits Standard to avoid surplus-credit fees.
- EC2 role: AmazonSSMManagedInstanceCore only, for administration without public SSH.
- No load balancer, NAT gateway, Kubernetes or RDS Proxy for this demo.
- Internet inbound: TCP 80/443; TCP/UDP 3478; TCP/UDP 40000–40100 (media);
  UDP 49152–49200 (TURN relay). No SSH, database or internal service ports exposed.
- RDS inbound 5432 must reference this backend's security group only, never an IP range.

AWS Pricing API returned t3.medium Linux Mumbai at $0.0448/hour on 2 November 2026:
$32.70 per 730-hour month, before storage, IPv4, database, data transfer and taxes.
Public IPv4 is $0.005/hour ($3.65 per 730 hours). Disk/database/transfer are additional.
This is a small demo host, not a production capacity guarantee or high-availability cluster.

## Deployment sequence

1. Approve cost and creation of the EC2 role/security groups/public service ports.
2. Launch using bootstrap.sh as user data, encrypted disk and IMDSv2 required.
3. Attach a stable Elastic IP. Allow backend security-group access on the private RDS
   security group; remove all other RDS ingress. Keep PubliclyAccessible=false.
4. Send a source archive excluding .git, .env*, .aws, node_modules, dist and credentials
   through a private temporary S3 transfer location. Use SSM to download/extract to
   /opt/qsvc. Remove the transfer object after verification; never make the bucket public.
5. Enter the two restricted application URLs privately in /opt/qsvc/deploy/aws/.env (mode 0600).
   Use qs_auth_app for AUTH_DATABASE_URL and qs_meeting_app for MEETING_DATABASE_URL.
   Use qsvcadmin only in MIGRATION_DATABASE_URL while running maintenance.
   Use .env.example for nonsecret settings. Generate JWT_SECRET and TURN_PASSWORD
   on the server. Set SFU_ANNOUNCED_IP to the Elastic IP.
6. Build: docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env build
7. Migrate before starting traffic:
   docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env --profile maintenance run --rm migrate
8. Run the demo-only guard before public access:
   docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env --profile maintenance run --rm -e QSVC_DEMO_DATABASE=yes migrate node deploy/aws/prepare-demo-db.cjs
   This disables the schema's seeded development administrator. It has
   a known demo password. Create synthetic accounts using auth's demo account tool;
   save generated credentials to a private file and never put them in logs/source.
   The demo account tool must use the same verified TLS settings as the services.
9. Start: docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env up -d
10. Verify /ready internally for auth/meeting; verify SQL migrations, login/logout,
    persisted contact enquiries and authenticated meeting scheduling against RDS.
11. Update qsvcmeet.com A record to the Elastic IP in Hostinger after checking existing
    A/AAAA/CAA records. Preserve mail/MX/TXT records. Caddy obtains/renews HTTPS after
    DNS reaches the server. No frontend secrets; website API/WebSocket URLs use its origin.
12. Test HTTPS, two external devices, camera/mic, chat, screen share, reconnect and TURN.

Recording is currently disabled in the source API. This deployment does not enable paid
recording or storage. Translation requires a separately configured available provider.
RDS migrations and private connectivity have not been executed by writing these files.

## Intranet on Windows

Keep the existing local database. This AWS compose file is Linux-host-specific and must
not replace the Windows intranet configuration. Windows may run Linux services through
WSL2/Docker Desktop (organisation licensing permitting) or a supported Linux VM. Intranet
clients connect over LAN; remote staff connect through the organisation's VPN. Local DNS,
trusted HTTPS, identity, storage and language models must be available locally for offline use.
There is no database synchronisation or automatic AWS failover.
