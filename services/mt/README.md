# QS-VC translation service (`services/mt`)

Self-hosted IndicTrans2 (AI4Bharat, MIT) with a LibreTranslate-compatible API, so the
signaling server uses it through the existing `LIBRETRANSLATE_URL` setting. English + all
22 scheduled Indian languages; Indic↔Indic pivots through English unless the optional
indic-indic model is set. Caption text never leaves your network.

## Run
```sh
docker compose --profile ai up -d mt          # first start downloads ~2 GB of models into the mt-models volume
# signaling: LIBRETRANSLATE_URL=http://mt:5000   (optional MT_API_KEY on both sides → LIBRETRANSLATE_API_KEY)
```
Without Docker: `pip install -r requirements.txt && uvicorn app:app --port 5000`.

## Settings
| Variable | Default | Meaning |
|---|---|---|
| `MT_DEVICE` | cuda if available, else cpu | Torch device |
| `MT_MODEL_EN_INDIC` | `ai4bharat/indictrans2-en-indic-dist-200M` | Use `…-1B` on a GPU for best quality |
| `MT_MODEL_INDIC_EN` | `ai4bharat/indictrans2-indic-en-dist-200M` | Use `…-1B` on a GPU |
| `MT_MODEL_INDIC_INDIC` | empty (pivot via English) | `ai4bharat/indictrans2-indic-indic-dist-320M` |
| `MT_LANGUAGES` | all | Comma list to offer, e.g. `hi,bn,ta,te,mr,ur` |
| `MT_GLOSSARY_FILE` | none | JSON: `keep` terms never translated, `fix` output replacements per language |
| `MT_BEAMS` | 4 | Lower = faster, higher = better |
| `MT_MAX_PARALLEL` | 4 | Concurrent requests |
| `MT_API_KEY` | none | Require this key |

For an air-gapped install, download the models once on a connected machine
(`huggingface-cli download ai4bharat/indictrans2-en-indic-dist-200M`), copy the HF cache into
the `mt-models` volume and set `HF_HUB_OFFLINE=1`.

Tests: `MT_DISABLE_AUTOLOAD=1 pytest test_app.py` (uses a fake model).
