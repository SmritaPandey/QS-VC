#!/usr/bin/env bash
# Verify a complete transfer from the connected release station before executing it.
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: verify-update.sh INSTALLER.run TRUSTED_KEY_DIR OPENSSL' >&2; exit 2; }
installer=$1
keys=$2
openssl=$3
name=${installer##*/}
[[ $name =~ ^qsvc-server-setup-[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?\.run$ && -f $installer ]] || {
  echo 'Select a versioned QS-VC Linux installer.' >&2
  exit 2
}
checksum="$installer.sha256"
for input in "$checksum" "$checksum.ed25519.sig" "$checksum.ml-dsa-65.sig"; do
  [[ -f $input ]] || { echo "Missing release sidecar: $input" >&2; exit 2; }
done
"$openssl" pkeyutl -verify -pubin -inkey "$keys/Ed25519.pub" -rawin -in "$checksum" -sigfile "$checksum.ed25519.sig" >/dev/null
"$openssl" pkeyutl -verify -pubin -inkey "$keys/ML-DSA-65.pub" -rawin -in "$checksum" -sigfile "$checksum.ml-dsa-65.sig" >/dev/null
read -r expected signed_name extra <"$checksum"
[[ $expected =~ ^[a-f0-9]{64}$ && $signed_name == "$name" && -z $extra ]] || {
  echo 'Signed checksum does not identify this installer.' >&2
  exit 1
}
actual=$("$openssl" dgst -sha256 -r "$installer")
[[ ${actual%% *} == "$expected" ]] || { echo 'Installer checksum mismatch.' >&2; exit 1; }
printf 'Verified update ready for administrator review: %s\n' "$name"
