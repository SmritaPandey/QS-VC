#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: bundle.sh BUILD_ENV NEW_OUTPUT ED25519_KEY ML_DSA_65_KEY' >&2; exit 2; }
package=$(cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(cd -- "$package/../.." && pwd)
output=$(realpath -m -- "$2")
umask 077
mkdir -- "$output"
QSVC_DEPLOYMENT=onprem QSVC_PACKAGE_SSO=false bash "$repo/scripts/package-intranet-images.sh" "$1" "$output"
cp "$package/stack/compose.offline.yml" "$output/"
cp -R "$package/stack/trial" "$output/trial"
chmod 755 "$output/trial"
chmod 644 "$output/trial/"*.cjs
cp "$package/release/VERSION" "$package/release/CHANGELOG.md" "$output/"
cp "$package/crypto/policy.json" "$package/crypto/source-cbom.json" "$output/"
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
