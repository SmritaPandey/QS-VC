# Hardening

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Apply client CIS Level 2/STIG baseline and document exceptions. Check UEFI Secure Boot, TPM, kernel crypto policy, SELinux/AppArmor, least privilege, filesystem encryption, host firewall, auditd and AIDE. The Ansible SSH candidate restricts passwords, root and forwarding. Verify access from a second management session before reload. Validate workload users, read-only filesystems, seccomp and rootless operation per image. HSM integration, distroless runtimes and attestation are gaps. Never label the host or image FIPS validated based on a kernel flag.
