#!/usr/bin/env bash
# Prepare a fresh E2E Networks GPU node (Ubuntu 22.04): Docker, NVIDIA container toolkit, firewall.
# Run as root. Safe to re-run.
set -Eeuo pipefail
command -v nvidia-smi >/dev/null || { echo "No NVIDIA driver found. Choose an E2E GPU image with drivers/CUDA preinstalled."; exit 1; }
nvidia-smi
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
if ! dpkg -s nvidia-container-toolkit >/dev/null 2>&1; then
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update && apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
fi
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
# Firewall: SSH (restrict further in the E2E console if you can), HTTP for certificates, HTTPS for the backend.
if command -v ufw >/dev/null; then
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable && ufw status
fi
echo "Node ready. Next: fill deploy/e2e/.env and run docker compose (see deploy/e2e/README.md)."
