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


## Download the installer

1. Open On-prem on the QS-VC website and choose Download installer. When the installer is staged, the website streams the signed Linux server archive to your browser.
2. Run the installer on the Linux server. Installation works offline and requires local administrator access and release signature verification. There is no QS-VC sign-in during installation.

   Obtain the trusted installer tool and both release signing public keys
   independently. Prepare the private environment file. Run:

       sudo bash scripts/install-archive.sh QS-VC-On-prem-Installer.tar.gz /opt/qsvc/release PRIVATE_ENV ED25519_PUB ML_DSA_65_PUB

3. Follow the database role and service startup steps above. Preserve the
   extracted release directory. Container bind mounts use files in it.

Stage the signed archive on the portal in the existing private installer mount
under the configured ENTERPRISE_ONPREM_TRIAL_INSTALLER path. Never host it in
the web root. Continue with the existing MCU and workspace sign-in steps where applicable. The On-prem workspace requires a verified sign-in to join meetings
during the trial. At expiry, the workspace directs users to Contact us for an extension.

## Resume after approval

The expired workspace displays its installation ID. The customer sends that ID
and their portal account email through Contact us. In the hosted Admin Console,
find the account, save the agreed access term, then enter the installation ID
and download the signed license. Give that JSON file to the customer.

On the installed Linux server, apply the file with:

    sudo install -m 0644 qsvc-onprem-license.json /var/lib/qsvc/onprem-trial/license.json.new
    sudo mv /var/lib/qsvc/onprem-trial/license.json.new /var/lib/qsvc/onprem-trial/license.json

The gateway checks the signature and installation ID on each request. Signaling
and media restart under Compose's restart policy. If those services were stopped
manually, start them again with the signed Compose files and private environment.

Configure a dedicated Ed25519 signing key on the hosted auth service using
QSVC_ONPREM_LICENSE_KEY_FILE. The AWS Compose mounts deploy/aws/license-private read-only at /run/qsvc-license. Store signing.pem there with read access only for the auth service identity and the host administrator. The builder requires
the matching public key path in QSVC_ONPREM_LICENSE_PUBLIC_KEY. The signed package
contains only the public key. This offline approval takes effect after the
customer applies the file. It expires on the approved date and cannot be revoked
remotely while the server remains offline.
