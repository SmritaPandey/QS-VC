import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRpcMessage } from './rpc/handler';
import { roomManager, type PeerState } from './room-manager';
import { publishCaption, translationCapabilities, translateCaption, clearEmptyRoomCaptions } from './captions';

const created: string[] = [];
function participant(roomId?: string, name = 'Synthetic Demo') {
    const room = roomId ? roomManager.getRoom(roomId)! : roomManager.getOrCreateRoom(`CAPTION-${Math.random()}`);
    if (!roomId) created.push(room.id);
    const ws = { readyState: 1, send: vi.fn() };
    const id = crypto.randomUUID();
    roomManager.addPeer(room.id, { id, ws, displayName: name, role: 'member', rtpCapabilities: {}, producers: new Map(), audioMuted: false, videoOff: false, handRaised: false, screenSharing: false, joinedAt: new Date() } satisfies PeerState);
    return { ws, roomId: room.id, id };
}
const final = { id: 'segment-1', text: 'Hello', language: 'en-US', isFinal: true };
function provider() {
    const request = vi.fn(async (url: string) => ({ ok: true, text: async () => JSON.stringify(url.endsWith('/languages') ? [{ code: 'en', name: 'English', targets: ['hi'] }, { code: 'hi', name: 'Hindi', targets: ['en'] }] : { translatedText: 'नमस्ते' }) }));
    vi.stubEnv('LIBRETRANSLATE_URL', `http://configured-${crypto.randomUUID()}.local`);
    vi.stubGlobal('fetch', request);
    return request;
}
afterEach(() => {
    for (const id of created.splice(0)) {
        for (const peerId of [...(roomManager.getRoom(id)?.peers.keys() || [])]) roomManager.removePeer(id, peerId);
        clearEmptyRoomCaptions(id);
    }
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('room caption and configured translation owners', () => {
    it('derives identity and broadcasts finals only to the active room', () => {
        const sender = participant(undefined, 'Real Display Name');
        const receiver = participant(sender.roomId);
        const stranger = participant();
        const result = publishCaption(sender.ws, sender.roomId, sender.id, { ...final, peerId: 'spoof', displayName: 'spoof' });
        expect(result.id).toBe(`${sender.id}:segment-1`);
        expect(JSON.parse(receiver.ws.send.mock.calls[0][0])).toMatchObject({ method: 'captionReceived', params: { id: result.id, peerId: sender.id, displayName: 'Real Display Name', text: 'Hello', isFinal: true } });
        expect(stranger.ws.send).not.toHaveBeenCalled();
        expect(() => publishCaption(stranger.ws, sender.roomId, sender.id, final)).toThrow('Not joined');
    });
    it('rejects interim/oversized/invalid languages and limits publication', () => {
        const peer = participant();
        for (const params of [{ ...final, isFinal: false }, { ...final, text: 'x'.repeat(2001) }, { ...final, language: 'auto' }, { ...final, id: 'x'.repeat(81) }]) expect(() => publishCaption(peer.ws, peer.roomId, peer.id, params)).toThrow('Invalid final caption');
        publishCaption(peer.ws, peer.roomId, peer.id, final);
        expect(() => publishCaption(peer.ws, peer.roomId, peer.id, { ...final, id: 'next' })).toThrow('rate limit');
        expect(() => publishCaption(peer.ws, peer.roomId, peer.id, { ...final, text: 'changed' })).toThrow('cannot be changed');
    });
    it('rejects publishing while the server marks the microphone muted', () => {
        const peer = participant(); roomManager.getRoom(peer.roomId)!.peers.get(peer.id)!.audioMuted = true;
        expect(() => publishCaption(peer.ws, peer.roomId, peer.id, final)).toThrow('Unmute');
        expect(peer.ws.send).not.toHaveBeenCalled();
    });
    it('allows distinct sequential language outputs without an artificial interval', async () => {
        provider(); const peer = participant();
        const { id } = publishCaption(peer.ws, peer.roomId, peer.id, final);
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi' })).resolves.toHaveProperty('translatedText');
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'en' })).resolves.toHaveProperty('translatedText', 'Hello');
    });
    it('returns unavailable without configuration and makes no outbound call', async () => {
        vi.stubEnv('LIBRETRANSLATE_URL', '');
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const peer = participant();
        expect(await translationCapabilities(peer.ws, peer.roomId, peer.id)).toEqual({ configured: false, languages: [], processing: 'configured-server' });
        const { id } = publishCaption(peer.ws, peer.roomId, peer.id, final);
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi' })).rejects.toThrow('no configured server');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('discovers real languages then translates only a stored room caption; caches identical requests', async () => {
        const request = provider(); vi.stubEnv('LIBRETRANSLATE_API_KEY', 'test-server-key');
        const peer = participant();
        const { id } = publishCaption(peer.ws, peer.roomId, peer.id, final);
        const caps = await translationCapabilities(peer.ws, peer.roomId, peer.id);
        expect(caps.languages.map(item => item.code)).toEqual(['en', 'hi']);
        const expected = { translatedText: 'नमस्ते', sourceLanguage: 'en-US', targetLanguage: 'hi-IN' };
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi-IN', text: 'ignored injection' })).resolves.toEqual(expected);
        expect(JSON.parse((request.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ q: 'Hello', source: 'en', target: 'hi', format: 'text', api_key: 'test-server-key' });
        expect((request.mock.calls[1] as unknown as [string, RequestInit])[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi-IN' })).resolves.toEqual(expected);
        expect(request).toHaveBeenCalledTimes(2);
        const stranger = participant();
        await expect(translateCaption(stranger.ws, stranger.roomId, stranger.id, { id, target: 'hi' })).rejects.toThrow('not found in this room');
    });
    it('rejects undiscovered languages before sending caption text', async () => {
        const request = provider(); const peer = participant();
        const { id } = publishCaption(peer.ws, peer.roomId, peer.id, final);
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'fr' })).rejects.toThrow('Language pair unavailable');
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('bounds final history to 100 and clears empty-room history', async () => {
        vi.useFakeTimers(); const peer = participant();
        for (let i = 0; i < 101; i++) {
            publishCaption(peer.ws, peer.roomId, peer.id, { ...final, id: `part-${i}` });
            vi.advanceTimersByTime(501);
        }
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id: `${peer.id}:part-0`, target: 'hi' })).rejects.toThrow('not found');
        roomManager.removePeer(peer.roomId, peer.id); clearEmptyRoomCaptions(peer.roomId);
        const next = participant(peer.roomId);
        await expect(translateCaption(next.ws, next.roomId, next.id, { id: `${peer.id}:part-100`, target: 'hi' })).rejects.toThrow('not found');
    });
    it('coalesces identical in-flight translation across peers and rejects concurrent work per peer', async () => {
        const request = provider(); const peer = participant(); const other = participant(peer.roomId);
        const { id } = publishCaption(peer.ws, peer.roomId, peer.id, final);
        let resolve!: (value: any) => void;
        request.mockImplementation(async (url: string) => url.endsWith('/languages') ? ({ ok: true, text: async () => JSON.stringify([{ code: 'en', name: 'English', targets: ['hi'] }, { code: 'hi', name: 'Hindi' }]) }) : new Promise(r => { resolve = r; }));
        const first = translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi' });
        const second = translateCaption(other.ws, other.roomId, other.id, { id, target: 'hi' });
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi' })).rejects.toThrow('rate limit');
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        resolve({ ok: true, text: async () => JSON.stringify({ translatedText: 'नमस्ते' }) });
        await Promise.all([first, second]);
        expect(request).toHaveBeenCalledTimes(2);
    });
    it('sanitizes provider failures and refuses malformed capability data', async () => {
        provider(); const peer = participant();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private caption key test-server-key')));
        await expect(translationCapabilities(peer.ws, peer.roomId, peer.id)).rejects.toThrow('configured server request failed');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify([{ code: 'en', name: 9 }]) }));
        const next = participant(peer.roomId);
        await expect(translationCapabilities(next.ws, next.roomId, next.id)).rejects.toThrow('invalid language capabilities');
    });
    it('RPC wiring enforces active membership before publishing, capabilities or translation', async () => {
        const request = provider(); const peer = participant();
        for (const method of ['captionPublish', 'translationCapabilities', 'translateCaption']) {
            const result = await handleRpcMessage({}, { jsonrpc: '2.0', id: 1, method, params: final }, { roomId: peer.roomId, peerId: peer.id });
            expect(result?.error?.message).toBe('Not joined a room');
        }
        expect(request).not.toHaveBeenCalled();
        const accepted = await handleRpcMessage(peer.ws, { jsonrpc: '2.0', id: 2, method: 'captionPublish', params: final }, { roomId: peer.roomId, peerId: peer.id });
        expect(accepted?.result).toEqual({ accepted: true, id: `${peer.id}:segment-1` });
    });
    it('rejects malformed provider configuration without exposing it', async () => {
        vi.stubEnv('LIBRETRANSLATE_URL', 'private key invalid URL');
        const peer = participant();
        await expect(translationCapabilities(peer.ws, peer.roomId, peer.id)).rejects.toThrow('Translation configuration invalid');
    });

    it.each(['malformed', 'http', 'timeout'])('fails closed on %s translation responses without leaking upstream details', async mode => {
        const request = provider(); const peer = participant();
        const { id } = publishCaption(peer.ws, peer.roomId, peer.id, final);
        await translationCapabilities(peer.ws, peer.roomId, peer.id);
        request.mockImplementation(async () => {
            if (mode === 'timeout') throw new DOMException('private transcript and key', 'TimeoutError');
            return { ok: mode !== 'http', text: async () => JSON.stringify({ translatedText: 12 }) };
        });
        await expect(translateCaption(peer.ws, peer.roomId, peer.id, { id, target: 'hi' })).rejects.toThrow(mode === 'malformed' ? 'invalid server result' : 'configured server request failed');
    });

});
