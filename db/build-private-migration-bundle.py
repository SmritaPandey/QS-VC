"""Build a secret-free CloudShell paste command; no network or database mutations."""
import base64
import gzip
import json
from pathlib import Path
import sys
root = Path(__file__).resolve().parent.parent
ca = Path(sys.argv[1]).read_text()
files = {'rds-ca.pem': ca, 'verify-access.sql': (root / 'db/verify-access.sql').read_text()}
runner = [r'\set ON_ERROR_STOP on', "SET statement_timeout='10s';", "SET lock_timeout='3s';", "SELECT pg_advisory_lock(75291001);", 'CREATE TABLE IF NOT EXISTS _migrations (id SERIAL PRIMARY KEY, filename VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());']
for file in sorted((root / 'db/migrations').glob('*.sql')):
    files[file.name] = file.read_text()
    runner += [f"SELECT EXISTS(SELECT 1 FROM _migrations WHERE filename='{file.name}') AS applied \\gset", r'\if :applied', f"\\echo Already applied: {file.name}", r'\else', 'BEGIN;', f'\\i {file.name}', f"INSERT INTO _migrations(filename) VALUES ('{file.name}');", 'COMMIT;', r'\endif']
runner += [r'\i verify-access.sql', 'SELECT pg_advisory_unlock(75291001);', "SELECT filename FROM _migrations ORDER BY id;"]
files['run.sql'] = '\n'.join(runner)+'\n'
payload = base64.b64encode(gzip.compress(json.dumps(files).encode())).decode()
code = "import base64,gzip,json,pathlib;d=pathlib.Path('qs-db-setup');d.mkdir(exist_ok=True);[(d/k).write_text(v) for k,v in json.loads(gzip.decompress(base64.b64decode('"+payload+"'))).items()]"
# The base64 payload and program contain no single quotes apart from deliberate Python literals.
import shlex
print('umask 077\npython3 -c '+shlex.quote(code))
