Place reviewed releases here as:

- `QS-VC-Windows-x64.zip` (contains `QS-VC-Windows-Setup.exe` and its checksum)
- `QS-VC-macOS-arm64.zip` (Apple silicon)
- `QS-VC-macOS-x64.zip` (Intel)
- `QS-VC-Linux-x64.zip` (Linux x86-64)

This directory is mounted read-only into auth, never exposed as static web content.
Do not add installer binaries to Git. The authenticated download API checks each
file's configured availability and the user's active enterprise access before sending it.
The protected production workflow checks the Windows executable, packages it
as a ZIP, builds both Mac architectures on macOS, and builds the Linux tar.gz on
Ubuntu. It includes all four archives with release-specific checksum files. The
deploy script verifies every archive before restarting services. Keep installer
binaries and checksums out of Git.

Rebuild all four desktop packages from the same source revision whenever the
desktop client changes. In particular, the enterprise activation count is sent
only by clients that include the first-sign-in reporting code; older staged ZIPs
can still download and install but will not report that metric. Replace the
archives and sidecar checksums together after the protected platform builds.
