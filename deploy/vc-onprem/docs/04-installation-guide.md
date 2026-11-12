# Installation

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

1. Stage the signed release in a directory exclusively writable by the operator. Obtain both public keys and trusted verifier independently.
2. Run the verifier from the trusted tool copy. Expect two successful signature checks and an exact inventory match.
3. Copy config/onprem.env.template to a private 0600 file outside the release. Generate unique secrets. Use absolute paths for private signing keys. Check host prerequisites before modifying the VM.
4. Run scripts/install.sh as root with STAGED_RELEASE PRIVATE_ENV ED25519_PUB ML_DSA_65_PUB from the trusted tool copy. Expect image import and Postgres staging only.
5. Follow db/create-application-accounts.sql instructions with the configured restricted roles and verify with db/verify-access.sql. Use the same passwords in the private env. Never pass passwords on command lines.
6. Confirm firewall and certificate trust. Use Compose with both signed files and --pull never --no-build. For the existing Caddy internal CA install the public root on managed clients using the client's trust process. Run post-install-verify.sh FQDN TRUSTED_CA.
7. Complete UAT. On failure, stop the stack without deleting volumes and restore only according to the operations plan.

Gold image route uses the steps above. QCOW2 route requires the build and import evidence first, plus site-specific NoCloud data and new host keys. Both routes are UNVERIFIED end to end.

The trial begins when the installer stages PostgreSQL and records the host
installation timestamp in /var/lib/qsvc/onprem-trial/installed-at. Keep this
directory across upgrades and reinstalls. The signed offline Compose overlay and
generated Caddy configuration enforce the trial together. At 14 × 24 hours,
the gateway blocks application routes, signaling and the SFU stop, and the
expiration page links to https://qsvcmeet.com/contact?interest=Enterprise.
Use a synchronized host clock. This local control cannot resist a client with
root access or restore of an earlier VM snapshot.

For a public download, publish the signed package and pass its HTTPS URL as
VITE_ONPREM_TRIAL_DOWNLOAD_URL when building the public web app. If the URL is
unset, visitors can request the package without signing in.
