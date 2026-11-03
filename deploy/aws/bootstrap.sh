#!/bin/bash
# EC2 user data for the approved Amazon Linux 2023 x86_64 image.
set -euo pipefail
dnf install -y docker
systemctl enable --now docker
install -d -m 0755 /usr/local/lib/docker/cli-plugins
curl --fail --location --retry 3 https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
install -d -m 0700 /opt/qsvc
# Bound host logs; application container logs are bounded in compose.yml.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/qsvc.conf
systemctl restart systemd-journald
