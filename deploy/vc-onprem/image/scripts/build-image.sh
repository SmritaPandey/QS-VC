#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: build-image.sh PRIVATE_PACKER_VAR_FILE' >&2; exit 2; }
vars=$(realpath -- "$1")
cd -- "$(dirname -- "$0")/../packer"
command -v packer >/dev/null
command -v qemu-system-x86_64 >/dev/null
[[ -r /dev/kvm ]] || { echo 'Readable KVM device required' >&2; exit 1; }
packer init .
packer validate -var-file="$vars" .
packer build -var-file="$vars" .
