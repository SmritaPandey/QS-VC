const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createGateway } = require('./gateway.cjs');

const messages = [{ role: 'user', content: 'Confidential sample' }];
const modelList = () => Response.json({ data: [
    { id: 'demo/paid', context_length: 999999 },
    { id: 'demo/b:free', context_length: 1200 },
    { id: 'demo/a:free', context_length: 5000 },
] });
const success = () => Response.json({ choices: [{ message: { content: 'Summary' } }] });

function fixture(t, profile = 'standard') {
    const directory = mkdtempSync(join(tmpdir(), 'qsvc-ai-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const kekFile = join(directory, 'kek');
    const encryptedKey = join(directory, 'sealed');
    writeFileSync(kekFile, randomBytes(32), { mode: 0o600 });
    writeFileSync(join(directory, 'input'), 'synthetic-test-credential', { mode: 0o600 });
    execFileSync(process.execPath, [resolve(__dirname, '../../crypto/envelope.mjs'), 'seal', kekFile, join(directory, 'input'), encryptedKey]);
    return {
        profile, providers: { openrouter: { discovery: true, encryptedKey, kekFile } },
        features: { summaries: { provider: 'openrouter', hourlyLimit: 2, allowExternal: true, egressWarningAcknowledged: true } },
    };
}

test('free model disappears and gateway falls back without choosing a paid model', async t => {
    const models = [];
    const audit = [];
    const gateway = createGateway(fixture(t), { audit: event => audit.push(event), fetcher: async (url, opts) => {
        if (url.pathname.endsWith('/models')) return modelList();
        const { model } = JSON.parse(opts.body);
        models.push(model);
        return model === 'demo/a:free' ? new Response(null, { status: 404 }) : success();
    } });
    assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 200);
    assert.deepEqual(models, ['demo/a:free', 'demo/b:free']);
    assert.equal(audit.length, 3);
    assert.doesNotMatch(JSON.stringify(audit), /Confidential sample|synthetic-test-credential/);
    assert.equal(gateway.stats().summaries.used, 1);
});

test('429 storm has bounded retries, backoff and feature quota', async t => {
    let calls = 0;
    const delays = [];
    const gateway = createGateway(fixture(t), { audit: () => {}, sleep: async ms => delays.push(ms), fetcher: async url => {
        calls++;
        return url.pathname.endsWith('/models') ? modelList() : new Response(null, { status: 429 });
    } });
    assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 503);
    assert.equal(calls, 4);
    assert.deepEqual(delays, [250]);
    assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 503);
    assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 429);
    assert.equal(calls, 8);
});

test('provider timeout returns unavailable and releases capacity', async t => {
    const policy = fixture(t);
    let timeouts = 0;
    const gateway = createGateway(policy, { audit: () => {}, fetcher: async (url, opts) => {
        if (url.pathname.endsWith('/models')) return modelList();
        assert.ok(opts.signal instanceof AbortSignal);
        timeouts++;
        throw new DOMException('Timed out', 'TimeoutError');
    } });
    assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 503);
    assert.equal(timeouts, 2);
    assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 503);
});

test('disabled external providers and classified data never reach fetch', async t => {
    let calls = 0;
    const fetcher = async () => { calls++; return success(); };
    for (const profile of ['air-gapped', 'high-assurance', 'standard']) {
        const policy = fixture(t, profile);
        const gateway = createGateway(policy, { fetcher });
        assert.equal((await gateway.request('summaries', 'classified', messages)).status, 403);
        if (profile === 'standard') policy.features.summaries.egressWarningAcknowledged = false;
        assert.equal((await gateway.request('summaries', 'meeting', messages)).status, 403);
    }
    assert.equal(calls, 0);
});

test('gateway and shipped policy contain no OpenRouter credentials', () => {
    const secret = /sk-or-v[0-9]+-[a-z0-9_-]{20,}/i;
    for (const file of ['gateway.cjs', 'policy.example.json', '../../offline/bundle.sh', '../../../../config/.env.onprem.template']) {
        assert.doesNotMatch(readFileSync(resolve(__dirname, file), 'utf8'), secret);
    }
    const policy = JSON.parse(readFileSync(join(__dirname, 'policy.example.json'), 'utf8'));
    assert.deepEqual(policy.features, {});
    assert.equal(policy.profile, 'air-gapped');
});
