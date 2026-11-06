#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_root/.env.production}"
output_dir="${2:-$repo_root/release/intranet}"
compose_file="$repo_root/docker-compose.prod.yml"

if [[ ! -f "$env_file" ]]; then
  echo "Production environment file not found: $env_file" >&2
  exit 2
fi
for tool in docker syft grype sha256sum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required release tool is missing: $tool" >&2
    exit 2
  fi
done

compose=(docker compose --env-file "$env_file" -f "$compose_file")
app_images=(qsvc-sfu:intranet qsvc-signaling:intranet qsvc-auth:intranet qsvc-meeting:intranet qsvc-recording:intranet qsvc-web:intranet)
runtime_images=(caddy:2-alpine postgres:16-alpine redis:7-alpine minio/minio:latest coturn/coturn:4.6.3)

"${compose[@]}" pull caddy postgres redis minio coturn
"${compose[@]}" build sfu signaling auth meeting recording web

mkdir -p "$output_dir/sbom"
for image in "${runtime_images[@]}" "${app_images[@]}"; do
  name="${image//[:\/]/-}"
  sbom="$output_dir/sbom/$name.cdx.json"
  echo "Generating CycloneDX SBOM for $image"
  syft "$image" -o cyclonedx-json > "$sbom"
  echo "Scanning $image SBOM"
  grype "sbom:$sbom" --fail-on high
done

docker save --output "$output_dir/qsvc-intranet-images.tar" "${runtime_images[@]}" "${app_images[@]}"
cp "$compose_file" "$output_dir/docker-compose.prod.yml"
mkdir -p "$output_dir/config" "$output_dir/db"
cp "$repo_root/config/Caddyfile.template" "$output_dir/config/Caddyfile.template"
cp -R "$repo_root/db/migrations" "$output_dir/db/migrations"
cp "$repo_root/db/create-application-accounts.sql" "$output_dir/db/create-application-accounts.sql"
cp "$repo_root/db/verify-access.sql" "$output_dir/db/verify-access.sql"
cp "$repo_root/docs/PRODUCTION_INTRANET.md" "$output_dir/PRODUCTION_INTRANET.md"

{
  echo "Source revision: $(git -C "$repo_root" rev-parse HEAD)"
  echo "Packaged on: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Images:"
  for image in "${runtime_images[@]}" "${app_images[@]}"; do
    printf '%s %s\n' "$image" "$(docker image inspect --format '{{.Id}}' "$image")"
  done
  echo "The deployment .env file is intentionally not included."
} > "$output_dir/IMAGE-MANIFEST.txt"

(cd "$output_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "Intranet release bundle created at $output_dir"
