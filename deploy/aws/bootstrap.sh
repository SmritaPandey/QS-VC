#!/bin/bash
# EC2 user data for the approved Amazon Linux 2023 x86_64 image.
set -euo pipefail
dnf install -y docker
systemctl enable --now docker
# Build headroom for the 2 GiB demo host; the root volume is encrypted.
fallocate -l 2G /swapfile
chmod 0600 /swapfile
mkswap /swapfile
swapon /swapfile
printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
install -d -m 0755 /usr/local/lib/docker/cli-plugins
curl --fail --location --retry 3 https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
install -d -m 0700 /opt/qsvc
# Bound host logs; application container logs are bounded in compose.yml.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/qsvc.conf
systemctl restart systemd-journald
