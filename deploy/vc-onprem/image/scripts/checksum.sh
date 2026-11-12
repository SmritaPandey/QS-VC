#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || exit 2
sha256sum -- "$1"
