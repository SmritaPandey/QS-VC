"""QS-VC speech recognition service (streaming).

    WS  /v1/stream?language=<code|auto>&sample_rate=16000
        in : binary frames, 16 kHz mono signed 16-bit little-endian PCM; text {"type":"stop"} flushes
        out: {"type":"ready"} then {"type":"partial"|"final", "segment": n, "text": "...", "language": "hi"}
    GET /v1/languages -> {"languages":[{code,name}], "autoDetect": true, "engine", "model"}
    GET /health

Engines (ASR_ENGINE):
  hybrid (default)  Whisper for English, Hindi/Hinglish and other languages; AI4Bharat IndicConformer
                    for the other scheduled Indian languages (ASR_INDIC_LANGUAGES). If IndicConformer
                    cannot load (e.g. no Hugging Face access yet), it runs Whisper-only and says so.
  whisper           faster-whisper only (large-v3-turbo on GPU, "small" on CPU).
  indicconformer    IndicConformer only (22 Indian languages, no English).
Utterances are cut by an energy voice-activity detector; partial hypotheses are produced while
someone speaks, a final one after a short pause. Audio is processed in memory and never stored.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

RATE = 16_000
FRAME = 480  # 30 ms

# Whisper languages most relevant here (code -> name). ASR_LANGUAGES narrows the list.
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "gu": "Gujarati",
    "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu", "ne": "Nepali", "as": "Assamese", "or": "Odia",
    "sa": "Sanskrit", "sd": "Sindhi", "ar": "Arabic", "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "fr": "French",
    "de": "German", "es": "Spanish", "pt": "Portuguese", "ru": "Russian", "it": "Italian", "id": "Indonesian", "th": "Thai",
    "vi": "Vietnamese", "tr": "Turkish", "fa": "Persian", "ms": "Malay", "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian",
}
# AI4Bharat IndicConformer (ai4bharat/indic-conformer-600m-multilingual): 22 scheduled languages.
INDIC_NAMES = {
    "as": "Assamese", "bn": "Bengali", "brx": "Bodo", "doi": "Dogri", "gu": "Gujarati", "hi": "Hindi", "kn": "Kannada",
    "kok": "Konkani", "ks": "Kashmiri", "mai": "Maithili", "ml": "Malayalam", "mni": "Manipuri", "mr": "Marathi",
    "ne": "Nepali", "or": "Odia", "pa": "Punjabi", "sa": "Sanskrit", "sat": "Santali", "sd": "Sindhi", "ta": "Tamil",
    "te": "Telugu", "ur": "Urdu",
}
# Hindi stays on Whisper by default because meetings mix Hindi and English (Hinglish); add "hi" for pure Hindi.
DEFAULT_INDIC_ROUTE = ",".join(code for code in INDIC_NAMES if code != "hi")
CODE_ALIASES = {"bo": "brx", "gom": "kok", "mni-mtei": "mni", "np": "ne", "od": "or"}
# Common Whisper hallucinations on silence / noise.
HALLUCINATIONS = re.compile(r"^(thank you( for watching)?|thanks for watching|subtitles? by.*|please subscribe.*|you|\.+|ॐ|धन्यवाद।?)$", re.IGNORECASE)


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class Engine(Protocol):
    name: str
    model: str

    def transcribe(self, audio: np.ndarray, language: Optional[str], final: bool, prompt: Optional[str]) -> tuple[str, Optional[str]]: ...


class WhisperEngine:
    name = "faster-whisper"

    def __init__(self) -> None:
        from faster_whisper import WhisperModel

        device = os.environ.get("ASR_DEVICE") or ("cuda" if _cuda_available() else "cpu")
        self.model = os.environ.get("ASR_MODEL") or ("large-v3-turbo" if device == "cuda" else "small")
        compute = os.environ.get("ASR_COMPUTE_TYPE") or ("float16" if device == "cuda" else "int8")
        self.whisper = WhisperModel(self.model, device=device, compute_type=compute, download_root=os.environ.get("ASR_MODEL_DIR") or None,
                                    cpu_threads=int(os.environ.get("ASR_CPU_THREADS", "0")) or 0)
        self.beam_final = int(os.environ.get("ASR_BEAM_SIZE", "5"))

    def transcribe(self, audio, language, final, prompt):
        segments, info = self.whisper.transcribe(
            audio, language=language, task="transcribe",
            beam_size=self.beam_final if final else 1,
            vad_filter=False, condition_on_previous_text=False, without_timestamps=True,
            initial_prompt=prompt or None, temperature=0.0 if not final else (0.0, 0.2, 0.4),
        )
        kept = []
        for segment in segments:
            if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0:
                continue
            kept.append(segment.text)
        text = " ".join(part.strip() for part in kept).strip()
        return text, getattr(info, "language", None)


    def detect(self, audio) -> tuple[Optional[str], float]:
        try:
            language, probability, _all = self.whisper.detect_language(audio)
            return language, float(probability)
        except Exception:
            return None, 0.0

    def languages(self) -> dict[str, str]:
        return dict(LANGUAGE_NAMES)


class IndicConformerEngine:
    """AI4Bharat IndicConformer 600M multilingual (hybrid CTC + RNNT, MIT licence).

    Gated on Hugging Face: accept the terms on the model page once and set HF_TOKEN (or copy the
    downloaded files into ASR_INDIC_MODEL as a local path for air-gapped servers).
    Partials use fast CTC decoding; finals use RNNT (ASR_INDIC_FINAL_DECODER).
    """

    name = "indicconformer"

    def __init__(self) -> None:
        import torch
        from transformers import AutoModel

        self.torch = torch
        self.model = os.environ.get("ASR_INDIC_MODEL", "ai4bharat/indic-conformer-600m-multilingual")
        self.net = AutoModel.from_pretrained(self.model, trust_remote_code=True, token=os.environ.get("HF_TOKEN") or None)
        device = os.environ.get("ASR_INDIC_DEVICE")
        if device and hasattr(self.net, "to"):
            try:
                self.net = self.net.to(device)
            except Exception:
                pass  # ONNX-backed remote code may manage its own device
        self.final_decoder = os.environ.get("ASR_INDIC_FINAL_DECODER", "rnnt")
        self.partial_decoder = os.environ.get("ASR_INDIC_PARTIAL_DECODER", "ctc")

    def transcribe(self, audio, language, final, prompt):
        if not language or language not in INDIC_NAMES:
            raise ValueError("IndicConformer needs one of its 22 language codes")
        wav = self.torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)  # [1, samples] at 16 kHz
        with self.torch.inference_mode():
            result = self.net(wav, language, self.final_decoder if final else self.partial_decoder)
        if isinstance(result, (list, tuple)):
            result = result[0] if result else ""
        return str(result or "").strip(), language

    def languages(self) -> dict[str, str]:
        return dict(INDIC_NAMES)


class HybridEngine:
    """Routes each utterance to the better engine for its language.

    - language given and in the Indic route list  -> IndicConformer
    - language given otherwise                    -> Whisper
    - auto: Whisper detects the language; if it is in the Indic route list with enough confidence,
      IndicConformer transcribes, else Whisper does.
    """

    def __init__(self, whisper: Optional[object], indic: Optional[object], indic_route: set[str], min_confidence: float = 0.5):
        if whisper is None and indic is None:
            raise RuntimeError("No speech engine could be loaded")
        self.whisper, self.indic, self.route = whisper, indic, (indic_route if indic is not None else set())
        self.min_confidence = min_confidence
        parts = [engine for engine in (whisper, indic) if engine is not None]
        self.name = "+".join(getattr(engine, "name", "?") for engine in parts)
        self.model = " + ".join(str(getattr(engine, "model", "?")) for engine in parts)

    def pick(self, audio, language: Optional[str]) -> tuple[object, Optional[str]]:
        if language:
            if language in self.route or self.whisper is None:
                return self.indic, language
            return self.whisper, language
        if self.whisper is None:
            raise ValueError("Automatic language detection needs Whisper; choose a language")
        detected, confidence = self.whisper.detect(audio)  # type: ignore[attr-defined]
        if detected in self.route and confidence >= self.min_confidence:
            return self.indic, detected
        return self.whisper, None

    def transcribe(self, audio, language, final, prompt):
        engine, use = self.pick(audio, language)
        text, detected = engine.transcribe(audio, use, final, prompt)  # type: ignore[attr-defined]
        return text, detected or use

    def languages(self) -> dict[str, str]:
        names: dict[str, str] = {}
        if self.whisper is not None:
            names.update(self.whisper.languages())  # type: ignore[attr-defined]
        if self.indic is not None:
            names.update(self.indic.languages())  # type: ignore[attr-defined]
        return names

    def engine_for(self, code: str) -> str:
        if code in self.route or self.whisper is None:
            return getattr(self.indic, "name", "indicconformer")
        return getattr(self.whisper, "name", "faster-whisper")


def normalise_language(code: str) -> str:
    code = code.strip().lower()
    return CODE_ALIASES.get(code, CODE_ALIASES.get(code.split("-")[0], code.split("-")[0]))


def build_engine(whisper_factory: Callable[[], object] = lambda: WhisperEngine(),
                 indic_factory: Callable[[], object] = lambda: IndicConformerEngine(), log=print) -> HybridEngine:
    """Build the engine named by ASR_ENGINE. Hybrid degrades to Whisper-only if IndicConformer fails."""
    mode = (os.environ.get("ASR_ENGINE") or "hybrid").strip().lower()
    route = {normalise_language(code) for code in (os.environ.get("ASR_INDIC_LANGUAGES") or DEFAULT_INDIC_ROUTE).split(",") if code.strip()}
    route &= set(INDIC_NAMES)
    whisper = indic = None
    if mode in ("hybrid", "whisper"):
        whisper = whisper_factory()
    if mode in ("hybrid", "indicconformer"):
        try:
            indic = indic_factory()
        except Exception as error:  # gated model without token, missing packages, no network…
            if mode == "indicconformer":
                raise
            log(f"IndicConformer unavailable, using Whisper only: {type(error).__name__}: {error}")
    if mode == "indicconformer":
        route = set(INDIC_NAMES)
    if mode not in ("hybrid", "whisper", "indicconformer"):
        raise ValueError(f"Unknown ASR_ENGINE {mode!r}")
    return HybridEngine(whisper, indic, route, env_float("ASR_DETECT_MIN_CONFIDENCE", 0.5))


def _cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


@dataclass
class Segmenter:
    """Energy VAD with an adaptive noise floor. Feed 16 kHz float32; returns events."""

    end_silence_ms: float = 600
    max_utterance_s: float = 12
    min_speech_ms: float = 250
    partial_every_ms: float = 700
    threshold: float = 0.012
    noise: float = 0.003
    buffer: list = field(default_factory=list)
    speech_ms: float = 0
    silence_ms: float = 0
    in_speech: bool = False
    since_partial_ms: float = 0
    leftover: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    preroll: list = field(default_factory=list)

    def feed(self, samples: np.ndarray) -> list[tuple[str, np.ndarray]]:
        events: list[tuple[str, np.ndarray]] = []
        data = np.concatenate([self.leftover, samples]) if self.leftover.size else samples
        frames = len(data) // FRAME
        self.leftover = data[frames * FRAME:]
        for index in range(frames):
            frame = data[index * FRAME:(index + 1) * FRAME]
            rms = float(np.sqrt(np.mean(frame * frame)) + 1e-9)
            voiced = rms > max(self.threshold, self.noise * 3.0)
            if not voiced:
                self.noise = 0.95 * self.noise + 0.05 * rms
            if not self.in_speech:
                self.preroll = (self.preroll + [frame])[-10:]  # keep 300 ms before speech starts
                if voiced:
                    self.in_speech = True
                    self.buffer = list(self.preroll)
                    self.speech_ms = 30
                    self.silence_ms = 0
                    self.since_partial_ms = 0
                continue
            self.buffer.append(frame)
            self.since_partial_ms += 30
            if voiced:
                self.speech_ms += 30
                self.silence_ms = 0
            else:
                self.silence_ms += 30
            length_s = len(self.buffer) * FRAME / RATE
            if self.silence_ms >= self.end_silence_ms or length_s >= self.max_utterance_s:
                audio = np.concatenate(self.buffer)
                if self.speech_ms >= self.min_speech_ms:
                    events.append(("final", audio))
                self._reset()
            elif self.since_partial_ms >= self.partial_every_ms and self.speech_ms >= 500:
                self.since_partial_ms = 0
                events.append(("partial", np.concatenate(self.buffer)))
        return events

    def flush(self) -> Optional[np.ndarray]:
        if self.in_speech and self.speech_ms >= self.min_speech_ms:
            audio = np.concatenate(self.buffer)
            self._reset()
            return audio
        self._reset()
        return None

    def _reset(self) -> None:
        self.buffer, self.in_speech, self.speech_ms, self.silence_ms, self.since_partial_ms, self.preroll = [], False, 0, 0, 0, []


def clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return "" if HALLUCINATIONS.match(text) else text


def allowed_languages(engine: Optional[object] = None) -> dict[str, str]:
    available = engine.languages() if engine is not None and hasattr(engine, "languages") else dict(LANGUAGE_NAMES)
    raw = os.environ.get("ASR_LANGUAGES", "").strip()
    if not raw:
        return available
    wanted = [normalise_language(code) for code in raw.split(",") if code.strip()]
    return {code: available[code] for code in wanted if code in available}


def create_app(engine_factory: Optional[Callable[[], Engine]] = None) -> FastAPI:
    state: dict = {"engine": None}
    gpu = asyncio.Semaphore(int(os.environ.get("ASR_MAX_PARALLEL", "2")))
    api_key = os.environ.get("ASR_API_KEY", "").strip()
    prompt = os.environ.get("ASR_PROMPT", "").strip() or None  # e.g. names / terms to bias recognition

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        state["engine"] = await asyncio.get_running_loop().run_in_executor(None, engine_factory or build_engine)
        yield

    app = FastAPI(title="QS-VC speech", docs_url=None, redoc_url=None, lifespan=lifespan)

    def authorised(headers) -> bool:
        return not api_key or headers.get("authorization") == f"Bearer {api_key}"

    @app.get("/health")
    async def health():
        return {"ok": state["engine"] is not None}

    @app.get("/v1/languages")
    async def languages():
        engine = state["engine"]
        route = getattr(engine, "engine_for", None)
        auto = getattr(engine, "whisper", True) is not None
        return {"languages": [{"code": code, "name": name, **({"engine": route(code)} if route else {})} for code, name in allowed_languages(engine).items()],
                "autoDetect": auto, "engine": getattr(engine, "name", None), "model": getattr(engine, "model", None)}

    @app.websocket("/v1/stream")
    async def stream(ws: WebSocket):
        if not authorised(ws.headers):
            await ws.close(code=4401)
            return
        requested = ws.query_params.get("language", "auto")
        language = None if requested == "auto" else normalise_language(requested)
        if language is not None and language not in allowed_languages(state["engine"]):
            await ws.close(code=4400)
            return
        if ws.query_params.get("sample_rate", str(RATE)) != str(RATE):
            await ws.close(code=4400)
            return
        await ws.accept()
        await ws.send_text(json.dumps({"type": "ready"}))
        engine: Engine = state["engine"]
        segmenter = Segmenter(end_silence_ms=env_float("ASR_END_SILENCE_MS", 600), max_utterance_s=env_float("ASR_MAX_UTTERANCE_S", 12),
                              partial_every_ms=env_float("ASR_PARTIAL_INTERVAL_MS", 700), threshold=env_float("ASR_VAD_THRESHOLD", 0.012))
        loop = asyncio.get_running_loop()
        segment = 0
        partial_task: Optional[asyncio.Task] = None
        detected: Optional[str] = None
        send_lock = asyncio.Lock()

        async def send(message: dict):
            async with send_lock:
                await ws.send_text(json.dumps(message, ensure_ascii=False))

        async def run(audio: np.ndarray, final: bool, number: int):
            nonlocal detected
            if not final and gpu.locked():
                return  # never let partials delay finals
            async with gpu:
                started = time.perf_counter()
                use = language or (detected if not final else None)
                text, lang = await loop.run_in_executor(None, engine.transcribe, audio, use, final, prompt)
            text = clean(text)
            lang = language or lang or detected or "en"
            if final:
                detected = lang
            if text:
                await send({"type": "final" if final else "partial", "segment": number, "text": text, "language": lang,
                            "ms": round((time.perf_counter() - started) * 1000)})

        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    raw = message["bytes"]
                    if len(raw) % 2 or len(raw) > 64_000:
                        continue
                    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                    for kind, audio in segmenter.feed(samples):
                        if kind == "final":
                            number = segment
                            segment += 1
                            if partial_task and not partial_task.done():
                                partial_task.cancel()
                            await run(audio, True, number)
                        elif partial_task is None or partial_task.done():
                            partial_task = asyncio.create_task(run(audio, False, segment))
                elif message.get("text"):
                    try:
                        command = json.loads(message["text"])
                    except ValueError:
                        continue
                    if command.get("type") == "stop":
                        audio = segmenter.flush()
                        if audio is not None:
                            await run(audio, True, segment)
                            segment += 1
                        await ws.close()
                        break
        except WebSocketDisconnect:
            pass
        except Exception:
            try:
                await send({"type": "error", "message": "recognition failed"})
            except Exception:
                pass
        finally:
            if partial_task and not partial_task.done():
                partial_task.cancel()

    return app


app = create_app() if os.environ.get("ASR_DISABLE_AUTOLOAD") != "1" else None
