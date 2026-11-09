import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('origin rejects missing or incorrect edge credentials before serving any route', { skip: process.env.QSVC_CONTAINER_TESTS !== '1' }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qsvc-origin-'));
    const name = `qsvc-origin-check-${process.pid}`;
    const secret = 'synthetic-origin-secret-for-local-validation';
    const config = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8').replace(/    tls \{[^}]*\}\n/, '');
    writeFileSync(join(directory, 'Caddyfile'), config);
    let created = false;
    try {
        execFileSync('docker', ['run', '--rm', '-d', '--name', name,
            '-p', '127.0.0.1:18089:8080', '-e', 'DOMAIN=http://localhost:8080', '-e', `ORIGIN_AUTH_SECRET=${secret}`,
            '-v', `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`, 'caddy:2-alpine'], { stdio: 'pipe' });
        created = true;
        for (let attempt = 0; attempt < 50; attempt++) {
            try { await fetch('http://localhost:18089/health'); break; }
            catch { await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        for (const path of ['/health', '/api/auth/me', '/ws', '/anything']) {
            for (const value of ['', 'incorrect']) {
                const response = await fetch(`http://localhost:18089${path}`, { headers: { 'X-QSVC-Origin': value } });
                assert.equal(response.status, 403, path);
            }
        }
        assert.equal((await fetch('http://localhost:18089/health', { headers: { 'X-QSVC-Origin': secret } })).status, 200);
    } finally {
        if (created) execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
        rmSync(directory, { recursive: true, force: true });
    }
});
