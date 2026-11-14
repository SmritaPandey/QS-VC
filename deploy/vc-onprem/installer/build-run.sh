#!/usr/bin/env bash
# Build qsvc-server-setup-<version>.run: the self-extracting QS-VC server installer for Linux.
#
#   bash deploy/vc-onprem/installer/build-run.sh SIGNED_PACKAGE.tar.gz PUBLIC_KEY_DIR OUTPUT_DIR
#
# Inputs
#   SIGNED_PACKAGE.tar.gz  output of deploy/vc-onprem/offline/bundle.sh (already signed)
#   PUBLIC_KEY_DIR         folder with Ed25519.pub and ML-DSA-65.pub (public halves only)
#   OUTPUT_DIR             where the .run, its SHA-256 and its two signatures are written
# Environment
#   QSVC_VERIFIER_OPENSSL  static OpenSSL >= 3.5 for linux/amd64 (build-verifier.sh makes it)
#   QSVC_RELEASE_KEY_DIR   if set, the .run itself is signed with Ed25519.key and ML-DSA-65.key
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: build-run.sh SIGNED_PACKAGE.tar.gz PUBLIC_KEY_DIR OUTPUT_DIR' >&2; exit 2; }
here=$(cd -- "$(dirname -- "$0")" && pwd)
repo=$(cd -- "$here/../../.." && pwd)
package=$1; keys=$2; out=$3
verifier=${QSVC_VERIFIER_OPENSSL:?Set QSVC_VERIFIER_OPENSSL to the static OpenSSL built by build-verifier.sh}
COMPOSE_VERSION=v5.7.1
COMPOSE_SHA256=af426722a8af5de812fcee30cc1c39f0639f5f723cbadefb25e5d4db054064cf
MAKESELF_TAG=release-2.7.1
MAKESELF_COMMIT=3815292f7359a4ccab8e27bdbe8a844947c51e4c

for f in "$package" "$keys/Ed25519.pub" "$keys/ML-DSA-65.pub" "$verifier"; do [[ -f $f ]] || { echo "Missing $f" >&2; exit 2; }; done
openssl_version=$(file "$verifier" 2>/dev/null || true)
[[ $openssl_version == *"x86-64"* && ( $openssl_version == *"statically linked"* || $openssl_version == *"static-pie linked"* ) ]] || { echo 'Verifier must be a static x86-64 Linux binary' >&2; exit 2; }

work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT
stage="$work/qsvc-server-setup"; mkdir -p "$stage/bin" "$stage/keys"
tar -xzf "$package" -C "$work" ./VERSION 2>/dev/null || tar -xzf "$package" -C "$work" VERSION
version=$(tr -d '[:space:]' <"$work/VERSION")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || { echo "Bad VERSION in package: $version" >&2; exit 2; }

# docker-compose (pinned, checksum-verified)
curl -fsSL -o "$work/docker-compose" "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-x86_64"
echo "$COMPOSE_SHA256  $work/docker-compose" | (command -v sha256sum >/dev/null && sha256sum -c - || shasum -a 256 -c -) >/dev/null
install -m 0755 "$work/docker-compose" "$stage/bin/docker-compose"
# makeself (pinned commit)
git clone -q --depth 1 --branch "$MAKESELF_TAG" https://github.com/megastep/makeself.git "$work/makeself"
[[ $(git -C "$work/makeself" rev-parse HEAD) == "$MAKESELF_COMMIT" ]] || { echo 'makeself revision mismatch' >&2; exit 2; }

install -m 0755 "$verifier" "$stage/bin/openssl"
install -m 0644 "$keys/Ed25519.pub" "$keys/ML-DSA-65.pub" "$stage/keys/"
install -m 0644 "$package" "$stage/QS-VC-On-prem-Installer.tar.gz"
install -m 0755 "$here/setup.sh" "$here/qsvc" "$stage/"
install -m 0644 "$here/create-admin.cjs" "$here/answers.example.env" "$stage/"
install -m 0755 "$repo/deploy/vc-onprem/release/verify.sh" "$stage/verify.sh"
install -m 0644 "$repo/deploy/vc-onprem/release/manifest.py" "$stage/manifest.py"
if grep -q DRAFT-EULA-PLACEHOLDER "$here/EULA.txt" && [[ ${QSVC_ALLOW_DRAFT_EULA:-} != test-build-only ]]; then
  echo 'EULA.txt still contains the draft placeholder. Add the approved licence text (or set QSVC_ALLOW_DRAFT_EULA=test-build-only for internal test builds).' >&2; exit 2
fi
install -m 0644 "$here/EULA.txt" "$stage/EULA.txt"
echo "$version" >"$stage/VERSION"
if [[ -d $here/rpms ]]; then mkdir -p "$stage/rpms"; cp "$here"/rpms/*.rpm "$stage/rpms/"; fi

mkdir -p "$out"; out=$(cd -- "$out" && pwd)
run="$out/qsvc-server-setup-$version.run"
[[ ! -e $run ]] || { echo "$run already exists" >&2; exit 1; }
COPYFILE_DISABLE=1 bash "$work/makeself/makeself.sh" --needroot --sha256 --nox11 --tar-quietly \
  --tar-extra "--no-xattrs --no-acls" \
  "$stage" "$run" "QS-VC Server Setup $version" ./setup.sh >/dev/null
( cd "$out" && { command -v sha256sum >/dev/null && sha256sum "$(basename "$run")" || shasum -a 256 "$(basename "$run")"; } >"$(basename "$run").sha256" )
if [[ -n ${QSVC_RELEASE_KEY_DIR:-} ]]; then
  ossl=${QSVC_SIGNING_OPENSSL:-openssl}
  "$ossl" pkeyutl -sign -inkey "$QSVC_RELEASE_KEY_DIR/Ed25519.key" -rawin -in "$run.sha256" -out "$run.sha256.ed25519.sig"
  "$ossl" pkeyutl -sign -inkey "$QSVC_RELEASE_KEY_DIR/ML-DSA-65.key" -rawin -in "$run.sha256" -out "$run.sha256.ml-dsa-65.sig"
fi
ls -la "$out"
echo "Built $run"
