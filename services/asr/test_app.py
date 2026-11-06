import json
import os

os.environ["ASR_DISABLE_AUTOLOAD"] = "1"

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app as asr  # noqa: E402


def tone(seconds, amplitude=0.2, rate=16_000):
    t = np.arange(int(seconds * rate)) / rate
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds, rate=16_000):
    return np.zeros(int(seconds * rate), dtype=np.float32)


def pcm(samples):
    return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()


class FakeEngine:
    name = "fake"
    model = "test"

    def __init__(self):
        self.calls = []

    def transcribe(self, audio, language, final, prompt):
        self.calls.append((round(len(audio) / 16_000, 2), language, final))
        return ("नमस्ते सबको" if final else "नमस्ते"), (language or "hi")


def test_segmenter_cuts_utterances_on_silence_and_emits_partials():
    segmenter = asr.Segmenter(end_silence_ms=600, partial_every_ms=700)
    events = segmenter.feed(np.concatenate([silence(0.5), tone(2.0), silence(0.8)]))
    kinds = [kind for kind, _ in events]
    assert kinds.count("final") == 1
    assert "partial" in kinds and kinds.index("partial") < kinds.index("final")
    final_audio = dict((kind, audio) for kind, audio in events)["final"]
    assert 2.0 <= len(final_audio) / 16_000 <= 3.0  # speech + pre-roll + trailing pause


def test_segmenter_ignores_short_clicks_and_caps_long_speech():
    segmenter = asr.Segmenter(max_utterance_s=5)
    assert [kind for kind, _ in segmenter.feed(np.concatenate([tone(0.1), silence(1.0)]))] == []
    events = segmenter.feed(tone(11))
    assert [kind for kind, _ in events].count("final") == 2


def test_hallucination_filter():
    assert asr.clean("  Thank you for watching ") == ""
    assert asr.clean("बैठक  कल है") == "बैठक कल है"


def test_websocket_stream_end_to_end_with_fake_engine():
    engine = FakeEngine()
    with TestClient(asr.create_app(lambda: engine)) as client:
        langs = client.get("/v1/languages").json()
        assert {"code": "hi", "name": "Hindi"} in langs["languages"] and langs["engine"] == "fake"
        with client.websocket_connect("/v1/stream?language=hi&sample_rate=16000") as ws:
            assert json.loads(ws.receive_text()) == {"type": "ready"}
            audio = np.concatenate([silence(0.3), tone(1.5), silence(0.9)])
            for start in range(0, len(audio), 4000):
                ws.send_bytes(pcm(audio[start:start + 4000]))
            messages = []
            while True:
                message = json.loads(ws.receive_text())
                messages.append(message)
                if message["type"] == "final":
                    break
            final = messages[-1]
            assert final["text"] == "नमस्ते सबको" and final["language"] == "hi" and final["segment"] == 0
            ws.send_text(json.dumps({"type": "stop"}))
        assert any(call[2] for call in engine.calls) and all(call[1] == "hi" for call in engine.calls)


def test_rejects_unknown_language_and_bad_key():
    os.environ["ASR_API_KEY"] = "secret"
    try:
        with TestClient(asr.create_app(lambda: FakeEngine())) as client:
            try:
                with client.websocket_connect("/v1/stream?language=hi") as ws:
                    ws.receive_text()
                raise AssertionError("connection without key accepted")
            except Exception as error:  # starlette raises WebSocketDisconnect
                assert "4401" in repr(error) or "WebSocketDisconnect" in type(error).__name__
            with client.websocket_connect("/v1/stream?language=hi", headers={"Authorization": "Bearer secret"}) as ws:
                assert json.loads(ws.receive_text())["type"] == "ready"
    finally:
        os.environ.pop("ASR_API_KEY", None)


class FakeWhisper:
    name, model = "faster-whisper", "large-v3-turbo"

    def __init__(self, detected="ta", confidence=0.9):
        self.detected, self.confidence, self.calls = detected, confidence, []

    def detect(self, audio):
        return self.detected, self.confidence

    def transcribe(self, audio, language, final, prompt):
        self.calls.append((language, final))
        return "whisper text", language or self.detected

    def languages(self):
        return dict(asr.LANGUAGE_NAMES)


class FakeIndic:
    name, model = "indicconformer", "indic-conformer-600m"

    def __init__(self):
        self.calls = []

    def transcribe(self, audio, language, final, prompt):
        self.calls.append((language, final))
        return "இன்று கூட்டம்", language

    def languages(self):
        return dict(asr.INDIC_NAMES)


def build(mode="hybrid", indic_fails=False, **env):
    os.environ["ASR_ENGINE"] = mode
    for key, value in env.items():
        os.environ[key] = value
    whisper, indic = FakeWhisper(), FakeIndic()
    def indic_factory():
        if indic_fails:
            raise PermissionError("gated repo: accept terms and set HF_TOKEN")
        return indic
    logs = []
    try:
        engine = asr.build_engine(lambda: whisper, indic_factory, logs.append)
    finally:
        for key in ["ASR_ENGINE", *env]:
            os.environ.pop(key, None)
    return engine, whisper, indic, logs


