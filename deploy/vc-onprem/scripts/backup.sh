#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: backup.sh POSTGRES_CONTAINER DB_NAME PRIVATE_KEK NEW_ENCRYPTED_DUMP' >&2; exit 2; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
umask 077
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
docker exec "$1" sh -ec 'pg_dump --no-password --format=custom --username="$POSTGRES_USER" --dbname="$1"' sh "$2" > "$stage/database.dump"
node "$scripts/../crypto/envelope.mjs" seal "$3" "$stage/database.dump" "$4"
