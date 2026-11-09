import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('provisions distinct private keys without printing them or overwriting existing files', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qsvc-keys-check-'));
    const directory = join(parent, 'private');
    const script = new URL('./provision-security-keys.mjs', import.meta.url);
    try {
        const output = execFileSync(process.execPath, [script.pathname, directory], { encoding: 'utf8' });
        const pem = readFileSync(join(directory, 'session-signing.pem'), 'utf8');
        assert.equal(createPrivateKey(pem).asymmetricKeyType, 'ed25519');
        const entries = readFileSync(join(directory, 'security.env'), 'utf8').trim().split('\n').slice(1).map(line => line.slice(line.indexOf('=') + 1));
        assert.equal(new Set(entries).size, 6);
        for (const value of entries) { assert.ok(value.length >= 32); assert.ok(!output.includes(value)); }
        for (const file of ['session-signing.pem', 'security.env']) assert.equal(statSync(join(directory, file)).mode & 0o777, 0o600);
        assert.throws(() => execFileSync(process.execPath, [script.pathname, directory], { stdio: 'pipe' }));
        assert.equal(readFileSync(join(directory, 'session-signing.pem'), 'utf8'), pem);
    } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('production TURN startup rejects public development secrets and short keys', () => {
    const script = new URL('../deploy/turn/start.sh', import.meta.url).pathname;
    for (const secret of ['short', 'dev-turn-secret-change-in-production']) {
        assert.throws(() => execFileSync('sh', [script], {
            env: { ...process.env, NODE_ENV: 'production', TURN_SECRET: secret, TURN_REALM: 'synthetic.test' }, stdio: 'pipe',
        }));
    }
});
