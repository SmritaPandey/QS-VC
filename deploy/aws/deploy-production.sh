
#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

cd /opt/qsvc

COMPOSE="deploy/aws/compose.yml"
ENV_FILE="deploy/aws/.env"
INSTALLER_DIR="deploy/aws/installers"
WINDOWS_INSTALLER="$INSTALLER_DIR/QS-VC-Windows-x64.zip"
MAC_ARM64_INSTALLER="$INSTALLER_DIR/QS-VC-macOS-arm64.zip"
MAC_X64_INSTALLER="$INSTALLER_DIR/QS-VC-macOS-x64.zip"
LINUX_X64_INSTALLER="$INSTALLER_DIR/QS-VC-Linux-x64.zip"

echo "Checking production deployment..."

test -f "$COMPOSE"
test -f "$ENV_FILE"
test -f "db/migrate.js"
test -f "certs/rds-ca.pem"

# Ensure the deployment includes the latest required access and admin analytics migrations.
test -f "db/migrations/006_enterprise_access_terms.sql"
test -f "db/migrations/009_platform_admin_analytics.sql"
test -f "db/migrations/013_linux_desktop_support.sql"
test -f "db/migrations/014_meeting_transcripts.sql"

# Installer archives and their release checksums are built on the protected platform
# runners. Verify every package that is present; a package that has not been built yet
# only disables its download (the auth service reports it as unavailable) and must not
# block a backend or web release.
install -d -m 0755 "$INSTALLER_DIR"
staged=0
for installer in "$WINDOWS_INSTALLER" "$MAC_ARM64_INSTALLER" "$MAC_X64_INSTALLER" "$LINUX_X64_INSTALLER"; do
  name="$(basename "$installer")"
  if [[ ! -s "$installer" ]]; then
    echo "Warning: desktop package not present, download disabled: $name" >&2
    continue
  fi
  test -f "$installer.sha256" || { echo "Checksum missing for $name" >&2; exit 1; }
  # Compare hashes directly: checksum files written on Windows end lines with CRLF, which
  # `sha256sum --check` would treat as part of the file name.
  expected="$(tr -d '\r' < "$installer.sha256" | awk 'NR==1 {print tolower($1)}')"
  actual="$(sha256sum "$installer" | awk '{print $1}')"
  [[ "$expected" =~ ^[0-9a-f]{64}$ && "$expected" == "$actual" ]] || { echo "Checksum mismatch for $name" >&2; exit 1; }
  case "$name" in
    *.zip) unzip -tq "$installer" ;;
    *.tar.gz) tar -tzf "$installer" >/dev/null ;;
  esac
  chmod 0644 "$installer"
  staged=$((staged + 1))
done
echo "Verified and staged $staged desktop package(s)"

# This script must run under an approved privileged
# deployment identity with Docker and AWS permissions.

# The preceding pipeline stage must:
# 1. Verify an RDS snapshot
# 2. Validate the migration history
# 3. Install the approved source artifact
# 4. Build and test the new Docker images

echo "Retrieving temporary migration credentials..."

# Preferred: SSM Parameter Store (SecureString). Fallback: MIGRATION_DATABASE_URL in the
# server's .env, which is how this host was originally set up. The value is never printed.
MIGRATION_PARAMETER="/qsvc/production/migration-database-url"
MIGRATION_DATABASE_URL="$(
  aws ssm get-parameter \
    --region ap-south-1 \
    --name "$MIGRATION_PARAMETER" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true
)"
if [[ -z "$MIGRATION_DATABASE_URL" || "$MIGRATION_DATABASE_URL" == "None" ]]; then
  MIGRATION_DATABASE_URL="$(grep -E '^MIGRATION_DATABASE_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  if [[ -n "$MIGRATION_DATABASE_URL" ]]; then
    echo "Using the migration credential from the server .env (SSM parameter $MIGRATION_PARAMETER not found)."
  fi
fi
if [[ -z "$MIGRATION_DATABASE_URL" ]]; then
  echo "No migration database credential. Create the SecureString SSM parameter $MIGRATION_PARAMETER" >&2
  echo "(region ap-south-1) with the qsvcadmin PostgreSQL URL, or add MIGRATION_DATABASE_URL to $ENV_FILE." >&2
  exit 1
fi

test -n "$MIGRATION_DATABASE_URL"
export MIGRATION_DATABASE_URL

# Disallow logging secrets and remove the shell's
# exported copy after migration execution.
trap 'unset MIGRATION_DATABASE_URL' EXIT

echo "Running pending database migrations..."

docker compose \
  -f "$COMPOSE" \
  --env-file "$ENV_FILE" \
  --profile maintenance \
  run --rm migrate

unset MIGRATION_DATABASE_URL

echo "Migrations successful."

echo "Starting updated QS_VC services..."

docker compose \
  -f "$COMPOSE" \
  --env-file "$ENV_FILE" \
  up -d --no-build

# Caddy reads its config only at start. The Caddyfile is a bind mount that each release
# replaces, so restart the proxy to pick up new routes (for example /api/signaling-ticket).
docker compose \
  -f "$COMPOSE" \
  --env-file "$ENV_FILE" \
  restart proxy

echo "Container deployment completed."

docker compose \
  -f "$COMPOSE" \
  --env-file "$ENV_FILE" \
  ps
