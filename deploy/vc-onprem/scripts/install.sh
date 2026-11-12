#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: install.sh STAGED_RELEASE PRIVATE_ENV ED25519_PUB ML_DSA_65_PUB' >&2; exit 2; }
root=$(cd -- "$1" && pwd)
private_env=$(realpath -- "$2")
[[ $(id -u) == 0 ]] || { echo "Run installation as root to initialize host trial state" >&2; exit 1; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
[[ $(stat -c '%a' "$private_env") == 600 ]] || { echo 'Private env must be mode 600' >&2; exit 1; }
bash "$scripts/../release/verify.sh" "$root" "$3" "$4"
# The staging directory must remain under exclusive operator control.
cd -- "$root"
docker compose --env-file "$private_env" -f docker-compose.prod.yml -f compose.offline.yml config --quiet
docker load -i qsvc-intranet-images.tar
docker compose --env-file "$private_env" -f docker-compose.prod.yml -f compose.offline.yml up -d --pull never --no-build postgres
python3 - <<'TRIAL'
import os
from pathlib import Path
import tempfile
import time

directory = Path('/var/lib/qsvc/onprem-trial')
directory.mkdir(parents=True, exist_ok=True, mode=0o755)
state = directory / 'installed-at'
if directory.is_symlink() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o022:
    raise SystemExit("On-prem trial state directory must be root-owned and protected")
os.chmod(directory, 0o755)
with tempfile.NamedTemporaryFile(dir=directory) as temporary:
    temporary.write(f'{time.time_ns() // 1_000_000}\n'.encode())
    temporary.flush()
    os.fsync(temporary.fileno())
    os.fchmod(temporary.fileno(), 0o644)
    try:
        os.link(temporary.name, state)
    except FileExistsError:
        if not state.is_file() or state.is_symlink():
            raise SystemExit("Invalid existing On-prem trial state")
TRIAL
echo 'Database staged. Create restricted DB accounts and complete network preflight before starting the remaining services.'
