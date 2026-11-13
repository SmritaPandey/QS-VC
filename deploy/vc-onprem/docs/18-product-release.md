# On-prem product decision · 13 November 2026

One product and one normal installer entry point. Free use is a server-side
entitlement for the first 14 days after successful setup. Retire Try-It-Now.
The existing signed tar.gz is a pilot package for Linux administrators.
Stage it only after building, scanning and signing the exact archive. The portal
shows a download only when the configured archive is present.

| Order | Target | Readiness |
|---|---|---|
| 1 | Release readiness and download availability | Portal availability check implemented. Signed archive, builder, production keys, Rocky/RHEL validation and live deployment pending |
| 2 | Poly dial-in | Existing tenant-scoped room resolution, PIN and room policy path present. Validate complete endpoint routing and activation enforcement on hardware |
| 3 | Web /setup | Guided network, administrator, certificate, database and service setup. Record successful completion once, after readiness. Online registration or an offline registration code. Pending |
| 4 | Server-side activation | At day 15 block sign-in, meetings and Poly. Keep data and expose only administrator activation. Validate persisted clock rollback protection and VM identity across upgrades, snapshots and authorized recovery. Current pilot starts during database staging and lacks these controls |
| 5 | Platform Admin Console | On-prem installations queue, Approve, Extend 14 days, Suspend and activation code. Reuse approval-review actor/time conventions from migration 011. Store installation records separately from account approval. Existing signed JSON extension is an interim tool. Typed signed codes and installation management pending |
| 6 | Appliances | Rocky 9 OVA, VHDX, QCOW2 and ISO. Test imports, first boot and signatures for each release format. Pending |
| 7 | Installers and download/activate UI | Guided Rocky/RHEL 9 .run. Desktop clients via MSI/EXE, PKG and RPM/DEB. Online and offline distribution. Pending |

Activation codes must bind the installation identity, validity period and
approval revision to a dedicated Ed25519 signature. Reject altered or expired
codes. A disconnected appliance cannot receive a remote suspension until it
receives an updated license or reconnects. Keep signing material outside
release packages. Reopening service must preserve existing workspace data.

The 7–8 week estimate is a planning estimate. Confirm the delivery date before
sending the customer reply. Describe the guided installers and appliances as
target deliverables until build and acceptance evidence exists. Windows WSL2
server delivery is outside the Rocky appliance baseline and would require its
own support and validation decision.
