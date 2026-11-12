#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: verify.sh STAGED_RELEASE TRUSTED_ED25519_PUB TRUSTED_ML_DSA_65_PUB' >&2; exit 2; }
release=$(cd -- "$1" && pwd)
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
for item in manifest.json manifest.ed25519.sig manifest.ml-dsa-65.sig; do
  [[ -f "$release/$item" && ! -L "$release/$item" ]] || exit 2
done
# Keys and verifier come from an independent, trusted channel.
openssl asn1parse -in "$2" | grep -Eq "OBJECT *:ED25519$"
openssl asn1parse -in "$3" | grep -Eq "OBJECT *:(ML-DSA-65|id-ml-dsa-65)$"
openssl pkeyutl -verify -pubin -inkey "$2" -rawin -in "$release/manifest.json" -sigfile "$release/manifest.ed25519.sig"
openssl pkeyutl -verify -pubin -inkey "$3" -rawin -in "$release/manifest.json" -sigfile "$release/manifest.ml-dsa-65.sig"
python3 "$script_dir/manifest.py" verify "$release"
