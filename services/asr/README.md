# QS-VC speech recognition service (`services/asr`)

Live captions on your own servers. Browsers stream the meeting microphone (16 kHz PCM) to
signaling, which relays it over the private network to this service; results come back as
partial (live) and final captions. Works in Chrome, Edge, Firefox, Safari and the desktop app.
Audio is processed in memory and never written to disk.

## Run
Production loading requires reviewed local model bundles and SHA-256 manifests.
See [security deployment steps](../../docs/SECURITY_REMEDIATION_2026-11.md#ai-models).
Remote model code is executable code: review it before creating a manifest.

```sh
docker compose --profile ai up -d asr           # requires reviewed local model bundles
# signaling: ASR_URL=http://asr:8000   (optional ASR_API_KEY on both sides)
```
Without Docker, run from the repository root: `python -m uvicorn services.asr.app:app --port 8000` after installing `services/asr/requirements.txt`.

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
| `ASR_LANGUAGES` | everything the loaded engines support | Comma list offered to users, e.g. `hi,en,bn,ta,te,mr,ur` |
| `ASR_PROMPT` | none | Names/terms to bias recognition, e.g. `UPSWAN, UPDESCO, Lucknow` |
| `ASR_END_SILENCE_MS` | 600 | Pause that ends a caption line |
| `ASR_PARTIAL_INTERVAL_MS` | 700 | How often live text updates |
| `ASR_MAX_UTTERANCE_S` | 12 | Longest line before a forced cut |
| `ASR_VAD_THRESHOLD` | 0.012 | Raise in noisy rooms |
| `ASR_MAX_PARALLEL` | 2 | Concurrent model runs (finals always win over partials) |
| `ASR_API_KEY` | none | Require `Authorization: Bearer <key>` |

Air-gapped: download once (`python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', download_root='models')"`),
copy into the `asr-models` volume and set `HF_HUB_OFFLINE=1`.

## Engines: Whisper + IndicConformer (hybrid, default)

`ASR_ENGINE=hybrid` loads both and routes every caption line to the better engine:

| Speaker language | Engine |
|---|---|
| English, Hindi / Hinglish, foreign languages | Whisper (`large-v3-turbo`) |
| Assamese, Bengali, Bodo, Dogri, Gujarati, Kannada, Kashmiri, Konkani, Maithili, Malayalam, Manipuri, Marathi, Nepali, Odia, Punjabi, Sanskrit, Santali, Sindhi, Tamil, Telugu, Urdu | AI4Bharat IndicConformer 600M (MIT) |
| "Detect automatically" | Whisper detects the language; a confident Indian language goes to IndicConformer |

Live text uses IndicConformer's fast CTC decoder; finished lines use RNNT (more accurate).

**One-time setup for IndicConformer** (the model is gated on Hugging Face):
1. Sign in at huggingface.co, open `ai4bharat/indic-conformer-600m-multilingual` and accept the terms.
2. Create a read token (Settings → Access Tokens) and set `HF_TOKEN=hf_...` for the `asr` service.
3. Restart `asr`. Its log says `IndicConformer unavailable, using Whisper only: …` if access is missing —
   captions keep working on Whisper meanwhile.

Air-gapped: download once on a connected machine (`huggingface-cli download ai4bharat/indic-conformer-600m-multilingual --local-dir indic-conformer`),
copy the folder into the `asr-models` volume and set `ASR_INDIC_MODEL=/models/indic-conformer`, `HF_HUB_OFFLINE=1`.

| Variable | Default | Meaning |
|---|---|---|
| `ASR_ENGINE` | `hybrid` | `hybrid`, `whisper`, or `indicconformer` (Indian languages only, no English) |
| `ASR_INDIC_LANGUAGES` | all 22 except `hi` | Languages sent to IndicConformer. Add `hi` for meetings in pure Hindi |
| `ASR_INDIC_MODEL` | `ai4bharat/indic-conformer-600m-multilingual` | Model id or local folder |
| `ASR_INDIC_FINAL_DECODER` / `ASR_INDIC_PARTIAL_DECODER` | `rnnt` / `ctc` | |
| `ASR_DETECT_MIN_CONFIDENCE` | 0.5 | Auto-detect confidence needed to switch to IndicConformer |
| `HF_TOKEN` | none | Hugging Face read token (gated model) |

Memory: Whisper turbo + IndicConformer fit together on one 16–24 GB GPU. On CPU both run but slowly.

Tests: `ASR_DISABLE_AUTOLOAD=1 pytest test_app.py` (uses a fake engine).
