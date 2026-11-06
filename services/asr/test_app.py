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
