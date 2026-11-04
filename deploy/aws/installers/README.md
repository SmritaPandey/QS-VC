Place reviewed releases here as:

- `QS-VC-Windows-Setup.exe`
- `QS-VC-macOS-arm64.zip` (Apple silicon)
- `QS-VC-macOS-x64.zip` (Intel)

This directory is mounted read-only into auth, never exposed as static web content.
Do not add installer binaries to Git. The authenticated download API checks each
file's configured availability and the user's active enterprise access before sending it.
The protected production workflow reconstructs and checksum-verifies Windows,
builds both Mac architectures on macOS, and includes the Mac archives with
release-specific checksum files. The deploy script verifies all three before
restarting services. Keep installer binaries and checksums out of Git.
