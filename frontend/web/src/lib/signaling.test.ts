import { afterEach, expect, it, vi } from 'vitest';

class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    onopen?: () => void;
    onclose?: (event: { code: number }) => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: (event: unknown) => void;
    constructor(public url: URL) { Socket.instances.push(this); queueMicrotask(() => this.onopen?.()); }
    close(code: number) { this.onclose?.({ code }); }
}
afterEach(() => { vi.unstubAllGlobals(); Socket.instances = []; });
it('clears a rejected session and lets the page explicitly recover instead of silently reopening a socket', async () => {
    let token: string | null = 'synthetic';
    vi.stubGlobal('sessionStorage', { getItem: () => token, removeItem: () => { token = null; } });
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'http:', host: 'localhost:5173' } }));
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'member', displayName: 'Member', email: 'member@example.test' }) }));
    vi.stubGlobal('WebSocket', Socket);
    const { SignalingClient } = await import('./signaling');
    const client = new SignalingClient(); const failed = vi.fn();
    client.on('reconnectFailed', failed); await client.connect();
    expect(Socket.instances[0].url.searchParams.get('token')).toBe('synthetic');
    Socket.instances[0].close(4003);
    expect(token).toBeNull(); expect(failed).toHaveBeenCalledOnce(); expect(Socket.instances).toHaveLength(1);
    await client.connect(); expect(Socket.instances).toHaveLength(2);
    expect(Socket.instances[1].url.searchParams.has('token')).toBe(false);
    client.disconnect();
});

it('does not clear a newer login when an older socket is rejected', async () => {
    let token: string | null = 'old';
    vi.stubGlobal('sessionStorage', { getItem: () => token, removeItem: () => { token = null; } });
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'http:', host: 'localhost:5173' } }));
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'member', displayName: 'Member', email: 'member@example.test' }) }));
    vi.stubGlobal('WebSocket', Socket);
    const { SignalingClient } = await import('./signaling');
    const client = new SignalingClient();
    await client.connect();
    token = 'new';
    Socket.instances[0].close(4003);
    expect(token).toBe('new');
    client.disconnect();
});

it('closes authenticated meeting media signaling when account validation confirms expiry', async () => {
    let token: string | null = 'expired';
    vi.stubGlobal('sessionStorage', { getItem: () => token, removeItem: () => { token = null; } });
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'http:', host: 'localhost:5173' } }));
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { SignalingClient } = await import('./signaling');
    const { refreshSession } = await import('./session');
    const client = new SignalingClient(); const disconnected = vi.fn();
    client.on('disconnected', disconnected);
    await client.connect().catch(() => {});
    await refreshSession();
    expect(token).toBeNull();
    expect(disconnected).toHaveBeenCalledWith({ code: 4003 });
    client.disconnect();
});
