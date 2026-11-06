# QS-VC speech recognition service (`services/asr`)

Live captions on your own servers. Browsers stream the meeting microphone (16 kHz PCM) to
signaling, which relays it over the private network to this service; results come back as
partial (live) and final captions. Works in Chrome, Edge, Firefox, Safari and the desktop app.
Audio is processed in memory and never written to disk.

## Run
```sh
docker compose --profile ai up -d asr           # first start downloads the Whisper model
# signaling: ASR_URL=http://asr:8000   (optional ASR_API_KEY on both sides)
```
Without Docker: `pip install -r requirements.txt && uvicorn app:app --port 8000`.

## Sizing (rule of thumb, verify on your hardware)
| Hardware | Model | Live speakers at once |
|---|---|---|
| NVIDIA T4 / A10 / L4 (16–24 GB) | `large-v3-turbo` float16 | ~8–20 |
| 8-core CPU | `small` int8 | ~1–2 |
Only people who are speaking with captions on use the service; listeners cost nothing.

## Settings
| Variable | Default | Meaning |
|---|---|---|
| `ASR_DEVICE` | cuda if found, else cpu | |
| `ASR_MODEL` | `large-v3-turbo` (GPU) / `small` (CPU) | Any faster-whisper model name or local path |
| `ASR_COMPUTE_TYPE` | float16 (GPU) / int8 (CPU) | |
| `ASR_LANGUAGES` | built-in list | Comma list offered to users, e.g. `hi,en,bn,ta,te,mr,ur` |
| `ASR_PROMPT` | none | Names/terms to bias recognition, e.g. `UPSWAN, UPDESCO, Lucknow` |
| `ASR_END_SILENCE_MS` | 600 | Pause that ends a caption line |
| `ASR_PARTIAL_INTERVAL_MS` | 700 | How often live text updates |
| `ASR_MAX_UTTERANCE_S` | 12 | Longest line before a forced cut |
| `ASR_VAD_THRESHOLD` | 0.012 | Raise in noisy rooms |
| `ASR_MAX_PARALLEL` | 2 | Concurrent model runs (finals always win over partials) |
| `ASR_API_KEY` | none | Require `Authorization: Bearer <key>` |

Air-gapped: download once (`python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', download_root='models')"`),
copy into the `asr-models` volume and set `HF_HUB_OFFLINE=1`.

Indian-language accuracy: Whisper is good for Hindi and English (incl. Hinglish) and usable
for several other Indian languages. For the best Bengali/Tamil/Telugu/Marathi etc. accuracy,
AI4Bharat IndicConformer is the next engine to add behind the same `Engine` interface in `app.py`.

Tests: `ASR_DISABLE_AUTOLOAD=1 pytest test_app.py` (uses a fake engine).
