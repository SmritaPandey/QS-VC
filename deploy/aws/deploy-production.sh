
#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

cd /opt/qsvc

COMPOSE="deploy/aws/compose.yml"
ENV_FILE="deploy/aws/.env"

echo "Checking production deployment..."

test -f "$COMPOSE"
test -f "$ENV_FILE"
test -f "db/migrate.js"
test -f "certs/rds-ca.pem"

# Ensure the deployment includes the expected migration.
test -f "db/migrations/006_enterprise_access_terms.sql"

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
