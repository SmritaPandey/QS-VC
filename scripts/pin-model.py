"""Create a manifest AFTER reviewing a model revision and its custom Python code."""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('--revision', required=True, help='Reviewed 40-character repository commit hash')
args = parser.parse_args()
if not re.fullmatch('[a-f0-9]{40}', args.revision): parser.error('Use the full reviewed commit hash')
root = args.directory.resolve()
if not root.is_dir(): parser.error('Model directory does not exist')
files = {}
for file in sorted(root.rglob('*')):
    if file.is_symlink(): parser.error('Copy model files with symlinks dereferenced before pinning')
    if file.is_file():
        with file.open('rb') as stream:
            files[str(file.relative_to(root))] = hashlib.file_digest(stream, 'sha256').hexdigest()
if not files or len(files) > 10000: parser.error('Invalid model file inventory')
manifest = {'revision': args.revision, 'files': files}
with (root / 'qsvc-model-manifest.json').open('x') as output:
    json.dump(manifest, output, indent=2)
print(f'Pinned {len(files)} reviewed model files. Mount the bundle read-only in production.')
