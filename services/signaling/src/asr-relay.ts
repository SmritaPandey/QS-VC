import WebSocket from 'ws';
import { z } from 'zod';
import { roomManager } from './room-manager.js';
import { publishServerCaption, publishServerInterim } from './captions.js';
import { logger } from './logger.js';

/**
 * Server speech recognition relay. The browser streams 16 kHz mono PCM from the SAME microphone
 * track the meeting uses; signaling forwards it over the private network to the QS-VC speech
 * service (services/asr) and turns its partial/final results into room captions.
 *
 * Speech service protocol (see services/asr/README.md):
 *   WS  {ASR_URL}/v1/stream?language=<bcp47|auto>&sample_rate=16000   binary s16le frames in,
 *       JSON {type:'partial'|'final', segment, text, language} out.
 *   GET {ASR_URL}/v1/languages → {languages:[{code,name}], autoDetect, engine, model}
 */
const startSchema = z.object({ processorConsent: z.literal(true), language: z.union([z.literal('auto'), z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/)]) }).strict();
const audioSchema = z.object({ seq: z.number().int().min(0), pcm: z.string().min(4).max(48_000) }).strict();
const resultSchema = z.object({ type: z.enum(['partial', 'final', 'error', 'ready']), segment: z.number().int().min(0).optional(), text: z.string().max(4000).optional(), language: z.string().max(20).optional(), message: z.string().max(300).optional() });
const capabilitySchema = z.object({ languages: z.array(z.object({ code: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/), name: z.string().max(100) })).max(300), autoDetect: z.boolean().optional(), engine: z.string().max(60).optional(), model: z.string().max(120).optional() });

type Session = { upstream: WebSocket; roomId: string; peerId: string; language: string; seq: number; id: number; ready: Promise<void>; closed: boolean; stopping: boolean };
const sessions = new Map<string, Session>();
let counter = 0;
let capabilityCache: { expires: number; value: z.infer<typeof capabilitySchema> | null } | undefined;

const key = (roomId: string, peerId: string) => `${roomId}\u0000${peerId}`;
function baseUrl() {
    const raw = process.env.ASR_URL?.trim();
    if (!raw) return undefined;
    const url = new URL(raw);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Speech service configuration invalid');
    return url.href.replace(/\/$/, '');
}
const httpUrl = (base: string) => base.replace(/^ws/, 'http');
const wsUrl = (base: string) => base.replace(/^http/, 'ws');
const authHeaders = (): Record<string, string> => process.env.ASR_API_KEY ? { Authorization: `Bearer ${process.env.ASR_API_KEY}` } : {};
const maxSessions = () => Math.max(1, Number.parseInt(process.env.ASR_MAX_SESSIONS || '', 10) || 50);

/** What the room's speech service can do, or {configured:false} so the client uses browser recognition. */
export async function asrCapabilities() {
    let base: string | undefined;
    try { base = baseUrl(); } catch { return { configured: false as const, error: 'invalid-configuration' }; }
    if (!base) return { configured: false as const };
    if (!capabilityCache || capabilityCache.expires < Date.now()) {
        try {
            const response = await fetch(`${httpUrl(base)}/v1/languages`, { headers: authHeaders(), signal: AbortSignal.timeout(4000), redirect: 'error' });
            const parsed = capabilitySchema.safeParse(response.ok ? await response.json() : null);
            capabilityCache = { expires: Date.now() + (parsed.success ? 60_000 : 10_000), value: parsed.success ? parsed.data : null };
        } catch { capabilityCache = { expires: Date.now() + 10_000, value: null }; }
    }
    const value = capabilityCache.value;
    if (!value) return { configured: true as const, available: false as const };
    return { configured: true as const, available: true as const, languages: value.languages, autoDetect: value.autoDetect !== false, engine: value.engine, model: value.model };
}
export function resetAsrCapabilities() { capabilityCache = undefined; }

function member(ws: object, roomId: string, peerId: string) {
    const peer = roomManager.getRoom(roomId)?.peers.get(peerId);
    if (!peer || peer.ws !== ws) throw new Error('Not joined a room');
    return peer;
}

