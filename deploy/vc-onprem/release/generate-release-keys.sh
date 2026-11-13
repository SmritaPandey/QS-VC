#!/usr/bin/env bash
set -euo pipefail
: "${QSVC_RELEASE_KEY_DIR:?Set an absolute path to a new key directory on the release build host}"
target=$(python3 - "$QSVC_RELEASE_KEY_DIR" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
if not path.is_absolute() or path.exists() or path.is_symlink():
    raise SystemExit('Choose a new absolute key directory')
path = path.resolve()
if any((parent / '.git').exists() for parent in path.parents):
    raise SystemExit('The key directory must be outside any Git checkout')
print(path)
PY
)
openssl list -signature-algorithms | grep -E 'ML-DSA-65' >/dev/null
umask 077
mkdir -- "$target"
for algorithm in Ed25519 ML-DSA-65; do
    openssl genpkey -algorithm "$algorithm" -out "$target/$algorithm.key"
    chmod 0400 "$target/$algorithm.key"
    openssl pkey -in "$target/$algorithm.key" -pubout -out "$target/$algorithm.pub"
    cat "$target/$algorithm.pub"
    openssl dgst -sha256 "$target/$algorithm.pub"
done
