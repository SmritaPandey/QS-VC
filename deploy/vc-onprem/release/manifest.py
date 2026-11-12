#!/usr/bin/env python3
"""Create or verify the exact file inventory of a staged release."""
import argparse
import hashlib
import json
from pathlib import Path

METADATA = {"manifest.json", "manifest.ed25519.sig", "manifest.ml-dsa-65.sig"}


def inventory(root):
    entries = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Release contains a symbolic link")
        if path.is_dir():
            continue
        name = path.relative_to(root).as_posix()
        if name in METADATA:
            continue
        if not path.is_file():
            raise ValueError("Release contains a non-regular file")
        with path.open("rb") as content:
            entries[name] = hashlib.file_digest(content, "sha256").hexdigest()
    if not entries:
        raise ValueError("Release payload is empty")
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("create", "verify"))
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    manifest = args.directory / "manifest.json"
    payload = {"schema": 1, "sha256": inventory(args.directory)}
    if args.operation == "create":
        with manifest.open("x", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, indent=2)
            output.write("\n")
    elif json.loads(manifest.read_text(encoding="utf-8")) != payload:
        raise SystemExit("Release file inventory or checksum mismatch")


if __name__ == "__main__":
    main()
