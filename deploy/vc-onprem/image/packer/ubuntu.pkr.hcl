packer {
  required_plugins {
    qemu = {
      source  = "github.com/hashicorp/qemu"
      version = "= 1.1.4"
    }
  }
}

variable "iso_url" { type = string }
variable "iso_checksum" { type = string }
variable "seed_dir" { type = string }
variable "build_private_key_path" { type = string }

source "qemu" "ubuntu" {
  iso_url          = var.iso_url
  iso_checksum     = var.iso_checksum
  accelerator      = "kvm"
  format           = "qcow2"
  disk_size        = "32768"
  memory           = 4096
  cpus             = 2
  http_directory   = var.seed_dir
  ssh_username     = "qsvc-build"
  ssh_private_key_file = var.build_private_key_path
  ssh_timeout      = "30m"
  boot_wait        = "5s"
  boot_command     = ["c<wait>", "linux /casper/vmlinuz autoinstall ds=nocloud-net\\;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/ ---<enter>", "initrd /casper/initrd<enter>", "boot<enter>"]
  shutdown_command = "sudo -n sh -c 'rm -f /home/qsvc-build/.ssh/authorized_keys /etc/sudoers.d/90-cloud-init-users && cloud-init clean --logs --machine-id && shutdown -P now'"
}

build {
  sources = ["source.qemu.ubuntu"]
  provisioner "shell" {
    inline = ["test -d /etc/ssh", "sudo -n true"]
  }
}
