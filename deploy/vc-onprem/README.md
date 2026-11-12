# QS-VC On-prem deployment package

**ASSUMED – pending client approval**. The pilot uses an Ubuntu 24.04 candidate,
a single VM and private MPLS. The continuation brief allows work to proceed with
these assumptions. Review [client inputs](docs/12-client-questionnaire.md)
before deploying into a client environment.

| Phase | Delivered | Remaining or UNVERIFIED |
|---|---|---|
| P0 | Component, egress and configuration inventory. On-prem naming | The P0 reports describe the original source baseline |
| P1 | Architecture, network matrix, sizing, threat model, crypto posture and initial compliance mapping | Client inputs, actual deployment crypto versions, full compliance mapping and release-bound CBOM |
| P2 | Template cleanup, local browser settings, offline Compose overlay, preflight, signed staging and backup envelope | Full installer, end-to-end egress enforcement, MinIO recordings, local AI packaging, internal mTLS, PKI/HSM integration, audit chain and enterprise access controls |
| P3 | Candidate QEMU/Packer, autoinstall, cloud-init and Ansible files | Packer validation, VM build/import, OS package staging, hardening evidence and signed VM |
| P4 | Install, configuration, operations, troubleshooting, UAT and key ceremony docs. Backup, restore and limited diagnostics scripts | End-to-end install/restore, automated lifecycle, HA, privacy and SIEM enforcement |
| P5 | Local verification below | Hardware and client network UAT, exact image scans, live negotiation, downgrade rejection, TURN/TLS 443, capacity, restore, no-egress evidence |
| P6 | Version, changelog, signing scripts, handover and email draft | Built and scanned artifacts, client signatures, SBOM/CBOM, release checksums, provenance and client acceptance |

Use the [installation guide](docs/04-installation-guide.md) and
[offline builder instructions](offline/mirror-instructions.md). The installer
currently verifies the signed inventory, loads images and stages PostgreSQL.
Complete the DB, network and certificate setup before starting application services.

## Verification limits

- Web TypeScript/Vite build passed with a bundle size warning.
- Compose configuration parsed with a synthetic environment. No services started.
- Shell syntax checks, two key provisioning tests, 25 web regression tests and whitespace checks passed.
- OpenSSL 4.1.0 accepted both signatures on a synthetic release. A modified file
  was rejected. Production release keys were not used.
- AES-256-GCM backup envelope round trip and tag tampering rejection passed with
  temporary keys. PostgreSQL backup and restore were not executed.
- A disposable loopback Caddy container passed configuration validation. OpenSSL
  verified its certificate chain, negotiated TLS 1.3 with X25519MLKEM768, and
  rejected TLS 1.2. This was the cached ARM64 image, separate from a client build.
- Docker worked with execution outside the sandbox. Packer, Ansible, QEMU,
  Syft and Grype CLIs were absent. No release image was built, scanned or signed.
- See the [security acceptance checklist](docs/09-uat-checklist.md) and
  [cryptographic posture](docs/14-crypto-architecture.md) for outstanding evidence.

## Public On-prem trial

The website exposes the setup guide and trial request without sign-in. Set
VITE_ONPREM_TRIAL_DOWNLOAD_URL in the public AWS web build to offer the
published signed package directly. The installed trial uses the host
installation timestamp. At expiry, the gateway blocks the workspace and links
to the public Contact us page. See the installation guide for scope and limits.

Local Docker verification covered active requests, expired HTML and API
responses, missing state and the media service startup guard. This does not
replace full stack or client acceptance tests.
