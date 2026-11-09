"""Only load reviewed local AI artifacts in production; no runtime Hub downloads."""
import hashlib
import json
import os
import re
from pathlib import Path

MANIFEST = 'qsvc-model-manifest.json'


def model_path(name: str) -> str:
    if os.environ.get('NODE_ENV') in {'development', 'test'} and os.environ.get('QSVC_ALLOW_UNVERIFIED_MODELS') == 'true':
        return name
    root = Path(name).resolve()
    manifest = root / MANIFEST
    if not root.is_dir() or not manifest.is_file() or manifest.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('A reviewed local model and SHA-256 manifest are required')
    files = json.loads(manifest.read_text()).get('files')
    if not isinstance(files, dict) or not files or len(files) > 10000:
        raise ValueError('Invalid model manifest')
    entries = list(root.rglob('*'))
    if any(p.is_symlink() for p in entries):
        raise ValueError('Model bundles must contain files, not symlinks')
    actual = {str(p.relative_to(root)) for p in entries if p.is_file() and p != manifest}
    if actual != set(files):
        raise ValueError('Model files differ from the reviewed manifest')
    for relative, digest in files.items():
        file = root / relative
        if not re.fullmatch(r'[0-9a-f]{64}', str(digest)) or not file.resolve().is_relative_to(root):
            raise ValueError('Invalid model file or checksum')
        with file.open('rb') as stream:
            calculated = hashlib.file_digest(stream, 'sha256').hexdigest()
        if calculated != digest:
            raise ValueError('Model integrity check failed')
    return str(root)


def offline_models() -> bool:
    return not (os.environ.get('NODE_ENV') in {'development', 'test'} and os.environ.get('QSVC_ALLOW_UNVERIFIED_MODELS') == 'true')
