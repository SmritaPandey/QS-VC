"""QS-VC translation service (IndicTrans2).

LibreTranslate-compatible API so the signaling server needs no code change:
    GET  /languages            -> [{code, name, targets}]
    POST /translate {q, source, target, format?, api_key?} -> {translatedText}
    GET  /health

Models (AI4Bharat IndicTrans2, MIT licence), downloaded once into MT_MODEL_DIR / HF cache:
    en -> 22 Indic : ai4bharat/indictrans2-en-indic-dist-200M   (or -1B for best quality on GPU)
    Indic -> en    : ai4bharat/indictrans2-indic-en-dist-200M   (or -1B)
    Indic -> Indic : ai4bharat/indictrans2-indic-indic-dist-320M (optional; otherwise pivots via English)

Runs on CPU (slower) or an NVIDIA GPU. Nothing leaves the server.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from collections import OrderedDict
from typing import Callable, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ISO 639 code -> (FLORES-200 code used by IndicTrans2, English name)
LANGUAGES: dict[str, tuple[str, str]] = {
    "en": ("eng_Latn", "English"),
    "as": ("asm_Beng", "Assamese"),
    "bn": ("ben_Beng", "Bengali"),
    "brx": ("brx_Deva", "Bodo"),
    "doi": ("doi_Deva", "Dogri"),
    "gu": ("guj_Gujr", "Gujarati"),
    "hi": ("hin_Deva", "Hindi"),
    "kn": ("kan_Knda", "Kannada"),
    "ks": ("kas_Arab", "Kashmiri"),
    "kok": ("gom_Deva", "Konkani"),
    "mai": ("mai_Deva", "Maithili"),
    "ml": ("mal_Mlym", "Malayalam"),
    "mni": ("mni_Mtei", "Manipuri"),
    "mr": ("mar_Deva", "Marathi"),
    "ne": ("npi_Deva", "Nepali"),
    "or": ("ory_Orya", "Odia"),
    "pa": ("pan_Guru", "Punjabi"),
    "sa": ("san_Deva", "Sanskrit"),
    "sat": ("sat_Olck", "Santali"),
    "sd": ("snd_Arab", "Sindhi"),
    "ta": ("tam_Taml", "Tamil"),
    "te": ("tel_Telu", "Telugu"),
    "ur": ("urd_Arab", "Urdu"),
}
ALIASES = {"bo": "brx", "gom": "kok", "np": "ne", "od": "or"}


def env_list(name: str) -> Optional[set[str]]:
    raw = os.environ.get(name, "").strip()
    return {item.strip() for item in raw.split(",") if item.strip()} if raw else None


def normalise(code: str) -> str:
    base = code.split("-")[0].lower()
    return ALIASES.get(base, base)


class Glossary:
    """Operator terms. JSON file:
    {"keep": ["UPSWAN", "QS-VC"],                     # never translate these
     "fix":  {"hi": {"यूपीएसडब्ल्यूएएन": "UPSWAN"}}}    # replace in output for a language
    """

    def __init__(self, path: Optional[str]):
        self.keep: list[str] = []
        self.fix: dict[str, dict[str, str]] = {}
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            self.keep = sorted({str(term) for term in data.get("keep", []) if str(term).strip()}, key=len, reverse=True)[:500]
            self.fix = {normalise(lang): {str(a): str(b) for a, b in pairs.items()} for lang, pairs in data.get("fix", {}).items()}

    def protect(self, text: str) -> tuple[str, list[str]]:
        found: list[str] = []
        for term in self.keep:
            pattern = re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE)
            if pattern.search(text):
                index = len(found)
                found.append(term)
                text = pattern.sub(f"[{index}]", text)
        return text, found

    def restore(self, text: str, found: list[str], target: str) -> Optional[str]:
        for index, term in enumerate(found):
            token = f"[{index}]"
            if token not in text:
                return None  # model dropped the placeholder: caller retries without protection
            text = text.replace(token, term)
        for wrong, right in self.fix.get(target, {}).items():
            text = text.replace(wrong, right)
        return text


class IndicTrans2Backend:
    """Loads IndicTrans2 lazily per direction. translate_batch(texts, src_iso, tgt_iso) -> list[str]."""

    def __init__(self) -> None:
        import torch  # noqa: F401  (imported here so tests can run without torch)

        self.device = os.environ.get("MT_DEVICE") or ("cuda" if __import__("torch").cuda.is_available() else "cpu")
        self.models = {
            "en-indic": os.environ.get("MT_MODEL_EN_INDIC", "ai4bharat/indictrans2-en-indic-dist-200M"),
            "indic-en": os.environ.get("MT_MODEL_INDIC_EN", "ai4bharat/indictrans2-indic-en-dist-200M"),
            "indic-indic": os.environ.get("MT_MODEL_INDIC_INDIC", ""),  # optional
        }
        self.loaded: dict[str, tuple[object, object]] = {}
        self.lock = threading.Lock()
        try:
            from IndicTransToolkit.processor import IndicProcessor
        except ImportError:  # older toolkit layout
            from IndicTransToolkit import IndicProcessor

        self.processor = IndicProcessor(inference=True)
        for direction in os.environ.get("MT_PRELOAD", "en-indic,indic-en").split(","):
            if direction.strip() and self.models.get(direction.strip()):
                self._load(direction.strip())

    def _load(self, direction: str):
        if direction in self.loaded:
            return self.loaded[direction]
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        import torch

        name = self.models[direction]
        tokenizer = AutoTokenizer.from_pretrained(name, trust_remote_code=True)
        dtype = torch.float16 if self.device.startswith("cuda") else torch.float32
        model = AutoModelForSeq2SeqLM.from_pretrained(name, trust_remote_code=True, torch_dtype=dtype).to(self.device).eval()
        self.loaded[direction] = (tokenizer, model)
        return self.loaded[direction]

    def _run(self, direction: str, texts: list[str], src: str, tgt: str) -> list[str]:
        import torch

        tokenizer, model = self._load(direction)
        src_code, tgt_code = LANGUAGES[src][0], LANGUAGES[tgt][0]
        batch = self.processor.preprocess_batch(texts, src_lang=src_code, tgt_lang=tgt_code)
        inputs = tokenizer(batch, truncation=True, padding="longest", max_length=256, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            generated = model.generate(**inputs, use_cache=True, min_length=0, max_length=256, num_beams=int(os.environ.get("MT_BEAMS", "4")), num_return_sequences=1)
        decoded = tokenizer.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=True)
        return self.processor.postprocess_batch(decoded, lang=tgt_code)

    def translate_batch(self, texts: list[str], src: str, tgt: str) -> list[str]:
        with self.lock:
            if src == "en":
                return self._run("en-indic", texts, src, tgt)
            if tgt == "en":
                return self._run("indic-en", texts, src, tgt)
            if self.models.get("indic-indic"):
                return self._run("indic-indic", texts, src, tgt)
            english = self._run("indic-en", texts, src, "en")  # pivot via English
            return self._run("en-indic", english, "en", tgt)


class Translator:
    """Caching + glossary wrapper around a backend (one shared model, parallel requests bounded by MT_MAX_PARALLEL)."""

    def __init__(self, backend_factory: Callable[[], object], glossary: Glossary, cache_size: int = 5000):
        self.backend_factory = backend_factory
        self.backend: Optional[object] = None
        self.glossary = glossary
        self.cache: OrderedDict[tuple[str, str, str], str] = OrderedDict()
        self.cache_size = cache_size
        self.ready = False

    def load(self) -> None:
        self.backend = self.backend_factory()
        self.ready = True

    def _cached(self, key: tuple[str, str, str]) -> Optional[str]:
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def translate(self, text: str, src: str, tgt: str) -> str:
        if src == tgt:
            return text
        key = (src, tgt, text)
        cached = self._cached(key)
        if cached is not None:
            return cached
        assert self.backend is not None
        protected, found = self.glossary.protect(text)
        output = self.backend.translate_batch([protected], src, tgt)[0]  # type: ignore[attr-defined]
        result = self.glossary.restore(output, found, tgt) if found else self.glossary.restore(output, [], tgt)
        if result is None:
            result = self.glossary.restore(self.backend.translate_batch([text], src, tgt)[0], [], tgt) or text  # type: ignore[attr-defined]
        self.cache[key] = result
        if len(self.cache) > self.cache_size:
            self.cache.popitem(last=False)
        return result


class TranslateBody(BaseModel):
    q: str = Field(min_length=1, max_length=2000)
    source: str = Field(min_length=2, max_length=12)
    target: str = Field(min_length=2, max_length=12)
    format: str = "text"
    api_key: Optional[str] = None


def supported_codes() -> list[str]:
    allowed = env_list("MT_LANGUAGES")
    return [code for code in LANGUAGES if allowed is None or code in allowed or code == "en"]


def create_app(backend_factory: Optional[Callable[[], object]] = None) -> FastAPI:
    glossary = Glossary(os.environ.get("MT_GLOSSARY_FILE"))
    translator = Translator(backend_factory or IndicTrans2Backend, glossary, int(os.environ.get("MT_CACHE_SIZE", "5000")))
    api_key = os.environ.get("MT_API_KEY", "").strip()
    semaphore = asyncio.Semaphore(int(os.environ.get("MT_MAX_PARALLEL", "4")))

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await asyncio.get_running_loop().run_in_executor(None, translator.load)
        yield

    app = FastAPI(title="QS-VC translation", docs_url=None, redoc_url=None, lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"ok": translator.ready}

    @app.get("/languages")
    async def languages():
        codes = supported_codes()
        return [{"code": code, "name": LANGUAGES[code][1], "targets": [other for other in codes if other != code]} for code in codes]

    @app.post("/translate")
    async def translate(body: TranslateBody, request: Request):
        if api_key and body.api_key != api_key and request.headers.get("authorization") != f"Bearer {api_key}":
            raise HTTPException(status_code=403, detail="Invalid API key")
        if not translator.ready:
            raise HTTPException(status_code=503, detail="Model is loading")
        codes = supported_codes()
        src, tgt = normalise(body.source), normalise(body.target)
        if src not in codes or tgt not in codes:
            raise HTTPException(status_code=400, detail="Language pair not supported")
        started = time.perf_counter()
        async with semaphore:
            text = await asyncio.get_running_loop().run_in_executor(None, translator.translate, body.q, src, tgt)
        return JSONResponse({"translatedText": text}, headers={"Server-Timing": f"mt;dur={(time.perf_counter() - started) * 1000:.0f}"})

    return app


app = create_app() if os.environ.get("MT_DISABLE_AUTOLOAD") != "1" else None
