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
runtime_images=(caddy:2-alpine postgres:16-alpine redis:7-alpine coturn/coturn:4.6.3)
runtime_services=(caddy postgres redis coturn)
if [[ "${QSVC_PACKAGE_OFFLINE_PILOT:-false}" == true ]]; then
  compose+=(-f "$repo_root/deploy/vc-onprem/stack/compose.offline.yml")
  export DOCKER_DEFAULT_PLATFORM=linux/amd64
  runtime_images=()
  runtime_services=()
  # Release builds use only digest-pinned base images.
  pinned='@sha256:[0-9a-f]{64}$'
  for var in QSVC_ALPINE_IMAGE QSVC_SFU_BUILD_BASE QSVC_SFU_RUNTIME_BASE; do
    [[ "${!var:-}" =~ $pinned ]] || { echo "Set $var to a digest-pinned image (name@sha256:...)" >&2; exit 2; }
  done
  export QSVC_SFU_BUILD_BASE QSVC_SFU_RUNTIME_BASE
  for dockerfile in "$repo_root"/deploy/vc-onprem/stack/*/Dockerfile; do
    while read -r _ image _; do
      [[ "$image" == '${'* || "$image" =~ $pinned || "$image" == builder ]] \
        || { echo "Unpinned base image $image in $dockerfile" >&2; exit 2; }
    done < <(grep -E '^FROM ' "$dockerfile")
  done
  for service in caddy postgres redis coturn; do
    app_images+=("qsvc-$service:intranet")
    build_args=()
    [[ "$service" == coturn ]] && build_args+=(--build-arg "ALPINE_IMAGE=$QSVC_ALPINE_IMAGE")
    docker build --platform linux/amd64 ${build_args[@]+"${build_args[@]}"} -t "qsvc-$service:intranet" "$repo_root/deploy/vc-onprem/stack/$service"
  done
else
  runtime_images+=(minio/minio:latest)
  runtime_services+=(minio)
fi

if (( ${#runtime_services[@]} > 0 )); then
  "${compose[@]}" pull "${runtime_services[@]}"
fi
if [[ "${QSVC_PACKAGE_SSO:-false}" == true ]]; then
  "${compose[@]}" --profile sso pull keycloak keycloak-db
  keycloak_image=$("${compose[@]}" --profile sso config --format json | python3 -c 'import json, sys; print(json.load(sys.stdin)["services"]["keycloak"]["image"])')
  docker tag "$keycloak_image" "${keycloak_image%@*}"
  # Preserve the tag in the offline archive and verify the pinned digest via the manifest.
  runtime_images+=("${keycloak_image%@*}")
fi
"${compose[@]}" build sfu signaling auth meeting recording web

mkdir -p "$output_dir/sbom" "$output_dir/scans"
scan_work=$(mktemp -d)
trap 'rm -rf -- "$scan_work"' EXIT
for image in "${app_images[@]}" ${runtime_images[@]+"${runtime_images[@]}"}; do
  if [[ "${QSVC_PACKAGE_OFFLINE_PILOT:-false}" == true ]]; then
    platform=$(docker image inspect --platform linux/amd64 --format '{{.Os}}/{{.Architecture}}' "$image")
    [[ "$platform" == linux/amd64 ]] || { echo "Unexpected platform $platform for $image" >&2; exit 2; }
  fi
  scan_image=$image
  if [[ "${QSVC_PACKAGE_OFFLINE_PILOT:-false}" == true ]]; then
    docker save --platform linux/amd64 --output "$scan_work/image.tar" "$image"
    scan_image="docker-archive:$scan_work/image.tar"
  fi
  name="${image//[:\/]/-}"
  sbom="$output_dir/sbom/$name.cdx.json"
  echo "Generating CycloneDX SBOM for $image"
  syft "$scan_image" -o cyclonedx-json > "$sbom"
  syft "$scan_image" -o spdx-json > "$output_dir/sbom/$name.spdx.json"
  echo "Scanning $image SBOM"
  syft "$scan_image" -o syft-json > "$output_dir/sbom/$name.syft.json"
  # The gate fails on any High/Critical, including findings with no fix ("wont-fix").
  # The only exception path is a person-reviewed OpenVEX file for this exact image:
  # deploy/vc-onprem/release/vex/<image-name>.openvex.json (see the README there).
  vex_args=()
  vex_file="$repo_root/deploy/vc-onprem/release/vex/$name.openvex.json"
  if [[ -f "$vex_file" ]]; then
    python3 "$repo_root/deploy/vc-onprem/release/vex/check-vex.py" "$vex_file" "$image"
    vex_args+=(--vex "$vex_file")
    mkdir -p "$output_dir/vex"
    cp "$vex_file" "$output_dir/vex/"
  fi
  grype "sbom:$output_dir/sbom/$name.syft.json" ${vex_args[@]+"${vex_args[@]}"} --fail-on high -o json > "$output_dir/scans/$name.grype.json"
done

save_args=()
if [[ "${QSVC_PACKAGE_OFFLINE_PILOT:-false}" == true ]]; then
  save_args+=(--platform linux/amd64)
fi
docker save ${save_args[@]+"${save_args[@]}"} --output "$output_dir/qsvc-intranet-images.tar" "${app_images[@]}" ${runtime_images[@]+"${runtime_images[@]}"}
cp "$compose_file" "$output_dir/docker-compose.prod.yml"
mkdir -p "$output_dir/config" "$output_dir/db" "$output_dir/deploy/keycloak" "$output_dir/deploy/turn"
cp -R "$repo_root/deploy/turn/." "$output_dir/deploy/turn/"
cp -R "$repo_root/deploy/keycloak/." "$output_dir/deploy/keycloak/"
cp "$repo_root/config/Caddyfile.template" "$output_dir/config/Caddyfile.template"
cp -R "$repo_root/db/migrations" "$output_dir/db/migrations"
cp "$repo_root/db/create-application-accounts.sql" "$output_dir/db/create-application-accounts.sql"
cp "$repo_root/db/verify-access.sql" "$output_dir/db/verify-access.sql"
cp "$repo_root/docs/ENTERPRISE_SSO.md" "$output_dir/ENTERPRISE_SSO.md"
cp "$repo_root/docs/PRODUCTION_INTRANET.md" "$output_dir/PRODUCTION_INTRANET.md"
mkdir -p "$output_dir/scripts"
cp "$repo_root/scripts/provision-security-keys.mjs" "$output_dir/scripts/"
cp "$repo_root/docs/SECURITY_REMEDIATION_2026-11.md" "$output_dir/SECURITY_REMEDIATION_2026-11.md"

{
  echo "Source revision: $(git -C "$repo_root" rev-parse HEAD)"
  echo "Packaged on: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Images:"
  for image in "${app_images[@]}" ${runtime_images[@]+"${runtime_images[@]}"}; do
    inspect_args=()
    if [[ "${QSVC_PACKAGE_OFFLINE_PILOT:-false}" == true ]]; then
      inspect_args+=(--platform linux/amd64)
    fi
    printf '%s %s\n' "$image" "$(docker image inspect "${inspect_args[@]}" --format '{{.Id}}' "$image")"
  done
  echo "The deployment .env file is intentionally not included."
} > "$output_dir/IMAGE-MANIFEST.txt"

(cd "$output_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "Intranet release bundle created at $output_dir"
