#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || { echo 'Usage: restore.sh ISOLATED_POSTGRES_CONTAINER NEW_DB_NAME PRIVATE_KEK ENCRYPTED_DUMP' >&2; exit 2; }
[[ $2 =~ ^qsvc_restore_[a-z0-9_]+$ ]] || { echo 'Use a new database named qsvc_restore_*' >&2; exit 2; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
umask 077
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
node "$scripts/../crypto/envelope.mjs" open "$3" "$4" "$stage/database.dump"
docker exec "$1" sh -ec 'createdb --no-password --username="$POSTGRES_USER" -- "$1"' sh "$2"
docker exec -i "$1" sh -ec 'pg_restore --no-password --exit-on-error --single-transaction --username="$POSTGRES_USER" --dbname="$1"' sh "$2" < "$stage/database.dump"
