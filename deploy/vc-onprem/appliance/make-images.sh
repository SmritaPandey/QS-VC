#!/usr/bin/env bash
# Convert the appliance QCOW2 into VMware OVA and Hyper-V VHDX (zipped), with SHA-256 files.
#   bash make-images.sh out-<version>/qsvc-appliance-<version>.qcow2 <version> OUTPUT_DIR
set -euo pipefail
# Portable between the Ubuntu runner and macOS (BSD tools).
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
[[ $# == 3 ]] || { echo 'Usage: make-images.sh APPLIANCE.qcow2 VERSION OUTPUT_DIR' >&2; exit 2; }
src=$1; ver=$2; out=$3; mkdir -p "$out"; work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
name="QS-VC-Server-Appliance-$ver"
cp "$src" "$out/$name.qcow2"
qemu-img convert -O vmdk -o subformat=streamOptimized "$src" "$work/$name-disk1.vmdk"
vmdk_size=$(wc -c <"$work/$name-disk1.vmdk" | tr -d " "); cap=$(qemu-img info --output=json "$src" | python3 -c 'import json,sys;print(json.load(sys.stdin)["virtual-size"])')
cat >"$work/$name.ovf" <<OVF
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1" xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
 xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
 xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
 xmlns:vmw="http://www.vmware.com/schema/ovf">
 <References><File ovf:href="$name-disk1.vmdk" ovf:id="file1" ovf:size="$vmdk_size"/></References>
 <DiskSection><Info>Virtual disk</Info><Disk ovf:capacity="$cap" ovf:capacityAllocationUnits="byte" ovf:diskId="vmdisk1" ovf:fileRef="file1" ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"/></DiskSection>
 <NetworkSection><Info>Network</Info><Network ovf:name="VM Network"><Description>Hub network reachable over MPLS</Description></Network></NetworkSection>
 <VirtualSystem ovf:id="$name"><Info>QS-VC Server Appliance $ver</Info><Name>QS-VC Server</Name>
  <OperatingSystemSection ovf:id="80" vmw:osType="rockylinux_64Guest"><Info>Rocky Linux 9 (64-bit)</Info></OperatingSystemSection>
  <VirtualHardwareSection><Info>8 vCPU, 16 GB RAM</Info>
   <System><vssd:ElementName>Virtual Hardware Family</vssd:ElementName><vssd:InstanceID>0</vssd:InstanceID><vssd:VirtualSystemType>vmx-19</vssd:VirtualSystemType></System>
   <Item><rasd:AllocationUnits>hertz * 10^6</rasd:AllocationUnits><rasd:ElementName>8 virtual CPUs</rasd:ElementName><rasd:InstanceID>1</rasd:InstanceID><rasd:ResourceType>3</rasd:ResourceType><rasd:VirtualQuantity>8</rasd:VirtualQuantity></Item>
   <Item><rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits><rasd:ElementName>16384 MB memory</rasd:ElementName><rasd:InstanceID>2</rasd:InstanceID><rasd:ResourceType>4</rasd:ResourceType><rasd:VirtualQuantity>16384</rasd:VirtualQuantity></Item>
   <Item><rasd:ElementName>SCSI controller</rasd:ElementName><rasd:InstanceID>3</rasd:InstanceID><rasd:ResourceSubType>VirtualSCSI</rasd:ResourceSubType><rasd:ResourceType>6</rasd:ResourceType></Item>
   <Item><rasd:AddressOnParent>0</rasd:AddressOnParent><rasd:ElementName>Hard disk 1</rasd:ElementName><rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource><rasd:InstanceID>4</rasd:InstanceID><rasd:Parent>3</rasd:Parent><rasd:ResourceType>17</rasd:ResourceType></Item>
   <Item><rasd:AutomaticAllocation>true</rasd:AutomaticAllocation><rasd:Connection>VM Network</rasd:Connection><rasd:ElementName>Network adapter 1</rasd:ElementName><rasd:InstanceID>5</rasd:InstanceID><rasd:ResourceSubType>VmxNet3</rasd:ResourceSubType><rasd:ResourceType>10</rasd:ResourceType></Item>
   <vmw:Config ovf:required="false" vmw:key="firmware" vmw:value="efi"/>
  </VirtualHardwareSection>
 </VirtualSystem>
</Envelope>
OVF
( cd "$work" && sha256 "$name.ovf" "$name-disk1.vmdk" | sed -E 's/^([0-9a-f]+)  (.*)$/SHA256(\2)= \1/' > "$name.mf" )
COPYFILE_DISABLE=1 tar --format=ustar -C "$work" -cf "$out/$name.ova" "$name.ovf" "$name.mf" "$name-disk1.vmdk"
qemu-img convert -O vhdx -o subformat=dynamic "$src" "$work/$name.vhdx"
( cd "$work" && zip -q -0 "$out/$name-HyperV.zip" "$name.vhdx" )
( cd "$out" && sha256 "$name.ova" > "$name.ova.sha256" && sha256 "$name.qcow2" > "$name.qcow2.sha256" && sha256 "$name-HyperV.zip" > "$name-HyperV.zip.sha256" )
ls -la "$out"
