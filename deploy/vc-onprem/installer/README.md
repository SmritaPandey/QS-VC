# QS-VC Server Setup (Linux)

`qsvc-server-setup-<version>.run` installs the QS-VC server (hub) on Rocky Linux 9 / RHEL 9
(Ubuntu 22.04/24.04 also supported) with a guided wizard, fully offline.

Run the installer inside an existing x86-64 Linux system, either a physical
server or a guest provisioned by your organisation. It installs QS-VC and
its container services on that system. Your IT team owns the operating
system, hypervisor if used, storage, and network configuration.

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

Manage afterwards with `qsvc status`, `qsvc doctor`, `qsvc start`, `qsvc stop`,
`qsvc restart`, `qsvc logs [service]`, `qsvc ca`, or `qsvc support-bundle`.
After installation or an update, run `sudo qsvc doctor` to verify the local
HTTPS certificate and the auth, meeting, signaling, SFU, and recording
endpoints. The recording check also confirms that server storage is enabled.
For a site-issued certificate whose issuer is absent from the
server trust store, run `sudo qsvc doctor /path/to/organisation-ca.pem`.
The command exits nonzero if a probe fails. Run browser, media, recording
playback and failover checks separately from an actual branch client.
For an existing installation, setup creates a root-only database backup
under `/var/lib/qsvc/pre-upgrade` and checks that PostgreSQL can read its
table of contents. It runs the signed migration runner before starting
the new application services. Migration failures stop setup. Older
installers could record migrations they did not run. Reconcile a suspect
migration ledger against the actual database before upgrading. Run the
upgrade and recovery rehearsal in a maintenance window.

## Intranet and internet access

Choose **Intranet or organisation VPN** for a private deployment. Choose
**Intranet and internet via the organisation edge** when both access paths
are required. In silent setup set `QSVC_EXPOSURE=public` for the second
profile. Supply a certificate for the meeting hostname that standard
clients trust. QS-VC keeps sign-in required for meetings in both profiles.

Use the same meeting hostname for both access paths. Have your network
team route internal DNS to the approved intranet address and external
DNS to the approved SHQ edge. Configure HTTPS and WebSocket forwarding
and the separate WebRTC media routes for that site. The installer does
not configure the external firewall or prove MPLS failover. The public
profile preserves host firewall rules by default.

If TURN is behind NAT, set `TURN_EXTERNAL_IP` in the coturn environment
in the organisation override to the relay address reachable from clients.
Keep the permitted SFU peer address separate. Translate the published
relay UDP ports consistently and verify relay-only calls. Test an
authenticated browser call from outside the network and again after
simulating MPLS loss. Keep database, service control and room-device
administration ports private.

## Verify guest screen sharing after installation

1. On a desktop device, open the organisation’s trusted HTTPS meeting address.
   Start a meeting, then admit a guest from a second browser session.
2. New meetings let admitted participants share by default. If sharing was
   turned off, the host can enable **Share their screen** under
   **More → Host controls → Let everyone**. In a webinar, invite the guest
   on stage before they share.
3. As guest, start sharing. Pick **Entire screen** to present across apps.
   **Browser tab** and **Window** limit capture to the selected source.
4. Have the other participant confirm the share continues as you switch
   apps. Stop sharing and confirm the viewer no longer sees it.

If the screen picker is unavailable, check the host grant, browser capture
support, HTTPS certificate trust, and system screen recording permission.
Turn off **Audio-only** under **More → Connection quality**. If optional
source audio fails, the presentation can continue without it.

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

For a controlled capacity qualification only, set
`QSVC_MAX_MEETING_PARTICIPANTS=1500` in `/etc/qsvc/qsvc.env` and restart
both the meeting and signaling services. This raises the admission ceiling
for explicit meeting limits. It does not increase SFU capacity or qualify
1,500 interactive participants. Keep the default until the target host,
media topology and client mix have passed load testing.

For government SSO, configure the organisation's approved Keycloak broker
and upstream OIDC or SAML identity provider using the
[Enterprise SSO guide](../../../docs/ENTERPRISE_SSO.md). Put the auth service
environment overrides in the root-only organisation Compose file. Keep verified
HTTPS and an explicit IdP host allowlist. Test sign-in, tenant assignment,
revocation and denied access from the actual branch network before rollout.

The SFU image ships the existing Bharat VC bridge module. The example
enables it for an organisation-operated FreeSWITCH and drachtio on the
private network. Provision them using the [gateway guide](../../poly-bridge/README.md).
Limit Event Socket and drachtio control ports to the QS-VC server and
allow the documented RTP and SIP paths. Provide the site-generated
credentials and the SFU address reachable by the MCU. Only the site
gateway needs the approved Bharat VC network route. Basic QS-VC stays
available with the optional bridge disabled. The gateway is a separately
provisioned dependency of this installer release.

For central operation, go to **Admin Console → Conference Control**. The
platform administrator sees live meetings owned by their organisation on
this signaling server. In a meeting set up for room interoperability,
enable room devices or select an enabled SIP device from the organisation
directory. Provision the endpoint on the site's FreeSWITCH Poly profile
in the `qsvc-rooms` registration domain using TLS. The operator action
only dials an eligible registered TLS contact and requires SRTP. The
console also shows connected and waiting room devices and accepts an
authorised Bharat VC invitation. A device can be configured in the
directory while offline. For an interop call the gateway can access
media, so this path is separate from required-E2EE meetings.

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
Leave them unset for isolated networks. The offline installation stores
host-captured uploads in a persistent local recording volume by default.
Place the volume on encrypted storage and validate backup, restore, playback
and capacity before rollout.

## Offline updates for room-system administrators

Set `QSVC_UPDATE_DROP_DIR` to an existing, operator-controlled transfer
directory at build time to publish a signed release for the site administrator.
For a shared directory, set its group to the administrator group and enable
group inheritance on that directory.
The connected release station hands the site administrator the versioned
`qsvc-server-setup-<version>.run`, its `.sha256` file, both signatures of that
file, and the release notes. Transfer those files through the organisation's
approved media or transfer station. Keep the four installer files together
and keep their original names.

On a server installed with this release or later, run
`sudo qsvc check-update /path/to/qsvc-server-setup-<version>.run`.
It checks both signatures against the keys pinned during setup and validates
the installer bytes. It only verifies the transfer. Review the release notes
and follow the approved backup and maintenance process before running setup.
For servers without the command, verify against the independently obtained
release keys at the transfer station before executing the first installer.

QS-VC packages update the QS-VC server. Poly/Polycom administrators use
the vendor's firmware package and management path for each device model.
Keep the two updates separate in the maintenance record. An isolated site
receives releases across its approved transfer boundary.
