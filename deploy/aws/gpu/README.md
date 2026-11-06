# AWS GPU host for multilingual captions

The backend EC2 instance (deploy/aws/compose.yml) stays as it is. Add ONE GPU instance in the
same VPC (Mumbai, ap-south-1) that runs only the AI services. Users never connect to it: browsers
talk to signaling on the backend, and signaling calls the GPU host over the private network.

```
Browser ──WSS──► backend EC2 (signaling) ──private VPC──► GPU EC2 :8000 asr / :5000 mt / :11434 ollama
```

## 1. Before you start (AWS console, once)
1. **GPU quota**: Service Quotas → EC2 → "Running On-Demand G and VT instances" in ap-south-1.
   New accounts often have 0 vCPUs. Request at least 4 (g6.xlarge / g5.xlarge). Approval can take a day.
2. **Instance type**: `g6.xlarge` (1× NVIDIA L4, 24 GB) recommended; `g5.xlarge` (A10G 24 GB) also works;
   `g4dn.xlarge` (T4 16 GB) is cheaper and slower. Confirm availability and price in the Mumbai console.
3. **AMI**: "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)" — includes the NVIDIA driver,
   Docker and the NVIDIA container toolkit.
4. **Disk**: 100 GiB encrypted gp3 (images + models ≈ 25–35 GB).
5. **Network**: same VPC/subnet as the backend. No public inbound rules. Security group inbound:
   TCP 8000, 5000 (and 11434 if using Ollama) **source = the backend instance's security group**. Nothing else.
   Use SSM Session Manager (attach the same SSM role as the backend) instead of SSH.

## 2. Install
```sh
nvidia-smi                                   # must list the GPU
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi   # GPU visible in Docker
sudo mkdir -p /opt/qsvc && cd /opt/qsvc      # extract the same source archive used for the backend
cp deploy/aws/gpu/.env.example deploy/aws/gpu/.env && chmod 600 deploy/aws/gpu/.env   # fill in secrets
docker compose -f deploy/aws/gpu/compose.yml --env-file deploy/aws/gpu/.env up -d --build
docker logs -f qsvc-asr                      # first start downloads models (several GB)
```

## 3. Check
```sh
curl -s localhost:8000/health                # {"ok":true}
curl -s localhost:8000/v1/languages | head -c 400   # Tamil should show "engine":"indicconformer"
curl -s localhost:5000/languages | head -c 200
```
If the log says `IndicConformer unavailable`, the HF_TOKEN or model terms are missing; Whisper still works.

## 4. Connect the backend
In `/opt/qsvc/deploy/aws/.env` on the backend set `ASR_URL=http://<gpu-private-ip>:8000`,
`LIBRETRANSLATE_URL=http://<gpu-private-ip>:5000`, the two shared keys, then:
```sh
docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env up -d signaling
```
Use an Elastic Network Interface or a fixed private IP so the address survives stop/start.

## 5. Cost control
GPU instances bill per hour while running. For pilots, stop the instance outside meeting hours
(captions fall back to browser recognition automatically while it is off), or schedule start/stop.
Capacity is driven by people speaking at the same time, not participants.