export async function startAsr(ws: object, roomId: string, peerId: string, params: unknown) {
    const peer = member(ws, roomId, peerId);
    const parsed = startSchema.safeParse(params);
    if (!parsed.success) throw new Error('Explicit transcription processor consent is required');
    if (peer.audioMuted) throw new Error('Unmute your microphone before sharing captions');
    const base = baseUrl();
    if (!base) throw new Error('Server speech recognition is not configured');
    stopAsr(ws, roomId, peerId);
    if (sessions.size >= maxSessions()) throw new Error('Speech recognition is at capacity. Try again shortly.');
    const id = ++counter;
    const url = `${wsUrl(base)}/v1/stream?language=${encodeURIComponent(parsed.data.language)}&sample_rate=16000`;
    const upstream = new WebSocket(url, { headers: authHeaders(), maxPayload: 256 * 1024, handshakeTimeout: 5000 });
    const session: Session = { upstream, roomId, peerId, language: parsed.data.language, seq: -1, id, closed: false, stopping: false, ready: Promise.resolve() };
    session.ready = new Promise<void>((resolve, reject) => {
        upstream.once('open', () => resolve());
        upstream.once('error', () => reject(new Error('Speech service is unavailable')));
    });
    sessions.set(key(roomId, peerId), session);
    upstream.on('message', (data, isBinary) => {
        if (isBinary || session.closed) return; // results still arrive while a stopped session flushes
        let message: z.infer<typeof resultSchema>;
        try { const parsedResult = resultSchema.safeParse(JSON.parse(data.toString())); if (!parsedResult.success) return; message = parsedResult.data; } catch { return; }
        const language = message.language && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(message.language) ? message.language : (session.language === 'auto' ? 'en' : session.language);
        const segment = { id: `asr${session.id}-${message.segment ?? 0}`, text: message.text || '', language };
        try {
            if (message.type === 'partial') publishServerInterim(roomId, peerId, segment);
            else if (message.type === 'final' && segment.text.trim()) publishServerCaption(roomId, peerId, segment);
            else if (message.type === 'error') roomManager.sendToPeer(roomId, peerId, 'asrError', { message: 'Speech recognition stopped on the server.' });
        } catch (err) { logger.warn({ err: err instanceof Error ? err.message : err }, 'ASR result dropped'); }
    });
    upstream.on('close', () => {
        if (sessions.get(key(roomId, peerId)) === session) sessions.delete(key(roomId, peerId));
        if (!session.stopping) roomManager.sendToPeer(roomId, peerId, 'asrStopped', { reason: 'service-closed' });
        session.closed = true;
        announceProcessorState(roomId);
    });
    upstream.on('error', () => { /* reported via ready/close */ });
    try { await session.ready; } catch (error) {
        if (sessions.get(key(roomId, peerId)) === session) stopAsr(ws, roomId, peerId, true);
        throw error;
    }
    if (session.closed || session.stopping) throw new Error('Transcription was stopped');
    announceProcessorState(roomId);
    return { started: true, language: parsed.data.language };
}

export function pushAsrAudio(ws: object, roomId: string, peerId: string, params: unknown) {
    const peer = member(ws, roomId, peerId);
    const session = sessions.get(key(roomId, peerId));
    if (!session || session.closed || session.stopping) return { accepted: false, reason: 'not-started' };
    const parsed = audioSchema.safeParse(params);
    if (!parsed.success) throw new Error('Invalid audio chunk');
    // Never forward audio the server knows is muted, and drop out-of-order/duplicate chunks.
    if (peer.audioMuted || parsed.data.seq <= session.seq) return { accepted: false };
    session.seq = parsed.data.seq;
    const pcm = Buffer.from(parsed.data.pcm, 'base64');
    if (pcm.length === 0 || pcm.length > 32_000 || pcm.length % 2) return { accepted: false };
    if (session.upstream.readyState !== WebSocket.OPEN || session.upstream.bufferedAmount > 512 * 1024) return { accepted: false, reason: 'busy' };
    session.upstream.send(pcm, { binary: true });
    return { accepted: true };
}

export function stopAsr(ws: object | null, roomId: string, peerId: string, discard = false) {
    const session = sessions.get(key(roomId, peerId));
    if (!session) return { stopped: false };
    if (ws) member(ws, roomId, peerId);
    session.stopping = true;
    sessions.delete(key(roomId, peerId));
    if (discard) session.closed = true;
    announceProcessorState(roomId);
    try {
        if (discard) session.upstream.terminate();
        else if (session.upstream.readyState === WebSocket.OPEN) { session.upstream.send(JSON.stringify({ type: 'stop' })); setTimeout(() => session.upstream.close(), 1500).unref?.(); }
        else session.upstream.terminate();
    } catch { /* already closed */ }
    return { stopped: true };
}

/** Called on disconnect and when the server mutes a peer. */
export function stopAsrForPeer(roomId: string, peerId: string) { stopAsr(null, roomId, peerId, true); }
export function activeAsrSessions() { return sessions.size; }

/** Processor access is visible to all participants, including late joiners. */
export function asrParticipants(roomId: string) {
    return [...sessions.values()].filter(session => session.roomId === roomId && !session.closed && !session.stopping)
        .map(session => ({ peerId: session.peerId, displayName: roomManager.getRoom(roomId)?.peers.get(session.peerId)?.displayName || 'Participant' }));
}
function announceProcessorState(roomId: string) {
    roomManager.broadcast(roomId, 'captionProcessorState', { participants: asrParticipants(roomId) });
}
