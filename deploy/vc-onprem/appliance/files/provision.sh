#!/usr/bin/env bash
# Runs inside the appliance build VM (Packer). Prepares the first-boot experience and removes build access.
set -euo pipefail
for asset in /tmp/qsvc-server-setup.run /tmp/qsvc-firstboot.sh /tmp/qsvc-firstboot.service; do
  if [[ ! -f "$asset" || ! -s "$asset" ]]; then
    printf 'Missing appliance provisioning file: %s\n' "$asset" >&2
    exit 1
  fi
done
dnf -y update
dnf -y install podman newt python3 iproute chrony container-selinux policycoreutils-python-utils
install -d -m 0755 /opt/qsvc-appliance
install -m 0755 /tmp/qsvc-server-setup.run /opt/qsvc-appliance/qsvc-server-setup.run
install -m 0755 /tmp/qsvc-firstboot.sh /usr/local/sbin/qsvc-firstboot
install -m 0644 /tmp/qsvc-firstboot.service /etc/systemd/system/qsvc-firstboot.service
systemctl enable qsvc-firstboot.service
systemctl disable sshd.service                      # SSH off until the administrator enables it from the console menu
systemctl enable podman.socket
# Hardening basics: no core dumps, secure sysctl, audit on, password quality.
printf '* hard core 0\n' > /etc/security/limits.d/90-nocore.conf
cat > /etc/sysctl.d/90-qsvc-hardening.conf <<SYS
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.suid_dumpable = 0
SYS
sed -i 's/^# *minlen.*/minlen = 14/' /etc/security/pwquality.conf
systemctl enable auditd
# Leave no build identity behind. The build account (random per-build password, SSH disabled in the image)
# is still in use by Packer here; the first-boot service deletes it before showing the console menu.
passwd -l qsvcbuild
rm -f /etc/ssh/ssh_host_*
truncate -s 0 /etc/machine-id
dnf clean all
rm -f /tmp/qsvc-server-setup.run /tmp/qsvc-firstboot.sh /tmp/qsvc-firstboot.service
