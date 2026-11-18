# QS-VC Server Setup (Linux)

`qsvc-server-setup-<version>.run` installs the QS-VC server (hub) on Rocky Linux 9 / RHEL 9
(Ubuntu 22.04/24.04 also supported) with a guided wizard, fully offline.

## Build (release machine)

1. Build and sign the server package: `deploy/vc-onprem/offline/bundle.sh` (see docs/onprem/RELEASE_CHECKLIST.md).
2. Build the bundled verifier once per OpenSSL update:
   `bash deploy/vc-onprem/installer/build-verifier.sh ~/qsvc-build/qsvc-openssl`
3. Build the installer:
   ```
   QSVC_VERIFIER_OPENSSL=~/qsvc-build/qsvc-openssl QSVC_RELEASE_KEY_DIR=~/qsvc-release-keys-2026-11 \
     bash deploy/vc-onprem/installer/build-run.sh ~/qsvc-build/QS-VC-On-prem-Installer-1.0.0.tar.gz \
     ~/qsvc-release-keys-2026-11 ~/qsvc-build/installers
   ```
   Output: `.run`, `.run.sha256`, and Ed25519 + ML-DSA-65 signatures of the checksum.
   `EULA.txt` must contain the approved licence text (release builds refuse the draft).

## Install (customer server)

```
sudo bash qsvc-server-setup-<version>.run                     # wizard
sudo bash qsvc-server-setup-<version>.run -- --silent --answers /root/qsvc-answers.env
```
The wizard: licence → signature and fingerprint check (bundled OpenSSL 3.5, works on stock
Rocky 9) → system check → Podman container runtime (Docker is not required for new installations) → organisation details →
secrets generated on the server → 14-day record and installation ID → images → database and
restricted accounts → services and first administrator → firewall and start-on-boot → finish
(server URL, installation ID, root CA for branch PCs).

Manage afterwards: `qsvc status | start | stop | restart | logs [service] | ca | support-bundle`.
Re-running the installer repairs/upgrades in place and keeps secrets, data and the installation ID.

## Container runtime

New Linux installations use Podman. Docker Engine and the Docker daemon are not prerequisites. The bundled pinned Compose compatibility client talks to the local Podman socket; its upstream filename `docker-compose` does not mean Docker Engine is installed. QS-VC still runs in containers.

Rocky/RHEL offline installers retain the bundled RPM dependency closure. Ubuntu requires Podman to be preinstalled or available from its configured package repository; the Rocky RPM bundle is not an Ubuntu offline package.

Existing installations whose `/etc/qsvc/runtime` records Docker keep that engine and data in place during repairs/upgrades. Restore their Docker service before upgrading; this installer does not automatically migrate Docker volumes into Podman.

Docker used by `build-verifier.sh` or release image tooling is a release-machine dependency only, not a new Linux customer-server prerequisite.
