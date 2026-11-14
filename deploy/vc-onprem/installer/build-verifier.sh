#!/usr/bin/env bash
# Build the static OpenSSL (LTS 3.5) that QS-VC installers use to verify Ed25519 + ML-DSA-65
# signatures on servers whose own OpenSSL is too old (stock Rocky/RHEL 9, Amazon Linux 2023).
#
#   bash deploy/vc-onprem/installer/build-verifier.sh OUTPUT_FILE
# Needs Docker (linux/amd64; Rosetta/QEMU on Apple silicon). Source revision is pinned.
set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: build-verifier.sh OUTPUT_FILE' >&2; exit 2; }
OPENSSL_TAG=openssl-3.5.9
OPENSSL_COMMIT=45e844fa2a14ec92d146bd8f5778ac130b6625fb
: "${QSVC_ALPINE_IMAGE:?Set QSVC_ALPINE_IMAGE to a digest-pinned alpine image (see RELEASE_CHECKLIST.md)}"
out=$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$1")
docker run --rm --platform linux/amd64 -v "$(dirname "$out"):/out" "$QSVC_ALPINE_IMAGE" sh -euc "
  apk add --no-cache build-base perl linux-headers git >/dev/null
  git clone -q --depth 1 --branch $OPENSSL_TAG https://github.com/openssl/openssl.git /src
  cd /src && test \"\$(git rev-parse HEAD)\" = $OPENSSL_COMMIT
  ./Configure linux-x86_64 no-shared no-module no-dso no-tests no-docs -static --prefix=/opt/qsvc-verify >/dev/null
  make -j\$(nproc) build_programs >/dev/null
  strip apps/openssl
  ./apps/openssl list -signature-algorithms | grep -q ML-DSA-65
  install -m 0755 apps/openssl /out/$(basename "$out")
"
file "$out" 2>/dev/null || true
echo "Static verifier: $out"
