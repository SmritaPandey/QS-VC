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

## Organisation-managed infrastructure

The installer and `qsvc` both load the optional root-managed
`/etc/qsvc/compose.organisation.yml` after the generated site settings.
This file survives reinstall and upgrade. Setup installs a separate
`compose.organisation.example.yml` as a starting point. Keep the active
file root-only (0600). Apply changes with `sudo qsvc restart`.

The SFU image ships the existing Bharat VC bridge module. The example
enables it for an organisation-operated FreeSWITCH and drachtio on the
private network. Provision them using the [gateway guide](../../poly-bridge/README.md).
Limit Event Socket and drachtio control ports to the QS-VC server and
allow the documented RTP and SIP paths. Provide the site-generated
credentials and the SFU address reachable by the MCU. Only the site
gateway needs the approved Bharat VC network route. Basic QS-VC stays
available with the optional bridge disabled. The gateway is a separately
provisioned dependency of this installer release.

For acceptance, use the host's Bharat VC action with an authorised SIP
invitation in an unlocked interoperability meeting. Verify participant
notice, consent, two-way audio/video, disconnect, and rejection in E2EE
meetings. A bridge API success does not establish live media.

For organisation TLS certificates issued by private PKI, provide the
organisation CA bundle in the installer or as `QSVC_TLS_CA` in silent
mode. The completion check validates the hostname and certificate chain.

The installed recording service can relay an allowed host broadcast through
the existing FFmpeg and RTMPS path. Set `LIVE_YOUTUBE_RTMPS_URL` and/or
`LIVE_FACEBOOK_RTMPS_URL` as recording service environment values in the
root-only organisation override when outbound broadcasting is approved.
Leave them unset for isolated networks. Server recording storage requires
a separate qualified storage configuration.
