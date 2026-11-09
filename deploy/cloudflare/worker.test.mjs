import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

test('frontend routes use the asset binding; health executes Worker code', async () => {
    const env = { ASSETS: { fetch: () => new Response('frontend') } };
    assert.equal(await (await worker.fetch(new Request('https://site.test/app'), env)).text(), 'frontend');
    assert.equal((await (await worker.fetch(new Request('https://site.test/api/health'), env)).json()).runtime, 'worker');
});

test('missing or unsafe backend configuration fails closed; private API paths are not forwarded', async () => {
    for (const BACKEND_ORIGIN of [undefined, 'http://backend.test', 'https://site.test', 'https://www.site.test', 'https://user:pass@backend.test', 'https://backend.test/path']) {
        const result = await worker.fetch(new Request('https://site.test/api/meetings'), { BACKEND_ORIGIN });
        assert.equal(result.status, 503);
    }
    const result = await worker.fetch(new Request('https://site.test/api/internal/meetings/code'), {});
    assert.equal(result.status, 404);
});

test('API requests retain method, body, query and auth; signaling retains upgrade; failures return JSON', async () => {
    const originalFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async request => { seen.push(request); return new Response('backend'); };
    try {
        const env = { BACKEND_ORIGIN: 'https://backend.test', ORIGIN_AUTH_SECRET: 'synthetic-origin-secret-for-tests-only' };
        const request = new Request('https://site.test/api/meetings?limit=2', {
            method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'X-QSVC-Origin': 'attacker-input' }, body: '{}',
        });
        assert.equal(await (await worker.fetch(request, env)).text(), 'backend');
        assert.equal(seen[0].url, 'https://backend.test/api/meetings?limit=2');
        assert.equal(seen[0].method, 'POST');
        assert.equal(await seen[0].text(), '{}');
        assert.equal(seen[0].headers.get('Authorization'), 'Bearer test');
        assert.equal(seen[0].headers.get('X-QSVC-Origin'), env.ORIGIN_AUTH_SECRET);
        assert.equal(seen[0].redirect, 'manual');
        await worker.fetch(new Request('https://site.test/ws', { headers: { Upgrade: 'websocket' } }), env);
        assert.equal(seen[1].headers.get('Upgrade'), 'websocket');
        for (const path of ['/api/ice-servers', '/api/users/me', '/api/admin/stats']) {
            assert.equal((await worker.fetch(new Request(`https://site.test${path}`), env)).status, 200);
            assert.equal(seen.at(-1).url, `https://backend.test${path}`);
        }
        globalThis.fetch = async () => { throw new Error('connection refused'); };
        assert.equal((await worker.fetch(new Request('https://site.test/api/auth/me'), env)).status, 502);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('website responses carry browser security headers', async () => {
    const env = { ASSETS: { fetch: () => new Response('frontend', { headers: { 'Content-Type': 'text/html' } }) } };
    const response = await worker.fetch(new Request('https://site.test/'), env);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.match(response.headers.get('Strict-Transport-Security'), /max-age=31536000/);
    assert.match(response.headers.get('Permissions-Policy'), /camera=\(self\)/);
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('Content-Type'), 'text/html');
});

 test('security headers are applied to API errors and cannot be bypassed by asset routes', async () => {
    const response = await worker.fetch(new Request('https://site.test/api/internal/secrets'), {});
    assert.equal(response.status,404);
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    const policy = response.headers.get('Content-Security-Policy');
    assert.doesNotMatch(policy.split('style-src')[0], /unsafe-inline/);
 });

test('missing origin authentication cannot proxy requests', async () => {
    assert.equal((await worker.fetch(new Request('https://site.test/api/auth/me'), { BACKEND_ORIGIN: 'https://backend.test' })).status, 503);
});
