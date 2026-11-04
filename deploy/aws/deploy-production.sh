
#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

cd /opt/qsvc

COMPOSE="deploy/aws/compose.yml"
ENV_FILE="deploy/aws/.env"
INSTALLER_DIR="deploy/aws/installers"
INSTALLER="$INSTALLER_DIR/QS-VC-Windows-Setup.exe"
MAC_ARM64_INSTALLER="$INSTALLER_DIR/QS-VC-macOS-arm64.zip"
MAC_X64_INSTALLER="$INSTALLER_DIR/QS-VC-macOS-x64.zip"

echo "Checking production deployment..."

test -f "$COMPOSE"
test -f "$ENV_FILE"
test -f "db/migrate.js"
test -f "certs/rds-ca.pem"

# Ensure the deployment includes the expected migration.
test -f "db/migrations/006_enterprise_access_terms.sql"

# Reassemble the verified release artifact from tracked split parts so the
# authenticated enterprise download endpoint has a real file after deployment.
install -d -m 0755 "$INSTALLER_DIR"
cat \
  deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part00 \
  deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part01 \
  deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part02 \
  deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part03 \
  > "$INSTALLER"
echo '807796fb30b062e5fdee1b028b8c51d21dabb72aef7b4f0fe6b6cf8e516c0b45  '"$INSTALLER" | sha256sum --check --status
chmod 0644 "$INSTALLER"
echo "Verified and staged Windows installer at $INSTALLER"

# Mac release archives are built on the protected macOS runner, included in
# the signed release bundle, and accompanied by release-specific checksums.
test -f "$MAC_ARM64_INSTALLER"
test -f "$MAC_X64_INSTALLER"
test -f "$MAC_ARM64_INSTALLER.sha256"
test -f "$MAC_X64_INSTALLER.sha256"
(
  cd "$INSTALLER_DIR"
  sha256sum --check --status QS-VC-macOS-arm64.zip.sha256
  sha256sum --check --status QS-VC-macOS-x64.zip.sha256
)
unzip -tq "$MAC_ARM64_INSTALLER"
unzip -tq "$MAC_X64_INSTALLER"
chmod 0644 "$MAC_ARM64_INSTALLER" "$MAC_X64_INSTALLER"
echo "Verified and staged Apple silicon and Intel Mac installers"

# This script must run under an approved privileged
# deployment identity with Docker and AWS permissions.

# The preceding pipeline stage must:
# 1. Verify an RDS snapshot
# 2. Validate the migration history
# 3. Install the approved source artifact
# 4. Build and test the new Docker images

echo "Retrieving temporary migration credentials..."

MIGRATION_DATABASE_URL="$(
  aws ssm get-parameter \
    --region ap-south-1 \
    --name "/qsvc/production/migration-database-url" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text
)"

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

echo "Container deployment completed."

docker compose \
  -f "$COMPOSE" \
  --env-file "$ENV_FILE" \
  ps
