#!/bin/bash
# One-time setup for the QS-VC CPU AI instance (Amazon Linux 2023, m7i-flex.large). Run as root.
set -euo pipefail
dnf install -y docker
systemctl enable --now docker
if ! swapon --show | grep -q /swapfile; then          # headroom while building images / loading models
  fallocate -l 4G /swapfile && chmod 0600 /swapfile && mkswap /swapfile && swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
install -d -m 0755 /usr/local/lib/docker/cli-plugins
curl --fail --location --retry 3 https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
install -d -m 0700 /opt/qsvc
mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/qsvc.conf
systemctl restart systemd-journald
docker compose version
echo "Ready. Put the code in /opt/qsvc and follow deploy/aws/cpu/README.md step 3."
