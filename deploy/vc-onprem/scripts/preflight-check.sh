#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: preflight-check.sh FQDN CERT CA PRIVATE_ENV' >&2; exit 2; }
[[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9.-]+$ ]] || { echo "Invalid hostname" >&2; exit 2; }
host=$1
certificate=$2
ca=$3
env_file=$4
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail 'Linux deployment host required'
for tool in docker openssl python3 stat timedatectl getent; do
  command -v "$tool" >/dev/null || fail "Missing $tool"
done
[[ -f "$env_file" && ! -L "$env_file" ]] || fail 'A regular private environment file is required'
[[ $(stat -c '%a' "$env_file") == 600 ]] || fail 'Private environment file must be mode 600'
[[ $(timedatectl show -p NTPSynchronized --value) == yes ]] || fail 'Clock is not synchronized'
getent ahosts "$host" >/dev/null || fail 'Internal DNS resolution failed'
openssl verify -purpose sslserver -verify_hostname "$host" -CAfile "$ca" "$certificate"
openssl x509 -checkend 604800 -noout -in "$certificate" || fail 'Certificate expires within seven days'
openssl list -signature-algorithms | grep -Ei 'ML-DSA-65' >/dev/null || fail 'OpenSSL ML-DSA-65 support required'
python3 -c 'import os; assert len(os.getrandom(32, os.GRND_NONBLOCK)) == 32' || fail 'Kernel RNG is not ready'
docker info --format '{{.ServerVersion}}' >/dev/null || fail 'Docker daemon unavailable'
docker compose version >/dev/null || fail 'Docker Compose unavailable'
printf 'FIPS kernel flag: %s\n' "$(cat /proc/sys/crypto/fips_enabled 2>/dev/null || echo unavailable)"
if command -v mokutil >/dev/null; then mokutil --sb-state; else echo 'Secure Boot: UNVERIFIED'; fi
echo 'Overlay MTU, container egress, and client negotiation require network UAT.'
