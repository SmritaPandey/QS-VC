# Windows Server installer

Download `QS-VC-Server-Setup-<version>.exe` and run it as administrator. The EXE embeds the matching Hyper-V appliance and checksum. No separate ZIP download or appliance selection is required. Setup extracts its payload temporarily, verifies it through the existing PowerShell installer, and creates the VM. An existing External Hyper-V switch, memory and CPU settings are still required.

In Actions → On-prem installers, enable `build_windows_server`. This automatically builds the appliance first, verifies its checksum, then embeds it in the EXE. Supply the private HTTPS URL and SHA-256 of the signed server `.run`, plus the approved Rocky ISO SHA-256. The approved EULA is required. For desktop-only builds, disable both server and appliance builds.

Local packaging requires the same trusted appliance inputs:

```sh
bash deploy/vc-onprem/windows-server/build-with-docker.sh VERSION OUTPUT_DIR APPLIANCE_DIR
```

`APPLIANCE_DIR` must contain `QS-VC-Server-Appliance-<version>-HyperV.zip` and its `.sha256` file. The script verifies the checksum before compiling. These are release-builder inputs, not user installation inputs. Missing payloads stop the build; no runtime download is introduced.

Older EXE-only installers still require their matching external appliance; rebuild this installer to obtain the self-contained version. The new EXE includes a VM disk and can be large; actual release size has not been measured.

Source changes do not establish Windows installation, Hyper-V import, first boot, private DNS/TLS, backup/restore or rollback readiness. These require release-environment verification.
