#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: bundle.sh BUILD_ENV NEW_OUTPUT ED25519_KEY ML_DSA_65_KEY' >&2; exit 2; }
package=$(cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(cd -- "$package/../.." && pwd)
for tool in docker node python3 openssl syft grype sha256sum; do
    command -v "$tool" >/dev/null || { echo "Missing release build tool: $tool" >&2; exit 2; }
done
for input in "$1" "$3" "$4"; do
    [[ -f "$input" && -r "$input" ]] || { echo 'Build environment and both signing key files must be readable' >&2; exit 2; }
done
: "${QSVC_ONPREM_LICENSE_PUBLIC_KEY:?Set the production license verification public key path}"
openssl asn1parse -in "$QSVC_ONPREM_LICENSE_PUBLIC_KEY" | grep -E 'OBJECT *:ED25519$' >/dev/null
# Portable (macOS realpath has no -m): absolute path; the directory itself must not exist yet.
output=$(python3 -c 'import os, sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$2")
umask 077
[[ ! -e "$output.tar.gz" && ! -L "$output.tar.gz" ]] || { echo "Archive already exists" >&2; exit 1; }
mkdir -- "$output"
node --test "$package/stack/ai/gateway.test.cjs"
QSVC_DEPLOYMENT=onprem QSVC_PACKAGE_OFFLINE_PILOT=true QSVC_PACKAGE_SSO=false bash "$repo/scripts/package-intranet-images.sh" "$1" "$output"
cp "$package/stack/compose.offline.yml" "$output/"
cp -R "$package/stack/trial" "$output/trial"
chmod 755 "$output/trial"
chmod 644 "$output/trial/"*.cjs
openssl pkey -pubin -in "$QSVC_ONPREM_LICENSE_PUBLIC_KEY" -pubout -out "$output/trial/license-public.pem"
chmod 644 "$output/trial/license-public.pem"
mkdir -m 755 "$output/ai"
install -m 644 "$package/stack/ai/gateway.cjs" "$package/stack/ai/policy.example.json" "$output/ai/"
cp "$package/release/VERSION" "$package/release/CHANGELOG.md" "$output/"
cp "$package/crypto/policy.json" "$package/crypto/source-cbom.json" "$output/"
install -m 644 "$package/stack/ai/services.cdx.json" "$output/sbom/ai-services.cdx.json"
cp -R "$package/docs" "$output/onprem-docs"
cp "$repo/config/.env.onprem.template" "$output/config/onprem.env.template"
python3 - "$output/config/Caddyfile.template" "$package/crypto/policy.json" <<'CADDY'
from pathlib import Path
import json
import sys
path = Path(sys.argv[1])
text = path.read_text()
original = "tls internal {\n        curves x25519mlkem768 x25519"
if text.count(original) != 1:
    raise SystemExit("Caddy TLS template changed. Review offline policy before packaging.")
policy = json.loads(Path(sys.argv[2]).read_text())["profiles"]["pilot"]
protocol = policy["edgeTls"]
groups = " ".join(policy["edgeGroups"])
text = text.replace(original, f"tls internal {{\n        protocols {protocol} {protocol}\n        curves {groups}")
anchor = "    handle /health {"
if text.count(anchor) != 1:
    raise SystemExit("Caddy health route changed. Review offline trial gate before packaging.")
gate = """    forward_auth trial-gateway:4010 {
        uri /check
    }

    handle /api/onprem/trial {
        header Cache-Control "no-store"
        respond 204
    }

"""
path.write_text(text.replace(anchor, gate + anchor))
CADDY
(cd "$output" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
bash "$package/release/sign.sh" "$output" "$3" "$4"
archive=$(mktemp "${output}.tar.gz.XXXXXX")
trap 'rm -f -- "$archive"' EXIT
COPYFILE_DISABLE=1 tar -C "$output" -czf "$archive" .
ln -- "$archive" "$output.tar.gz"
printf 'Signed installer archive: %s\n' "$output.tar.gz"
