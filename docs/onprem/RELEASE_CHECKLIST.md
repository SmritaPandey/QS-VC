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
  `QSVC_SFU_RUNTIME_BASE` (cgr.dev/chainguard/node:latest). The builder's glibc must not be newer
  than the runtime's. Resolve a digest with `docker buildx imagetools inspect <image>`.
- Every `FROM` in `deploy/vc-onprem/stack/*/Dockerfile` must be digest-pinned or come from one of these variables.
- The gate stays `--fail-on high` for all findings, including wont-fix. A finding that cannot be remediated
  needs a person-reviewed OpenVEX file for that exact image in `deploy/vc-onprem/release/vex/`
  (rules in its README, enforced by `check-vex.py`). Never widen the gate itself.

## Installers (after the signed server package)

1. **Branch apps**: GitHub → Actions → *On-prem installers* (repository must be private), `build_desktop`.
   Download the Windows (EXE + MSI), macOS (DMG + PKG) and Linux (DEB + RPM + AppImage) artifacts into
   `~/qsvc-build/clients/`. Without code-signing certificates Windows shows "Unknown publisher" and macOS
   needs right-click → Open; add `CSC_LINK`/`CSC_KEY_PASSWORD` and Apple notarisation secrets when available.
2. **Server package with branch apps inside**: re-run `bundle.sh` with `QSVC_CLIENTS_DIR=~/qsvc-build/clients`
   so the hub serves them at `https://<server>/downloads`.
3. **Verifier**: `bash deploy/vc-onprem/installer/build-verifier.sh ~/qsvc-build/qsvc-openssl` (static OpenSSL 3.5.9).
4. **Linux server setup (.run)**: replace `deploy/vc-onprem/installer/EULA.txt` with the approved licence text, then
   `QSVC_VERIFIER_OPENSSL=~/qsvc-build/qsvc-openssl QSVC_RELEASE_KEY_DIR=~/qsvc-release-keys-2026-11 bash deploy/vc-onprem/installer/build-run.sh <signed .tar.gz> ~/qsvc-release-keys-2026-11 ~/qsvc-build/installers`.
5. **Appliance (OVA/VHDX/QCOW2)**: upload the .run to private storage, create a 1-hour link, run the workflow with
   `build_appliance`, `run_url`, `run_sha256` and the Rocky 9 minimal ISO SHA-256 (from the Rocky CHECKSUM file).
6. **Windows Server setup (.exe)**: same workflow, `build_windows_server`; publish next to the `-HyperV.zip`.
7. **Publish**: copy files to `deploy/aws/installers/` on the web server with these names, each with a `.sha256`:
   `qsvc-server-setup.run`, `QS-VC-On-prem-Installer.tar.gz`, `QS-VC-Server-Appliance.ova`,
   `QS-VC-Server-Appliance-HyperV.zip`, `QS-VC-Server-Appliance.qcow2`, `QS-VC-Server-Setup.exe`.
   The On-Prem page lists each one automatically ("Coming soon" until present).
