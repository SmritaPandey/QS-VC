# CPU AI host on the AWS Free plan (m7i-flex.large)

Runs QS-VC speech recognition (Whisper `small`, int8) and translation (IndicTrans2 distilled) on a
CPU-only instance, because Free-plan accounts cannot launch GPU instances. Good for demos and pilots:

| | CPU host (this guide) | GPU host (deploy/aws/gpu, deploy/e2e) |
|---|---|---|
| People speaking at once | about 1 (2 at most) | 8–20 |
| Caption delay after a sentence | about 3–5 s (estimate) | about 1–1.5 s |
| Live grey text | slower (every 2.5 s) | every 0.7 s |
| Languages spoken | English, Hindi (others possible, weaker) | 22 Indian languages + English |
| Translation | IndicTrans2, English ↔ 11 Indian languages | same, faster |

Users never connect to this instance. Browsers talk to signaling on the backend; signaling calls this host
over the VPC private network.

```
Browser ─WSS─► backend EC2 (signaling) ─private VPC─► AI EC2 :8000 speech / :5000 translation
```

## 1. Instance (AWS console, Mumbai ap-south-1)
- Type **m7i-flex.large** (Free-plan eligible: 2 vCPU, 8 GiB). AMI **Amazon Linux 2023** x86_64.
- **Same VPC/subnet as the backend**, auto-assign public IP **on** (needed only to download images/models).
- Storage **30 GiB gp3, encrypted** (Free plan includes 30 GB of EBS).
- **IAM instance profile**: the backend's role (for Session Manager). Metadata: IMDSv2 only. No key pair.
- **Security group** (e.g. `qsvc-ai`): inbound TCP **8000** and **5000**, source = the backend's security group
  (`qsvc-backend-BackendSecurityGroup…`). No other inbound rules. Outbound: all.
- Optional: paste `setup-instance.sh` into **Advanced details → User data** so step 2 runs at first boot.

## 2. Prepare the instance (Session Manager → Connect)
```sh
sudo -i
bash /path/to/setup-instance.sh          # Docker, Compose plugin, 4 GB swap, log limits (skip if used as user data)
```

## 3. Code, secrets, start
Copy the QS-VC source into `/opt/qsvc`. The Docker builds also need
`shared/model_security.py`. Keep existing keys in `deploy/aws/cpu/.env` if
signaling already uses them. For a new installation:
```sh
cd /opt/qsvc
openssl rand -hex 32                      # → ASR_API_KEY (keep it)
openssl rand -hex 32                      # → MT_API_KEY  (keep it)
cp deploy/aws/cpu/.env.example deploy/aws/cpu/.env && chmod 600 deploy/aws/cpu/.env
nano deploy/aws/cpu/.env                  # paste both keys
```

Set `ASR_MODEL=/models/whisper` in the private env file. Prepare the multilingual
faster-whisper small model and both IndicTrans2 distilled 200M directions
(`ai4bharat/indictrans2-en-indic-dist-200M` and `ai4bharat/indictrans2-indic-en-dist-200M`).
Download exact revisions, review the model files and custom Python, and stage real
files without cache symlinks. Run `python3 scripts/pin-model.py DIRECTORY --revision COMMIT`
for each reviewed bundle. Use a full 40-character commit hash. The services require
these manifests and read the model volumes without downloading models at startup.

Place the three prepared folders on the AI host under `/opt/qsvc/model-bundles`
as `whisper`, `en-indic`, and `indic-en`. With the same Compose project used to
launch the services, run the following on the AI host. These commands preserve
any model directories already present in the volumes. If an existing directory
fails verification, inspect and replace that bundle separately.

```sh
cd /opt/qsvc
(
set -eu
qsvc_ai() {
  sudo docker compose -f deploy/aws/cpu/compose.yml --env-file deploy/aws/cpu/.env "$@"
}
qsvc_ai config --quiet
qsvc_ai build asr mt
qsvc_ai create asr mt

stage_models() {
  service=$1
  shift
  volume=$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/models"}}{{.Name}}{{end}}{{end}}' "qsvc-$service")
  test -n "$volume"
  sudo docker run --rm --network none --user 0 --entrypoint sh \
    --mount "type=volume,source=$volume,target=/models" \
    --mount type=bind,source=/opt/qsvc/model-bundles,target=/bundles,readonly \
    "qsvc-$service:cpu" -ec '
      for model in "$@"; do
        if [ ! -e "/models/$model" ]; then
          test -f "/bundles/$model/qsvc-model-manifest.json"
          staging=$(mktemp -d /models/.stage.XXXXXX)
          trap '"'"'rm -rf "$staging"'"'"' EXIT
          cp -R "/bundles/$model" "$staging/$model"
          chown -R 10001 "$staging/$model"
          mv "$staging/$model" "/models/$model"
          rmdir "$staging"
          trap - EXIT
        fi
      done
    ' sh "$@"
}
stage_models asr whisper
stage_models mt en-indic indic-en

qsvc_ai run --rm --no-deps --entrypoint python asr -c 'from shared.model_security import model_path; model_path("/models/whisper")'
qsvc_ai run --rm --no-deps --entrypoint python mt -c 'from shared.model_security import model_path; model_path("/models/en-indic"); model_path("/models/indic-en")'
qsvc_ai up -d asr mt
)
```

## 4. Check (on the AI instance)
```sh
curl -s localhost:8000/health             # {"ok":true}
curl -s localhost:8000/v1/languages       # English, Hindi; "engine":"faster-whisper", "model":"small"
curl -s localhost:5000/health             # {"ok":true} once the models are loaded
curl -s -X POST localhost:5000/translate -H 'Content-Type: application/json' \
  -d "{\"q\":\"The meeting is tomorrow\",\"source\":\"en\",\"target\":\"hi\",\"api_key\":\"$(grep ^MT_API_KEY deploy/aws/cpu/.env | cut -d= -f2)\"}"
docker stats --no-stream                  # memory: asr < 2 GB, mt < 4.5 GB
```

## 5. Connect the backend
First redeploy the backend with the current code (it adds the caption features and runs migration 014).
Then in `/opt/qsvc/deploy/aws/.env` on the backend, using the AI instance's **private IPv4**:
```
ASR_URL=http://<AI-PRIVATE-IP>:8000
ASR_API_KEY=<same as AI .env>
ASR_MAX_SESSIONS=2
CAPTION_TRANSLATION_PROVIDER=libretranslate
LIBRETRANSLATE_URL=http://<AI-PRIVATE-IP>:5000
LIBRETRANSLATE_API_KEY=<same as AI MT_API_KEY>
```
```sh
curl -s http://<AI-PRIVATE-IP>:8000/health      # from the backend: must answer {"ok":true}
docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env up -d signaling
```

## 6. Test
A signed-in person speaks Hindi with **Share my speech as captions** on; another chooses **English** captions.
Expect the Hindi line, then the English line a few seconds after each pause.

## Tuning
- Faster but less accurate: stage a reviewed multilingual base bundle at a separate path inside the model volume, set `ASR_MODEL` to that path, then recreate `asr`.
- More spoken languages: `ASR_LANGUAGES=en,hi,bn,ta,te,mr` (Whisper `small` is weak on these; prefer a GPU host).
- Fewer live updates (more CPU for final lines): raise `ASR_PARTIAL_INTERVAL_MS` (default 2500).
- `m7i-flex` instances can slow down under long sustained load; captions get slower, not wrong.

## Cost
The Free plan covers this instance type while your credits last (6 months or until credits run out). Stop the
instance when not testing; captions fall back to browser recognition while it is off. The private IP stays
the same across stop/start.
