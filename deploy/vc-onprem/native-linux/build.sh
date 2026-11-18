#!/usr/bin/env bash
# Run on the release builder with the same Ubuntu 24.04 x86_64 / Node 22 target.
set -euo pipefail
[[ $# == 2 ]] || { echo 'Usage: build.sh VERSION NEW_OUTPUT_DIR' >&2; exit 2; }
version=$1; out=$(realpath -m -- "$2")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && ! -e $out ]] || { echo 'Use a release version and a new output path' >&2; exit 2; }
[[ $(node -p 'process.versions.node.split(".")[0]') == 22 && $(uname -m) == x86_64 ]] || { echo 'Build requires Node 22 on target-compatible x86_64 Linux' >&2; exit 2; }
repo=$(cd -- "$(dirname "$0")/../../.." && pwd)
cd "$repo"
npm ci --no-audit --no-fund
VITE_DEPLOYMENT=onprem npm run build
mkdir -p "$out"; out=$(cd "$out" && pwd)
cp package.json package-lock.json "$out/"
for service in auth meeting signaling sfu recording mcu; do
 mkdir -p "$out/services/$service"
 cp "services/$service/package.json" "$out/services/$service/"
 [[ ! -d services/$service/dist ]] || cp -R "services/$service/dist" "$out/services/$service/"
done
mkdir -p "$out/frontend/web"
cp frontend/web/package.json "$out/frontend/web/"
cp -R frontend/web/dist "$out/frontend/web/"
cp -R shared db "$out/"
cp -R deploy/vc-onprem/native-linux "$out/native-linux"
[[ -n ${QSVC_ONPREM_LICENSE_PUBLIC_KEY:-} ]] || { echo 'Set trusted public license key QSVC_ONPREM_LICENSE_PUBLIC_KEY' >&2; exit 2; }
mkdir -p "$out/trial"
cp deploy/vc-onprem/stack/trial/{state,gateway,stop-at-expiry}.cjs "$out/trial/"
openssl pkey -pubin -in "$QSVC_ONPREM_LICENSE_PUBLIC_KEY" -pubout -out "$out/trial/license-public.pem"
printf '%s\n' "$version" > "$out/VERSION"
# Install platform native production dependencies on the matching release builder.
(cd "$out" && npm ci --omit=dev --no-audit --no-fund)
# Existing signed release inventory rejects links; materialize workspace links.
cp -RL "$out/node_modules" "$out/node_modules-materialized"
rm -rf "$out/node_modules"
mv "$out/node_modules-materialized" "$out/node_modules"
python3 deploy/vc-onprem/release/manifest.py create "$out"
echo 'Stage ready. Sign its manifest using the existing release/sign.sh and trusted offline keys before delivery.'
