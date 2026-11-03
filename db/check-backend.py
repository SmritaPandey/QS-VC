"""Temporary private-cloud API checks. Passwords stay in memory, never files/logs."""
import getpass
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
HOST = 'qs-db.c7kqqqyaeqy2.ap-south-1.rds.amazonaws.com'

def request(port, route, data=None, token=None, method=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(f'http://127.0.0.1:{port}{route}', data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def main():
    auth_password = getpass.getpass('Password for qs_auth_app (hidden): ')
    meeting_password = getpass.getpass('Password for qs_meeting_app (hidden): ')
    if not auth_password or not meeting_password:
        raise RuntimeError('Both passwords are required')
    common = {**os.environ, 'NODE_ENV': 'production', 'JWT_SECRET': secrets.token_hex(32),
              'POSTGRES_SSL': 'verify-full', 'POSTGRES_CA_FILE': str(ROOT / 'rds-ca.pem'),
              'AUTH_PORT': '4142', 'MEETING_PORT': '4143', 'AUTH_INTERNAL_URL': 'http://127.0.0.1:4142',
              'WEB_URL': 'https://qsvcmeet.com', 'CORS_ORIGINS': 'https://qsvcmeet.com'}
    # Do not inherit an administrator or unrelated service's database credentials.
    for key in ['DATABASE_URL', 'AUTH_DATABASE_URL', 'MEETING_DATABASE_URL', 'POSTGRES_PASSWORD']:
        common.pop(key, None)
    processes = []
    with tempfile.TemporaryFile() as log:
        try:
            for service, user, password in [('auth', 'qs_auth_app', auth_password), ('meeting', 'qs_meeting_app', meeting_password)]:
                env = {**common, 'DATABASE_URL': f'postgresql://{user}:{urllib.parse.quote(password, safe="")}@{HOST}:5432/qsvc'}
                processes.append(subprocess.Popen(['node', str(ROOT / (service + '.cjs'))], env=env, stdout=log, stderr=log))
            auth_password = meeting_password = None
            deadline = time.monotonic() + 35
            for port in [4142, 4143]:
                while True:
                    try:
                        status, _ = request(port, '/ready')
                        if status == 200:
                            break
                    except (OSError, ValueError):
                        pass
                    if time.monotonic() >= deadline or any(p.poll() is not None for p in processes):
                        raise RuntimeError('Backend readiness failed; no credentials or logs printed')
                    time.sleep(0.5)
            print('PASS: both real backend services connect through verified TLS with restricted credentials')
            suffix = secrets.token_hex(6)
            password = secrets.token_urlsafe(24)
            email = 'database-check-' + suffix + '@example.test'
            status, registered = request(4142, '/api/auth/register', {'email': email, 'password': password, 'displayName': 'Synthetic database verification'})
            assert status == 201, 'Synthetic registration failed'
            status, login = request(4142, '/api/auth/login', {'email': email, 'password': password})
            assert status == 200 and login.get('token'), 'Login failed'
            token = login['token']
            status, user = request(4142, '/api/auth/me', token=token)
            assert status == 200 and user.get('email') == email, 'Saved user read failed'
            print('PASS: registration, persisted user read and login')
            status, meeting = request(4143, '/api/meetings', {'title': 'Synthetic database verification ' + suffix}, token)
            assert status == 201 and meeting.get('meetingCode'), 'Meeting save failed'
            status, meetings = request(4143, '/api/meetings', token=token)
            assert status == 200 and any(m.get('meetingCode') == meeting['meetingCode'] for m in meetings.get('meetings', [])), 'Saved meeting read failed'
            print('PASS: authenticated meeting save/read with tenant context')
            status, contact = request(4142, '/api/auth/contact', {'name': 'Synthetic database verification', 'email': email, 'topic': 'support', 'message': 'Synthetic database verification ' + suffix})
            assert status == 201 and contact.get('id'), 'Contact save failed'
            print('PASS: contact enquiry committed with receipt')
            status, _ = request(4142, '/api/auth/logout', {}, token)
            assert status == 200, 'Logout failed'
            status, _ = request(4142, '/api/auth/me', token=token)
            assert status == 401, 'Logged-out session still works'
            print('PASS: logout revokes the saved session')
            print('PASS: API checks completed; synthetic account, meeting and enquiry retained and labelled for cleanup')
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Assertions contain fixed descriptions, never connection strings or HTTP tokens.
        print('FAIL:', str(error) if isinstance(error, (AssertionError, RuntimeError)) else type(error).__name__)
        raise SystemExit(1)