def test_hybrid_routes_tamil_to_indicconformer_and_hindi_english_to_whisper():
    engine, whisper, indic, _ = build()
    audio = np.zeros(16000, dtype=np.float32)
    assert engine.transcribe(audio, "ta", True, None) == ("இன்று கூட்டம்", "ta")
    engine.transcribe(audio, "hi", True, None)   # Hinglish-friendly default
    engine.transcribe(audio, "en", False, None)
    assert indic.calls == [("ta", True)]
    assert whisper.calls == [("hi", True), ("en", False)]
    assert engine.engine_for("bn") == "indicconformer" and engine.engine_for("hi") == "faster-whisper"
    assert "sat" in engine.languages() and "en" in engine.languages()


def test_hybrid_auto_detect_sends_confident_indic_language_to_indicconformer():
    engine, whisper, indic, _ = build()
    audio = np.zeros(16000, dtype=np.float32)
    assert engine.transcribe(audio, None, True, None) == ("இன்று கூட்டம்", "ta")
    whisper.confidence = 0.2  # unsure -> Whisper decides
    engine.transcribe(audio, None, True, None)
    assert indic.calls == [("ta", True)] and whisper.calls == [(None, True)]


def test_hybrid_falls_back_to_whisper_when_indicconformer_cannot_load():
    engine, whisper, _indic, logs = build(indic_fails=True)
    assert engine.indic is None and engine.engine_for("ta") == "faster-whisper"
    engine.transcribe(np.zeros(16000, dtype=np.float32), "ta", True, None)
    assert whisper.calls == [("ta", True)] and "HF_TOKEN" in logs[0]


def test_indic_route_list_and_indic_only_mode():
    engine, _w, indic, _ = build(ASR_INDIC_LANGUAGES="hi,ta,bogus")
    assert engine.route == {"hi", "ta"}
    only, whisper, indic, _ = build("indicconformer")
    assert only.whisper is None and "en" not in only.languages() and len(only.languages()) == 22
    only.transcribe(np.zeros(16000, dtype=np.float32), "hi", True, None)
    assert indic.calls == [("hi", True)]


def test_languages_endpoint_reports_engine_per_language_and_stream_accepts_indic_codes():
    engine, _w, indic, _ = build()
    with TestClient(asr.create_app(lambda: engine)) as client:
        data = client.get("/v1/languages").json()
        by_code = {item["code"]: item for item in data["languages"]}
        assert by_code["ta"]["engine"] == "indicconformer" and by_code["hi"]["engine"] == "faster-whisper"
        assert by_code["brx"]["name"] == "Bodo" and data["engine"] == "faster-whisper+indicconformer" and data["autoDetect"] is True
        with client.websocket_connect("/v1/stream?language=ta-IN") as ws:
            assert json.loads(ws.receive_text())["type"] == "ready"
            audio = np.concatenate([silence(0.3), tone(1.2), silence(0.9)])
            for start in range(0, len(audio), 4000):
                ws.send_bytes(pcm(audio[start:start + 4000]))
            while True:
                message = json.loads(ws.receive_text())
                if message["type"] == "final":
                    break
            assert message["text"] == "இன்று கூட்டம்" and message["language"] == "ta"
        assert indic.calls and all(call[0] == "ta" for call in indic.calls)


def test_indicconformer_engine_calls_model_with_documented_signature(monkeypatch):
    import sys, types
    calls = {}

    class FakeNet:
        def __call__(self, wav, language, decoder):
            calls["shape"], calls["language"], calls["decoder"] = tuple(wav.shape), language, decoder
            return "আজ মিটিং"

    fake_torch = types.SimpleNamespace(from_numpy=lambda a: types.SimpleNamespace(unsqueeze=lambda d: types.SimpleNamespace(shape=(1, len(a)))),
                                       inference_mode=lambda: __import__("contextlib").nullcontext())
    fake_transformers = types.SimpleNamespace(AutoModel=types.SimpleNamespace(from_pretrained=lambda name, trust_remote_code, token: (calls.setdefault("load", (name, trust_remote_code, token)), FakeNet())[1]))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)
    monkeypatch.setenv("HF_TOKEN", "hf_x")
    engine = asr.IndicConformerEngine()
    assert calls["load"] == ("ai4bharat/indic-conformer-600m-multilingual", True, "hf_x")
    assert engine.transcribe(np.zeros(8000, dtype=np.float32), "bn", True, None) == ("আজ মিটিং", "bn")
    assert calls == {**calls, "shape": (1, 8000), "language": "bn", "decoder": "rnnt"}
    engine.transcribe(np.zeros(8000, dtype=np.float32), "bn", False, None)
    assert calls["decoder"] == "ctc"


def test_empty_settings_from_compose_use_defaults():
    engine, _w, _i, _ = build(ASR_INDIC_LANGUAGES="")
    assert engine.route == set(asr.INDIC_NAMES) - {"hi"}
    os.environ["ASR_ENGINE"] = ""
    try:
        assert asr.build_engine(lambda: FakeWhisper(), lambda: FakeIndic(), print).indic is not None
    finally:
        os.environ.pop("ASR_ENGINE", None)
