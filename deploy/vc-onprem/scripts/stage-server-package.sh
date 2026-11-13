#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: stage-server-package.sh SIGNED_TAR_GZ INSTALLER_DIRECTORY TRUSTED_ED25519_PUB TRUSTED_ML_DSA_65_PUB' >&2; exit 2; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
source_archive=$(realpath -- "$1")
destination=$(cd -- "$2" && pwd)
work=$(mktemp -d "$destination/.qsvc-stage.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
cp -- "$source_archive" "$work/archive.tar.gz"
mkdir "$work/payload"
python3 - "$work/archive.tar.gz" "$work/payload" <<'PY'
import sys
import tarfile

with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    if any(not (member.isfile() or member.isdir()) for member in members):
        raise SystemExit('Archive contains unsupported entries')
    archive.extractall(sys.argv[2], members=members, filter='data')
PY
bash "$scripts/../release/verify.sh" "$work/payload" "$3" "$4"
test -s "$work/payload/qsvc-intranet-images.tar"
test -s "$work/payload/docker-compose.prod.yml"
test -s "$work/payload/compose.offline.yml"
chmod 0644 "$work/archive.tar.gz"
# Never replace an existing live download implicitly.
ln -- "$work/archive.tar.gz" "$destination/QS-VC-On-prem-Installer.tar.gz"
echo 'Verified server package staged.'
