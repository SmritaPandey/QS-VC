#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: sign.sh STAGED_RELEASE ED25519_KEY ML_DSA_65_KEY' >&2; exit 2; }
release=$(cd -- "$1" && pwd)
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
for key in "$2" "$3"; do
  resolved=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve(strict=True))' "$key")
  [[ $resolved != "$release/"* ]] || { echo 'Signing keys must be outside the release directory' >&2; exit 2; }
done
umask 077
python3 "$script_dir/manifest.py" create "$release"
openssl pkeyutl -sign -inkey "$2" -rawin -in "$release/manifest.json" -out "$release/manifest.ed25519.sig"
openssl pkeyutl -sign -inkey "$3" -rawin -in "$release/manifest.json" -out "$release/manifest.ml-dsa-65.sig"
