# Key ceremony and incident response

**ASSUMED – pending client approval**. Assign a PKI custodian, release signer,
independent witness and incident lead. Use an offline root and constrained issuing
CA. Keep release, workload identity, session signing and backup wrapping keys
separate. For production, use client HSM PKCS#11 with module validation checked
for the exact operating mode. SoftHSM is suitable for lab exercises only.

1. Record purpose, policy version, algorithm, key ID, module serial and
   custody owners. Validate quorum enforcement and designate recovery contacts.
2. Generate keys inside their assigned boundary. Use the HSM's supported M-of-N
   recovery mechanism and record custody transfers. Keep shares separately.
3. Publish fingerprints separately from the package. For signing, require both
   independent approvals and verify on a separate host.
4. Rotate by staging new trust, issuing new credentials and testing the new path.
   Retain old wrapping keys for decrypt-only recovery until retention ends.
5. Revoke a compromised key, quarantine affected releases, and record the
   trust cutoff in the client change system. Test rollback without that key.
6. At destruction, record the key ID, witness and destruction method after legal
   hold, backup retention and recovery dependencies are checked.

Pilot tooling uses files. Generate a separate 32-byte backup KEK on private
encrypted storage with mode 0600. Associate its key ID with each backup in the
protected backup catalog. Protect both temporary backup and restore directories
with encrypted storage. The envelope utility handles backup files only.
HSM enforcement, authenticated cross-site KEM transport and application recording
and transcript encryption are gaps.

During an incident, isolate the affected component, preserve clock and access
records and maintain chain of custody. Preserve raw evidence only in the client's
restricted forensic store. Use collect-diagnostics.sh for a limited support
summary. Follow the CERT-In reporting workflow in the control matrix and
the client's privacy escalation process. Restore to an isolated target and
verify the cause is contained before returning to service.
