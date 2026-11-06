# E2E Networks GPU host (India) for multilingual captions

Runs speech recognition (Whisper + IndicConformer) and translation (IndicTrans2) on an E2E
Networks GPU node in India. Your QS-VC backend (AWS) reaches it over HTTPS. Three locks protect it:
an IP allowlist (only the backend's IP), API keys on both services, and TLS.

```
Browser ─WSS─► AWS backend (signaling) ─HTTPS/WSS─► ai.qsvcmeet.com (E2E GPU, Caddy) ─► asr :8000 / mt :5000
```

## 1. E2E console (myaccount.e2enetworks.com)
1. Create an account and complete KYC/billing (INR).
2. **Create a GPU node** in a Delhi or Mumbai location:
   - GPU: **NVIDIA L4** (24 GB) recommended; A30 also fine. One GPU is enough to start.
   - Image: an **Ubuntu 22.04 GPU image with NVIDIA drivers/CUDA preinstalled**.
   - Disk: 100 GB or more. Add your SSH key.
3. **Firewall / security group** for the node (if offered in the console; `setup-node.sh` also configures `ufw`):
   - TCP 443 and 80 from anywhere (80 is only for the HTTPS certificate; Caddy refuses every other IP).
   - TCP 22 from your own IP only.
4. Note the node's **public IP**.

## 2. DNS
Add an **A record** `ai.qsvcmeet.com → <E2E public IP>`. In Cloudflare set it to **DNS only (grey cloud)**,
so certificates and the IP allowlist work.

## 3. Install on the node
```sh
ssh root@<E2E public IP>
mkdir -p /opt/qsvc && cd /opt/qsvc          # copy services/asr, services/mt and deploy/e2e here
bash deploy/e2e/setup-node.sh                # Docker + NVIDIA container toolkit + firewall; checks the GPU
cp deploy/e2e/.env.example deploy/e2e/.env && chmod 600 deploy/e2e/.env
nano deploy/e2e/.env                         # AI_DOMAIN, ALLOWED_IPS = AWS backend Elastic IP, keys, HF_TOKEN
docker compose -f deploy/e2e/compose.yml --env-file deploy/e2e/.env up -d --build
docker logs -f qsvc-asr                      # first start downloads models
```

## 4. Check
From the **AWS backend** (allowed):
```sh
curl -s https://ai.qsvcmeet.com/asr/health          # {"ok":true}
curl -s https://ai.qsvcmeet.com/asr/v1/languages | head -c 300
curl -s https://ai.qsvcmeet.com/mt/health
```
From your laptop (not allowed): the same URLs must answer **403 Forbidden**.

## 5. Connect the backend
In `/opt/qsvc/deploy/aws/.env` on AWS:
```
ASR_URL=https://ai.qsvcmeet.com/asr
ASR_API_KEY=<same as E2E .env>
CAPTION_TRANSLATION_PROVIDER=libretranslate
LIBRETRANSLATE_URL=https://ai.qsvcmeet.com/mt
LIBRETRANSLATE_API_KEY=<same as E2E MT_API_KEY>
# optional minutes on the same GPU (start with --profile llm, then: docker exec qsvc-ollama ollama pull qwen2.5:7b)
MINUTES_LLM_URL=https://ai.qsvcmeet.com/llm/v1
MINUTES_LLM_MODEL=qwen2.5:7b
```
Redeploy signaling. If the backend's Elastic IP ever changes, update `ALLOWED_IPS` and run
`docker compose ... up -d proxy`.

## Notes
- Data stays in India (E2E data centres). Confirm E2E's MeitY empanelment status for your tender.
- Ollama has no API key of its own; it is protected by the IP allowlist only.
- Latency: India ↔ India adds roughly 20–50 ms per hop compared with a private network — small next to the
  0.6 s pause detection.
- Cost: GPU nodes bill while they exist. Stop/delete when idle; captions fall back automatically.
