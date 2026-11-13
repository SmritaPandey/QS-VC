#!/usr/bin/env bash
set -euo pipefail
[[ $# == 5 ]] || { echo 'Usage: install-archive.sh SIGNED_TAR_GZ NEW_RELEASE_DIR PRIVATE_ENV ED25519_PUB ML_DSA_65_PUB' >&2; exit 2; }
[[ $(id -u) == 0 ]] || { echo 'Run installer as root' >&2; exit 1; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
umask 077
mkdir -- "$2"
python3 - "$1" "$2" <<'PY'
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile

destination = Path(sys.argv[2])
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    seen = set()
    for member in archive:
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or path in seen or not (member.isdir() or member.isfile()):
            raise SystemExit('Unsafe archive entry')
        seen.add(path)
        if not path.parts and member.isdir():
            continue
        target = destination.joinpath(*path.parts)
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True, mode=0o755)
            target.chmod(0o755)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
PY
exec bash "$scripts/install.sh" "$2" "$3" "$4" "$5"
