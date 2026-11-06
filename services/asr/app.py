"""QS-VC speech recognition service (streaming).

    WS  /v1/stream?language=<code|auto>&sample_rate=16000
        in : binary frames, 16 kHz mono signed 16-bit little-endian PCM; text {"type":"stop"} flushes
        out: {"type":"ready"} then {"type":"partial"|"final", "segment": n, "text": "...", "language": "hi"}
    GET /v1/languages -> {"languages":[{code,name}], "autoDetect": true, "engine", "model"}
    GET /health

Engine: faster-whisper (CTranslate2). Default model large-v3-turbo on an NVIDIA GPU, "small" on CPU.
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


def allowed_languages() -> dict[str, str]:
    raw = os.environ.get("ASR_LANGUAGES", "").strip()
    if not raw:
        return LANGUAGE_NAMES
    wanted = [code.strip() for code in raw.split(",") if code.strip()]
    return {code: LANGUAGE_NAMES.get(code, code) for code in wanted}


def create_app(engine_factory: Optional[Callable[[], Engine]] = None) -> FastAPI:
    state: dict = {"engine": None}
    gpu = asyncio.Semaphore(int(os.environ.get("ASR_MAX_PARALLEL", "2")))
    api_key = os.environ.get("ASR_API_KEY", "").strip()
    prompt = os.environ.get("ASR_PROMPT", "").strip() or None  # e.g. names / terms to bias recognition

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        state["engine"] = await asyncio.get_running_loop().run_in_executor(None, engine_factory or WhisperEngine)
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
        return {"languages": [{"code": code, "name": name} for code, name in allowed_languages().items()], "autoDetect": True,
                "engine": getattr(engine, "name", None), "model": getattr(engine, "model", None)}

    @app.websocket("/v1/stream")
    async def stream(ws: WebSocket):
        if not authorised(ws.headers):
            await ws.close(code=4401)
            return
        requested = ws.query_params.get("language", "auto")
        language = None if requested == "auto" else requested.split("-")[0]
        if language is not None and language not in allowed_languages():
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
                text, lang = await loop.run_in_executor(None, engine.transcribe, audio, language, final, prompt)
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
