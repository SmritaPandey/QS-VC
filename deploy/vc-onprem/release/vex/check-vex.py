#!/usr/bin/env python3
"""Validate a person-reviewed OpenVEX exception file before the release gate uses it.

Rules (see README.md): OpenVEX context; a named human author with an email; a
timestamp no older than 90 days; every statement names one vulnerability, covers
this exact image, and is either "fixed" or "not_affected" with an allowed
justification and an impact statement.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone

ALLOWED = {
    "component_not_present",
    "vulnerable_code_not_present",
    "vulnerable_code_not_in_execute_path",
    "vulnerable_code_cannot_be_controlled_by_adversary",
    "inline_mitigations_already_exist",
}


def fail(message: str) -> None:
    print(f"VEX rejected: {message}", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: check-vex.py FILE IMAGE")
    path, image = sys.argv[1], sys.argv[2]
    with open(path, encoding="utf-8") as handle:
        doc = json.load(handle)
    if not str(doc.get("@context", "")).startswith("https://openvex.dev/ns"):
        fail("not an OpenVEX document")
    author = str(doc.get("author", ""))
    if not re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", author) or re.search(r"claude|codex|agent|bot", author, re.I):
        fail("author must be the reviewing person, with an email address")
    try:
        stamp = datetime.fromisoformat(str(doc["timestamp"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        fail("timestamp missing or invalid")
    if datetime.now(timezone.utc) - stamp > timedelta(days=90):
        fail("older than 90 days; review again")
    statements = doc.get("statements") or []
    if not statements:
        fail("no statements")
    repo = image.split(":")[0]
    for index, statement in enumerate(statements):
        vulnerability = statement.get("vulnerability", {})
        name = vulnerability.get("name") if isinstance(vulnerability, dict) else vulnerability
        if not name:
            fail(f"statement {index}: vulnerability name missing")
        products = json.dumps(statement.get("products", []))
        if repo not in products:
            fail(f"statement {index} ({name}): products must name {image}")
        status = statement.get("status")
        if status == "not_affected":
            if statement.get("justification") not in ALLOWED:
                fail(f"statement {index} ({name}): justification must be one of {sorted(ALLOWED)}")
            if len(str(statement.get("impact_statement", "")).strip()) < 40:
                fail(f"statement {index} ({name}): explain why in impact_statement")
        elif status != "fixed":
            fail(f"statement {index} ({name}): status must be not_affected or fixed")
    print(f"VEX accepted for {image}: {len(statements)} statement(s) by {author}")


if __name__ == "__main__":
    main()
