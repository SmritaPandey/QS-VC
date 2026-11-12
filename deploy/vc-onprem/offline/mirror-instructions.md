# Offline delivery

**ASSUMED – pending client approval**. Use a connected Linux builder of the
target architecture. Prepare a fresh output directory and a private build env.
Use the client package mirror and independently verify its repository metadata
and trusted signing keys. Keep signing keys off the builder for production.
The current signing helper accepts local key files for a controlled pilot.

Stage images with offline/bundle.sh BUILD_ENV NEW_OUTPUT ED25519_KEY ML_DSA_65_KEY.
The existing image packager requires Docker, Syft, Grype and a current Grype DB.
Retain scan logs and attestations from that build. The baseline excludes optional
AI and Poly images and does not mirror OS packages. Transfer the bundle, approved
OS dependencies and public key fingerprints via client-approved channels. Run
verification before Docker import. Record loaded image IDs and deny runtime egress.
