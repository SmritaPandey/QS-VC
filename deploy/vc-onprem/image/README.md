# VM image build candidate

**ASSUMED – pending client approval**. Start with the client's gold image or
Ubuntu Server 24.04 LTS on an isolated Linux x86-64 KVM builder. The QEMU
pipeline is UNVERIFIED. It produces a candidate OS image. Deploy the signed
application bundle separately.

1. Obtain the OS ISO from the client mirror and verify the vendor-signed
   checksum. Create an ephemeral SSH key for this build only.
2. In a private staging directory, create empty meta-data and render user-data
   from kickstart-or-autoinstall/user-data.template with the build public key.
   Put only these files in the Packer HTTP seed directory.
3. Create a private Packer variables file with absolute iso_url, iso_checksum,
   seed_dir and build_private_key_path. Use the published sha256 checksum.
4. Run bash image/scripts/build-image.sh /absolute/path/to/pilot.pkrvars.hcl.
   Record the Packer/QEMU/plugin versions and Git revision.
5. Boot a copy with client-rendered NoCloud user-data, network-config and
   meta-data. Supply client addressing, DNS and NTP through approved
   network/cloud-init configuration. Keep HSM enrollment outside user-data.
6. Verify the build user cannot log in, the client operator can log in, and
   each imported VM has unique host keys and machine identity. Apply the
   Ansible candidate with a client inventory. Verify SSH syntax and reconnect
   before applying additional hardening.
7. Record package inventory, Secure Boot/TPM result, artifact checksum and
   client import evidence. Conversion only supports candidate VMDK/VHDX
   disk formats. OVF/OVA packaging requires the client toolchain.
8. Place accepted artifacts in the signed release inventory. Verify both
   signatures on a separate clean machine before transfer.
