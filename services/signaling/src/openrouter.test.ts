import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { request } from 'node:https';
import { askOpenRouter } from './openrouter.js';

vi.mock('node:https', () => ({ request: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('uses the server credential and requires private routing and hybrid TLS', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('QSVC_DEPLOYMENT', 'online');
    let payload = '';
    vi.mocked(request).mockImplementation(((_url: unknown, _options: unknown, receive: Function) => {
        return Object.assign(new EventEmitter(), { end(body: string) {
            payload = body;
            const res = Object.assign(new EventEmitter(), { statusCode: 200 });
            receive(res);
            res.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: 'answer' } }] })));
            res.emit('end');
        } });
    }) as typeof request);
    await expect(askOpenRouter('Guide', 'question')).resolves.toBe('answer');
    expect(request).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions', expect.objectContaining({
        minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', ecdhCurve: 'X25519MLKEM768', rejectUnauthorized: true,
    }), expect.any(Function));
    expect(JSON.parse(payload).provider).toEqual({ data_collection: 'deny', zdr: true });
    expect(payload).not.toContain('test-key');
});

it('blocks public relay calls for on-premise deployments, even with a key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('QSVC_DEPLOYMENT', 'onprem');
    await expect(askOpenRouter('Guide', 'question')).rejects.toThrow('unavailable');
    expect(request).not.toHaveBeenCalled();
});
