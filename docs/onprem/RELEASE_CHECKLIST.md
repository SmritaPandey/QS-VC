# On-prem release checklist

1. Build from a clean, identified release revision. Confirm image platforms
   and digests. Keep CycloneDX, SPDX and Grype reports with the release.
2. Resolve High and Critical findings under the current gate before signing.
   A future VEX exception must be specific to an artifact and reviewed by a person.
3. On the real build host, set QSVC_RELEASE_KEY_DIR to a new private absolute
   path outside Git. Run bash deploy/vc-onprem/release/generate-release-keys.sh.
   Record the two public fingerprints through an independent channel. Verify
   the hosted activation signer's public key separately.
4. Set QSVC_ONPREM_LICENSE_PUBLIC_KEY and run deploy/vc-onprem/offline/bundle.sh
   with the private build environment, a new output directory and the two
   signing key paths. Verify and stage the archive with stage-server-package.sh
   and the two trusted public keys. Keep the archive outside the web root.
5. Record the published archive SHA-256 and run signed-out download and
   clean Rocky verification per TEST_PLAN.md.

## Base images and exceptions

- Before building, set digest-pinned bases (the package script refuses anything else):
  `QSVC_ALPINE_IMAGE` (coturn build and runtime), `QSVC_SFU_BUILD_BASE` (node:22-bookworm-slim) and
  `QSVC_SFU_RUNTIME_BASE` (gcr.io/distroless/cc-debian12:nonroot). Keep both SFU bases on the same
  Debian release. Resolve a digest with `docker buildx imagetools inspect <image>`.
- Every `FROM` in `deploy/vc-onprem/stack/*/Dockerfile` must be digest-pinned or come from one of these variables.
- The gate stays `--fail-on high` for all findings, including wont-fix. A finding that cannot be remediated
  needs a person-reviewed OpenVEX file for that exact image in `deploy/vc-onprem/release/vex/`
  (rules in its README, enforced by `check-vex.py`). Never widen the gate itself.
