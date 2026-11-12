#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: convert-format.sh SOURCE_QCOW2 vmdk|vhdx NEW_OUTPUT' >&2; exit 2; }
case "$2" in vmdk|vhdx) ;; *) exit 2 ;; esac
[[ ! -e "$3" && ! -L "$3" ]] || { echo 'Output already exists' >&2; exit 2; }
qemu-img convert -f qcow2 -O "$2" "$1" "$3"
qemu-img compare -f qcow2 -F "$2" "$1" "$3"
