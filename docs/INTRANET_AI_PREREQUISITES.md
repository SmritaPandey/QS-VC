# Intranet deployment — AI captions prerequisites (customer-provided GPU)

For intranet (on-premises) installations, the customer provides the GPU server. QS-VC installs its speech
recognition and translation services on it. Audio, captions and transcripts never leave the customer network.

## 1. What the customer must provide

| Item | Minimum | Recommended |
|---|---|---|
| GPU | 1× NVIDIA, 16 GB memory (T4, A2, RTX 4000 Ada) | 1× NVIDIA 24 GB (L4, A10, RTX 4090/3090/A5000) or larger |
| NVIDIA driver | 535 or newer (CUDA 12.x) | latest data-centre driver |
| CPU / RAM | 8 cores / 32 GB | 16 cores / 64 GB |
| Disk | 100 GB SSD | 200 GB NVMe |
| OS | Ubuntu 22.04 LTS (64-bit) | Ubuntu 22.04 / 24.04 LTS |
| Software | Docker Engine 24+, Docker Compose v2, NVIDIA Container Toolkit | same |
| Network | Reachable from the QS-VC server on TCP 8000 (speech) and 5000 (translation); 11434 if minutes run here | dedicated VLAN; no inbound from users |
| Internet (setup only) | Outbound HTTPS to download images and models once | or an offline model bundle (below) |
| Accounts | Hugging Face read token with the IndicConformer terms accepted (for the first download) | — |

Capacity: one 24 GB GPU handles roughly 8–20 people speaking at the same time with captions on
(listeners cost nothing). Add GPUs/servers for more. Verify with a load test on the actual hardware.

## 2. Customer checks before installation
```sh
nvidia-smi                                                        # GPU and driver listed
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi   # GPU visible inside Docker
docker compose version                                            # v2.x
```

## 3. QS-VC installs
On the GPU server (the compose file works on any Linux GPU server, not only AWS):
```sh
cp deploy/aws/gpu/.env.example deploy/aws/gpu/.env && chmod 600 deploy/aws/gpu/.env   # keys, HF_TOKEN
docker compose -f deploy/aws/gpu/compose.yml --env-file deploy/aws/gpu/.env up -d --build
```
On the QS-VC intranet server, in the root `.env`:
```
ASR_URL=http://<gpu-server-ip>:8000
ASR_API_KEY=<same as GPU server>
CAPTION_TRANSLATION_PROVIDER=libretranslate
LIBRETRANSLATE_URL=http://<gpu-server-ip>:5000
LIBRETRANSLATE_API_KEY=<same as GPU server MT_API_KEY>
MINUTES_LLM_URL=http://<gpu-server-ip>:11434/v1      # optional, with --profile llm
MINUTES_LLM_MODEL=qwen2.5:7b
```
Then restart QS-VC (`npm run intranet` or the customer's service manager) and run `node db/migrate.js`.

## 4. Air-gapped networks (no internet)
Prepare once on a connected machine and copy over:
- Docker images: `docker save qsvc-asr qsvc-mt ollama/ollama | gzip > qsvc-ai-images.tgz`, then `docker load` on site.
- Model files: the `asr_models`, `mt_models` (and `ollama_models`) volumes, then set `HF_HUB_OFFLINE=1`.

## 5. Browser requirement
Browsers only allow the microphone on HTTPS pages (or localhost). Intranet users must open QS-VC through an
HTTPS address with a certificate their computers trust, or use the QS-VC desktop app. Plain
`http://<LAN-IP>` lets people read captions but not share their own speech.

## 6. No GPU available?
Captions fall back to browser recognition (Chrome/Edge; audio goes to the browser vendor), and translation can
use a configured LibreTranslate-compatible or Google service. Server recognition needs the GPU above.
