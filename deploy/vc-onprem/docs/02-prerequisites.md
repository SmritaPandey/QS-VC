# Prerequisites

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Candidate host: Ubuntu Server 24.04 LTS x86-64, client gold image or KVM/QCOW2. Provide an approved offline OS mirror, Docker Engine and Compose, Python 3.11+, OpenSSL with Ed25519 and ML-DSA-65, curl, Node 22 for key provisioning, internal DNS and synchronized time. Supply a client CA, signed release and both pinned public keys through separate channels. Allocate persistent disk, management access and a separate backup destination. Confirm entropy, FIPS module boundary, Secure Boot and measured boot policy before production. The installer is currently limited to database staging.
