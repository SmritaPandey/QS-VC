#!/usr/bin/env bash
set -euo pipefail
# Collect only fixed fields. Environment variables, request URLs, and logs are excluded.
docker version --format '{{.Server.Version}}'
docker compose version --short
for service in caddy auth meeting signaling sfu coturn postgres redis recording web; do
  printf '%s ' "$service"
  docker inspect --type container --format '{{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}}' "qsvc-$service" 2>/dev/null || printf 'unavailable\n'
done
