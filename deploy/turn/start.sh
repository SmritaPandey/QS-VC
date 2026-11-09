#!/bin/sh
set -eu
: "${TURN_SECRET:?Set a private TURN secret}"
: "${TURN_REALM:?Set the TURN realm}"
if [ "${NODE_ENV:-production}" != development ]; then
  if [ "${#TURN_SECRET}" -lt 32 ]; then echo 'TURN_SECRET must contain at least 32 private bytes' >&2; exit 1; fi
  case "$TURN_SECRET" in dev-*|qsvc-turn-secret|qsvc_turn_secret) echo 'Development TURN secrets are forbidden in production' >&2; exit 1;; esac
fi
set -- turnserver -c /etc/coturn/peer-policy.conf --use-auth-secret \
  "--static-auth-secret=$TURN_SECRET" "--realm=$TURN_REALM" --listening-port=3478 \
  --min-port=49152 --max-port=49200 --log-file=stdout --pidfile=/tmp/turnserver.pid
if [ -n "${SFU_ANNOUNCED_IP:-}" ]; then set -- "$@" "--external-ip=$SFU_ANNOUNCED_IP"; fi
if [ -n "${TURN_ALLOWED_SFU_IP:-}" ]; then
  case "$TURN_ALLOWED_SFU_IP" in *[!0-9a-fA-F:.]*) echo 'TURN_ALLOWED_SFU_IP must be one literal SFU address' >&2; exit 1;; esac
  set -- "$@" "--allowed-peer-ip=$TURN_ALLOWED_SFU_IP"
fi
if [ "${QSVC_TURN_TLS:-false}" = true ]; then
  test -r /etc/coturn/tls/fullchain.pem && test -r /etc/coturn/tls/privkey.pem
  set -- "$@" --tls-listening-port=5349 --cert=/etc/coturn/tls/fullchain.pem --pkey=/etc/coturn/tls/privkey.pem
else
  set -- "$@" --no-tls --no-dtls
fi
exec "$@"
