# UAT and security acceptance

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

- [ ] Verify signed release on a clean host. Reject changed files, extra files and wrong keys.
- [ ] Check approved OS, VM boot, unique host keys and operator login.
- [ ] Verify host and browser egress denied while two-site audio/video, screen share and reconnect succeed.
- [ ] Verify direct UDP and TURN TLS with UDP blocked. Record selected candidate pair and path MTU.
- [ ] Capture group and signature evidence for edge, internal mTLS, SSH and overlay. Confirm required profiles reject disallowed negotiation.
- [ ] Verify authenticated join, lobby, passcode limits, guest separation, meeting locks and E2EE. Confirm server ASR stays disabled during E2EE.
- [ ] Check admin MFA, JIT access, recording consent, export controls, retention, audit integrity and tamper rejection.
- [ ] Exercise mTLS rotation, backup/restore, outage recovery and capacity targets. Run approved SCA and image scans on the exact artifact.
- [ ] Record release digest, environment, observed result, evidence path, owner and client sign-off for each row.

Runtime checks above remain UNVERIFIED unless listed as passed in the README. Negative authorization tests use existing documented roles and supported user flows.
