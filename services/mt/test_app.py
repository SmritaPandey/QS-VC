import json
import os

os.environ["MT_DISABLE_AUTOLOAD"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

import app as mt  # noqa: E402


class FakeBackend:
    def __init__(self):
        self.calls = []

    def translate_batch(self, texts, src, tgt):
        self.calls.append((tuple(texts), src, tgt))
        # Keeps placeholders like [0] the way IndicTrans2 copies Latin/bracket tokens.
        return [f"<{tgt}>{text}" for text in texts]


def client(tmp_path=None, glossary=None, **env):
    for key, value in env.items():
        os.environ[key] = value
    if glossary is not None:
        path = tmp_path / "glossary.json"
        path.write_text(json.dumps(glossary), encoding="utf-8")
        os.environ["MT_GLOSSARY_FILE"] = str(path)
    backend = FakeBackend()
    test_client = TestClient(mt.create_app(lambda: backend))
    test_client.__enter__()
    return test_client, backend


def teardown_function():
    for key in ["MT_GLOSSARY_FILE", "MT_API_KEY", "MT_LANGUAGES"]:
        os.environ.pop(key, None)


def test_languages_are_libretranslate_shaped():
    c, _ = client()
    data = c.get("/languages").json()
    hindi = next(item for item in data if item["code"] == "hi")
    assert hindi["name"] == "Hindi" and "en" in hindi["targets"] and "ta" in hindi["targets"]
    assert len(data) == 23  # English + 22 scheduled languages


def test_translate_normalises_codes_and_caches():
    c, backend = client()
    first = c.post("/translate", json={"q": "Meeting is tomorrow", "source": "en-US", "target": "hi-IN"})
    assert first.status_code == 200 and first.json() == {"translatedText": "<hi>Meeting is tomorrow"}
    c.post("/translate", json={"q": "Meeting is tomorrow", "source": "en", "target": "hi"})
    assert len(backend.calls) == 1
    assert c.post("/translate", json={"q": "x", "source": "en", "target": "fr"}).status_code == 400


def test_glossary_keeps_terms_and_fixes_output(tmp_path):
    c, backend = client(tmp_path, {"keep": ["UPSWAN"], "fix": {"hi": {"<hi>": ""}}})
    result = c.post("/translate", json={"q": "Join the UPSWAN review", "source": "en", "target": "hi"}).json()
    assert backend.calls[0][0] == ("Join the [0] review",)
    assert result["translatedText"] == "Join the UPSWAN review"


def test_api_key_and_language_allow_list(tmp_path):
    c, _ = client(MT_API_KEY="k", MT_LANGUAGES="hi,ta")
    assert c.post("/translate", json={"q": "a", "source": "en", "target": "hi"}).status_code == 403
    assert c.post("/translate", json={"q": "a", "source": "en", "target": "hi", "api_key": "k"}).status_code == 200
    assert [item["code"] for item in c.get("/languages").json()] == ["en", "hi", "ta"]
