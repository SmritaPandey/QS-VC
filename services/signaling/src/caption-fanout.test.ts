import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomManager, type PeerState } from './room-manager';
import { handleRpcMessage } from './rpc/handler';
import { clearEmptyRoomCaptions, publishCaption, publishInterim, publishServerCaption, setTranscriptSaving, subscribeCaptions, transcriptEntries } from './captions';

const created: string[] = [];
function participant(roomId?: string, name = 'Speaker') {
    const room = roomId ? roomManager.getRoom(roomId)! : roomManager.getOrCreateRoom(`FANOUT-${Math.random()}`);
    if (!roomId) created.push(room.id);
    const ws = { readyState: 1, send: vi.fn() };
    const id = crypto.randomUUID();
    roomManager.addPeer(room.id, { id, ws, displayName: name, role: 'member', rtpCapabilities: {}, producers: new Map(), audioMuted: false, videoOff: false, handRaised: false, screenSharing: false, joinedAt: new Date() } satisfies PeerState);
    return { ws, roomId: room.id, id };
}
const sent = (ws: { send: ReturnType<typeof vi.fn> }, method: string) => ws.send.mock.calls.map(call => JSON.parse(call[0])).filter(message => message.method === method).map(message => message.params);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function provider() {
    const request = vi.fn(async (url: string, init?: RequestInit) => ({
        ok: true,
        text: async () => JSON.stringify(url.endsWith('/languages')
            ? [{ code: 'en', name: 'English', targets: ['hi', 'ta'] }, { code: 'hi', name: 'Hindi', targets: ['en'] }, { code: 'ta', name: 'Tamil', targets: ['en'] }]
            : { translatedText: `${JSON.parse(String(init?.body)).target}:${JSON.parse(String(init?.body)).q}` }),
    }));
    vi.stubEnv('LIBRETRANSLATE_URL', `http://mt-${crypto.randomUUID()}.local`);
    vi.stubGlobal('fetch', request);
    return request;
}
afterEach(() => {
    for (const id of created.splice(0)) {
        for (const peerId of [...(roomManager.getRoom(id)?.peers.keys() || [])]) roomManager.removePeer(id, peerId);
        clearEmptyRoomCaptions(id);
    }
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe('server-side translation fan-out', () => {
    it('translates once per chosen language and pushes it only to the listeners who chose it', async () => {
        const request = provider();
        const speaker = participant();
        const hindiA = participant(speaker.roomId); const hindiB = participant(speaker.roomId); const tamil = participant(speaker.roomId); const original = participant(speaker.roomId);
        subscribeCaptions(hindiA.ws, speaker.roomId, hindiA.id, { targets: ['hi-IN'] });
        subscribeCaptions(hindiB.ws, speaker.roomId, hindiB.id, { targets: ['hi-IN', 'original'] });
        subscribeCaptions(tamil.ws, speaker.roomId, tamil.id, { targets: ['ta'] });
        subscribeCaptions(original.ws, speaker.roomId, original.id, { targets: ['original'] });
        const { id } = publishCaption(speaker.ws, speaker.roomId, speaker.id, { id: 's1', text: 'Meeting is tomorrow', language: 'en-US', isFinal: true });
        await vi.waitFor(() => expect(sent(tamil.ws, 'captionTranslated')).toHaveLength(1));
        await vi.waitFor(() => expect(sent(hindiB.ws, 'captionTranslated')).toHaveLength(1));
        expect(sent(hindiA.ws, 'captionTranslated')[0]).toMatchObject({ id, target: 'hi-IN', translatedText: 'hi:Meeting is tomorrow', displayName: 'Speaker' });
        expect(sent(tamil.ws, 'captionTranslated')[0]).toMatchObject({ target: 'ta', translatedText: 'ta:Meeting is tomorrow' });
        expect(sent(original.ws, 'captionTranslated')).toHaveLength(0);
        expect(sent(original.ws, 'captionReceived')).toHaveLength(1);
        const translateCalls = request.mock.calls.filter(call => String(call[0]).endsWith('/translate'));
        expect(translateCalls).toHaveLength(2); // hi once (shared by two listeners) + ta once
    });
    it('skips listeners whose language matches the speaker and reports provider failure', async () => {
        provider();
        const speaker = participant(); const english = participant(speaker.roomId); const french = participant(speaker.roomId);
        subscribeCaptions(english.ws, speaker.roomId, english.id, { targets: ['en-GB'] });
        subscribeCaptions(french.ws, speaker.roomId, french.id, { targets: ['fr'] });
        publishCaption(speaker.ws, speaker.roomId, speaker.id, { id: 's2', text: 'Hello', language: 'en-US', isFinal: true });
        await vi.waitFor(() => expect(sent(french.ws, 'captionTranslationFailed')).toHaveLength(1));
        expect(sent(english.ws, 'captionTranslated')).toHaveLength(0);
        expect(sent(english.ws, 'captionTranslationFailed')).toHaveLength(0);
    });
    it('reports busy instead of queueing without bound when room concurrency is exhausted', async () => {
        vi.stubEnv('CAPTION_ROOM_CONCURRENCY', '1'); vi.stubEnv('CAPTION_PUBLISH_INTERVAL_MS', '0');
        provider();
        const speaker = participant(); const listener = participant(speaker.roomId); const other = participant(speaker.roomId);
        subscribeCaptions(listener.ws, speaker.roomId, listener.id, { targets: ['hi'] });
        subscribeCaptions(other.ws, speaker.roomId, other.id, { targets: ['ta'] });
        publishCaption(speaker.ws, speaker.roomId, speaker.id, { id: 's3', text: 'One', language: 'en', isFinal: true });
        await vi.waitFor(() => expect(sent(listener.ws, 'captionTranslated').length + sent(other.ws, 'captionTranslated').length).toBe(1));
        expect(sent(listener.ws, 'captionTranslationFailed').length + sent(other.ws, 'captionTranslationFailed').length).toBe(1);
    });
    it('rejects more than two output languages and malformed codes', () => {
        const peer = participant();
        expect(() => subscribeCaptions(peer.ws, peer.roomId, peer.id, { targets: ['hi', 'ta', 'en'] })).toThrow('Invalid');
        expect(() => subscribeCaptions(peer.ws, peer.roomId, peer.id, { targets: ['../x'] })).toThrow('Invalid');
    });
});

describe('interim captions', () => {
    it('relays live text to others only, throttled, never stored', async () => {
        provider();
        const speaker = participant(); const listener = participant(speaker.roomId);
        subscribeCaptions(listener.ws, speaker.roomId, listener.id, { targets: ['hi'] });
        expect(publishInterim(speaker.ws, speaker.roomId, speaker.id, { id: 'u1', text: 'Meeting is', language: 'en' })).toEqual({ accepted: true });
        expect(publishInterim(speaker.ws, speaker.roomId, speaker.id, { id: 'u1', text: 'Meeting is to', language: 'en' })).toEqual({ accepted: false });
        expect(sent(listener.ws, 'captionInterim')).toEqual([{ id: `${speaker.id}:u1`, peerId: speaker.id, displayName: 'Speaker', text: 'Meeting is', language: 'en' }]);
        expect(sent(speaker.ws, 'captionInterim')).toHaveLength(0);
        await flush();
        expect(sent(listener.ws, 'captionTranslated')).toHaveLength(0);
    });
    it('drops interim text while muted', () => {
        const speaker = participant(); roomManager.getRoom(speaker.roomId)!.peers.get(speaker.id)!.audioMuted = true;
        expect(publishInterim(speaker.ws, speaker.roomId, speaker.id, { id: 'u1', text: 'secret', language: 'en' })).toEqual({ accepted: false });
    });
});

describe('server speech captions and transcript', () => {
    it('attributes server recognition to the room member and skips muted speakers', () => {
        const speaker = participant(undefined, 'Asha'); const listener = participant(speaker.roomId);
        const id = publishServerCaption(speaker.roomId, speaker.id, { id: 'asr1-0', text: 'नमस्ते', language: 'hi' });
        expect(sent(listener.ws, 'captionReceived')[0]).toMatchObject({ id, displayName: 'Asha', text: 'नमस्ते', language: 'hi', source: 'server' });
        roomManager.getRoom(speaker.roomId)!.peers.get(speaker.id)!.audioMuted = true;
        expect(publishServerCaption(speaker.roomId, speaker.id, { id: 'asr1-1', text: 'hidden', language: 'hi' })).toBeNull();
    });
    it('keeps a transcript only while the host has saving on, and tells everyone', () => {
        vi.stubEnv('CAPTION_PUBLISH_INTERVAL_MS', '0');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        const speaker = participant(); const listener = participant(speaker.roomId);
        publishCaption(speaker.ws, speaker.roomId, speaker.id, { id: 'before', text: 'Not saved', language: 'en', isFinal: true });
        setTranscriptSaving(speaker.roomId, true);
        expect(sent(listener.ws, 'transcriptStateChanged')).toEqual([{ saving: true }]);
        publishCaption(speaker.ws, speaker.roomId, speaker.id, { id: 'after', text: 'Saved line', language: 'en', isFinal: true });
        const transcript = transcriptEntries(speaker.roomId);
        expect(transcript.saving).toBe(true);
        expect(transcript.entries.map(entry => entry.text)).toEqual(['Saved line']);
        setTranscriptSaving(speaker.roomId, false);
        expect(transcriptEntries(speaker.roomId)).toEqual({ saving: false, entries: [] });
    });
});

describe('guest caption rules (RPC)', () => {
    it('lets guests read captions in one language but not hear voice or share speech', async () => {
        const guest = participant();
        const state = { roomId: guest.roomId, peerId: guest.id };
        const call = (method: string, params: object, extra: object = {}) => handleRpcMessage(guest.ws, { jsonrpc: '2.0', id: 1, method, params }, { ...state, ...extra });
        expect((await call('captionSubscribe', { targets: ['hi-IN'] }))?.result).toEqual({ targets: ['hi-IN'] });
        expect((await call('captionSubscribe', { targets: ['hi-IN', 'ta'] }))?.error?.message).toContain('one language');
        for (const method of ['captionInterim', 'asrStart', 'asrAudio']) {
            expect((await call(method, { id: 'x', text: 'hi', language: 'en' }))?.error?.message).toContain('Sign in');
        }
        const paid = { authUser: { sub: 'u', plan: 'starter', status: 'paid_active' } };
        expect((await call('captionSubscribe', { targets: ['hi-IN', 'ta'] }, paid))?.result).toEqual({ targets: ['hi-IN', 'ta'] });
        const expired = { authUser: { sub: 'u', plan: 'starter_trial', status: 'trial_expired' } };
        expect((await call('captionInterim', { id: 'x', text: 'hi', language: 'en' }, expired))?.error?.message).toContain('Sign in');
    });
});
