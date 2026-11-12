#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 && $1 =~ ^[A-Za-z0-9.-]+$ ]] || { echo 'Usage: post-install-verify.sh FQDN TRUSTED_CA' >&2; exit 2; }
curl --fail --silent --show-error --max-time 15 --cacert "$2" "https://$1/health"
printf '\nGateway reachable. Verify signed-in meeting and media separately.\n'
