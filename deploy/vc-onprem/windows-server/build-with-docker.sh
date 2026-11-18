#!/usr/bin/env bash
# Build QS-VC-Server-Setup-<version>.exe without a Windows machine: Inno Setup 6 under Wine in an
# Ubuntu container (works on macOS and Linux with Docker).
#   bash deploy/vc-onprem/windows-server/build-with-docker.sh VERSION OUTPUT_DIR APPLIANCE_DIR
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: build-with-docker.sh VERSION OUTPUT_DIR APPLIANCE_DIR' >&2; exit 2; }
version=$1; mkdir -p "$2"; out=$(cd -- "$2" && pwd)
here=$(cd -- "$(dirname -- "$0")" && pwd); repo=$(cd -- "$here/../../.." && pwd)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || { echo "Bad version: $version" >&2; exit 2; }
grep -q DRAFT-EULA-PLACEHOLDER "$repo/deploy/vc-onprem/installer/EULA.txt" && { echo 'EULA.txt is still the draft placeholder' >&2; exit 2; }
payload=$(cd -- "$3" && pwd)
zip="QS-VC-Server-Appliance-$version-HyperV.zip"
[[ -f "$payload/$zip" && -f "$payload/$zip.sha256" ]] || { echo 'Missing matching appliance ZIP/checksum' >&2; exit 2; }
expected=$(awk 'NR==1 {print $1}' "$payload/$zip.sha256")
actual=$(shasum -a 256 "$payload/$zip" | awk '{print $1}')
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ && "$(echo "$expected" | tr 'A-F' 'a-f')" == "$actual" ]] || { echo 'Appliance checksum mismatch' >&2; exit 2; }
image=qsvc-innosetup:6
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --platform linux/amd64 -t "$image" - <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive WINEDEBUG=-all WINEPREFIX=/opt/wine
RUN dpkg --add-architecture i386 && apt-get update \
 && apt-get install -y --no-install-recommends wine wine32:i386 wine64 ca-certificates curl xvfb xauth \
 && rm -rf /var/lib/apt/lists/*
# Official Inno Setup 6.7.4 installer from the jrsoftware/issrc GitHub release (pinned version).
RUN curl -fsSL -o /tmp/is.exe https://github.com/jrsoftware/issrc/releases/download/is-6_7_4/innosetup-6.7.4.exe \
 && xvfb-run -a wine /tmp/is.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR='C:\InnoSetup' \
 && test -f /opt/wine/drive_c/InnoSetup/ISCC.exe && rm /tmp/is.exe
DOCKER
fi
# Only the files the setup needs are mounted: the Windows Server folder, the EULA and the icon.
docker run --rm --platform linux/amd64 \
  -v "$here:/src/deploy/vc-onprem/windows-server:ro" \
  -v "$repo/deploy/vc-onprem/installer/EULA.txt:/src/deploy/vc-onprem/installer/EULA.txt:ro" \
  -v "$repo/frontend/desktop/assets/icon.ico:/src/frontend/desktop/assets/icon.ico:ro" \
  -v "$payload:/payload:ro" \
  -v "$out:/out" \
  -w /src/deploy/vc-onprem/windows-server "$image" \
  timeout 1800 wine 'C:\InnoSetup\ISCC.exe' "/DAppVersion=$version" '/DApplianceDir=Z:\payload' '/OZ:\out' QS-VC-Server-Setup.iss
ls -la "$out"/QS-VC-Server-Setup-"$version".exe
