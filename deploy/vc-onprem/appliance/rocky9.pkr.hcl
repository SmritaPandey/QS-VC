# QS-VC Server Appliance: hardened Rocky Linux 9 with the QS-VC server installer preloaded.
# Outputs a QCOW2 disk; make-images.sh converts it to OVA (VMware) and VHDX (Hyper-V).
#   packer init . && packer build -var iso_url=... -var iso_checksum=sha256:... -var setup_run=../out/qsvc-server-setup-<v>.run .
packer {
  required_plugins {
    qemu = { source = "github.com/hashicorp/qemu", version = "= 1.1.4" }
  }
}
variable "iso_url"      { type = string }   # Rocky-9.x-x86_64-minimal.iso (mirror or local file://)
variable "iso_checksum" { type = string }   # "sha256:<value from the Rocky CHECKSUM file>"
variable "setup_run"    { type = string }   # signed qsvc-server-setup-<version>.run
variable "version"      { type = string }
variable "build_password" {
  type      = string
  sensitive = true                          # random per build; the account is removed before shutdown
}

source "qemu" "rocky9" {
  iso_url          = var.iso_url
  iso_checksum     = var.iso_checksum
  accelerator      = "kvm"
  format           = "qcow2"
  disk_size        = "120G"
  disk_interface   = "virtio"
  net_device       = "virtio-net"
  memory           = 4096
  cpus             = 2
  firmware         = "/usr/share/OVMF/OVMF_CODE_4M.fd"
  efi_boot         = true
  headless         = true
  http_content     = { "/ks.cfg" = templatefile("${path.root}/http/ks.cfg.pkrtpl", { build_password = var.build_password }) }
  boot_wait        = "5s"
  boot_command     = ["e<down><down><end><bs><bs><bs><bs><bs> inst.text inst.ks=http://{{ .HTTPIP }}:{{ .HTTPPort }}/ks.cfg<leftCtrlOn>x<leftCtrlOff>"]
  ssh_username     = "qsvcbuild"
  ssh_password     = var.build_password
  ssh_timeout      = "45m"
  shutdown_command = "sudo -n systemctl poweroff"
  vm_name          = "qsvc-appliance-${var.version}.qcow2"
  output_directory = "out-${var.version}"
}

build {
  sources = ["source.qemu.rocky9"]
  provisioner "file" {
    source      = var.setup_run
    destination = "/tmp/qsvc-server-setup.run"
  }
  provisioner "file" {
    source      = "${path.root}/files/"
    destination = "/tmp/appliance-files"
  }
  provisioner "shell" {
    execute_command = "sudo -n bash '{{ .Path }}'"
    script          = "${path.root}/files/provision.sh"
  }
}
