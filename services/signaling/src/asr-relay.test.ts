import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import http from 'http';
import { roomManager, type PeerState } from './room-manager';
import { asrCapabilities, pushAsrAudio, resetAsrCapabilities, startAsr, stopAsr } from './asr-relay';
import { clearEmptyRoomCaptions } from './captions';
import { generateMinutes, transcriptText } from './minutes';

const created: string[] = [];
function participant(roomId?: string, name = 'Asha') {
    const room = roomId ? roomManager.getRoom(roomId)! : roomManager.getOrCreateRoom(`ASR-${Math.random()}`);
    if (!roomId) created.push(room.id);
    const ws = { readyState: 1, send: vi.fn() };
    const id = crypto.randomUUID();
    roomManager.addPeer(room.id, { id, ws, displayName: name, role: 'member', rtpCapabilities: {}, producers: new Map(), audioMuted: false, videoOff: false, handRaised: false, screenSharing: false, joinedAt: new Date() } satisfies PeerState);
    return { ws, roomId: room.id, id };
}
const sent = (ws: { send: ReturnType<typeof vi.fn> }, method: string) => ws.send.mock.calls.map(call => JSON.parse(call[0])).filter(message => message.method === method).map(message => message.params);

/** Minimal stand-in for services/asr: echoes byte counts as partial/final results. */
async function fakeAsr() {
    const server = http.createServer((req, res) => {
        if (req.url === '/v1/languages') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ languages: [{ code: 'hi', name: 'Hindi' }, { code: 'en', name: 'English' }], autoDetect: true, engine: 'fake', model: 'test' })); return; }
        res.statusCode = 404; res.end();
    });
    const wss = new WebSocketServer({ server, path: '/v1/stream' });
    const received: { url: string; auth?: string; bytes: number[]; stops: number } = { url: '', bytes: [], stops: 0 };
    wss.on('connection', (socket, req) => {
        received.url = req.url || ''; received.auth = req.headers.authorization;
        socket.on('message', (data, binary) => {
            if (binary) { received.bytes.push((data as Buffer).length); socket.send(JSON.stringify({ type: 'partial', segment: 0, text: 'नमस्ते सब', language: 'hi' })); return; }
            received.stops++;
            socket.send(JSON.stringify({ type: 'final', segment: 0, text: 'नमस्ते सबको', language: 'hi' }));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return { url: `http://127.0.0.1:${port}`, received, close: () => new Promise<void>(resolve => { for (const client of wss.clients) client.terminate(); wss.close(); server.close(() => resolve()); }) };
}

afterEach(() => {
    for (const id of created.splice(0)) {
        for (const peerId of [...(roomManager.getRoom(id)?.peers.keys() || [])]) { stopAsr(null, id, peerId); roomManager.removePeer(id, peerId); }
        clearEmptyRoomCaptions(id);
    }
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetAsrCapabilities();
});

describe('server speech relay', () => {
    it('reports not configured so clients fall back to browser recognition', async () => {
        vi.stubEnv('ASR_URL', '');
        expect(await asrCapabilities()).toEqual({ configured: false });
        const peer = participant();
        await expect(startAsr(peer.ws, peer.roomId, peer.id, { language: 'hi' })).rejects.toThrow('not configured');
    });
    it('streams PCM to the speech service and turns results into attributed room captions', async () => {
        const asr = await fakeAsr();
        try {
            vi.stubEnv('ASR_URL', asr.url); vi.stubEnv('ASR_API_KEY', 'secret');
            expect(await asrCapabilities()).toMatchObject({ configured: true, available: true, autoDetect: true, languages: [{ code: 'hi', name: 'Hindi' }, { code: 'en', name: 'English' }] });
            const speaker = participant(); const listener = participant(speaker.roomId, 'Listener');
            await startAsr(speaker.ws, speaker.roomId, speaker.id, { language: 'auto' });
            expect(asr.received.url).toBe('/v1/stream?language=auto&sample_rate=16000');
            expect(asr.received.auth).toBe('Bearer secret');
            const pcm = Buffer.alloc(8000).toString('base64');
            expect(pushAsrAudio(speaker.ws, speaker.roomId, speaker.id, { seq: 1, pcm })).toEqual({ accepted: true });
            expect(pushAsrAudio(speaker.ws, speaker.roomId, speaker.id, { seq: 1, pcm })).toEqual({ accepted: false }); // duplicate
            await vi.waitFor(() => expect(sent(listener.ws, 'captionInterim')).toHaveLength(1));
            expect(sent(listener.ws, 'captionInterim')[0]).toMatchObject({ displayName: 'Asha', text: 'नमस्ते सब', language: 'hi' });
            stopAsr(speaker.ws, speaker.roomId, speaker.id);
            await vi.waitFor(() => expect(sent(listener.ws, 'captionReceived')).toHaveLength(1));
            expect(sent(listener.ws, 'captionReceived')[0]).toMatchObject({ displayName: 'Asha', text: 'नमस्ते सबको', language: 'hi', source: 'server' });
            expect(asr.received.bytes).toEqual([8000]);
        } finally { await asr.close(); }
    });
    it('never forwards audio while the server has the speaker muted, and rejects bad chunks', async () => {
        const asr = await fakeAsr();
        try {
            vi.stubEnv('ASR_URL', asr.url);
            const speaker = participant();
            await startAsr(speaker.ws, speaker.roomId, speaker.id, { language: 'hi' });
            roomManager.getRoom(speaker.roomId)!.peers.get(speaker.id)!.audioMuted = true;
            expect(pushAsrAudio(speaker.ws, speaker.roomId, speaker.id, { seq: 1, pcm: Buffer.alloc(100).toString('base64') })).toEqual({ accepted: false });
            roomManager.getRoom(speaker.roomId)!.peers.get(speaker.id)!.audioMuted = false;
            expect(pushAsrAudio(speaker.ws, speaker.roomId, speaker.id, { seq: 2, pcm: Buffer.alloc(101).toString('base64') })).toEqual({ accepted: false }); // odd byte count
            expect(() => pushAsrAudio(speaker.ws, speaker.roomId, speaker.id, { seq: 3, pcm: 'x'.repeat(50_000) })).toThrow('Invalid audio');
            const stranger = participant();
            expect(() => pushAsrAudio(stranger.ws, speaker.roomId, speaker.id, { seq: 4, pcm: 'AAAA' })).toThrow('Not joined');
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(asr.received.bytes).toEqual([]);
        } finally { await asr.close(); }
    });
});

describe('meeting minutes', () => {
    it('calls the configured OpenAI-compatible endpoint with the transcript', async () => {
        vi.stubEnv('MINUTES_LLM_URL', 'http://llm.local/v1/'); vi.stubEnv('MINUTES_LLM_MODEL', 'local-model'); vi.stubEnv('MINUTES_LLM_API_KEY', 'k');
        const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '## Summary\n- Budget approved' } }] }) });
        vi.stubGlobal('fetch', request);
        const entries = [{ id: '1', peerId: 'p', speaker: 'Asha', language: 'hi', text: 'बजट मंज़ूर है', timestamp: Date.UTC(2026, 10, 6, 10, 0, 0) }];
        await expect(generateMinutes(entries)).resolves.toBe('## Summary\n- Budget approved');
        const [url, init] = request.mock.calls[0];
        expect(url).toBe('http://llm.local/v1/chat/completions');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer k' });
        expect(JSON.parse(init.body).messages[1].content).toContain('[10:00:00] Asha (hi): बजट मंज़ूर है');
        expect(transcriptText(entries)).toBe('[10:00:00] Asha (hi): बजट मंज़ूर है');
    });
    it('fails clearly when not configured or empty', async () => {
        vi.stubEnv('MINUTES_LLM_URL', '');
        await expect(generateMinutes([])).rejects.toThrow('not configured');
        vi.stubEnv('MINUTES_LLM_URL', 'http://llm'); vi.stubEnv('MINUTES_LLM_MODEL', 'm');
        await expect(generateMinutes([])).rejects.toThrow('no transcript');
    });
});
