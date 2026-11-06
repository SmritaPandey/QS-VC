import { z } from 'zod';
import { googleLanguages, translateText, translationLanguage } from './translation.js';
import { roomManager } from './room-manager.js';
import { saveTranscript } from './transcript-store.js';

/**
 * Room captions: final segments are broadcast once, translated ONCE per language that someone
 * in the room has chosen, and pushed to those listeners (`captionTranslated`). Interim text is
 * relayed live but never stored or translated. Limits come from the environment.
 */
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/);
const segmentId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const publishSchema = z.object({ id: segmentId, text: z.string().trim().min(1).max(2000), language, isFinal: z.literal(true), allowGoogleTranslation: z.boolean().optional() });
const interimSchema = z.object({ id: segmentId, text: z.string().trim().min(1).max(500), language });
const translateSchema = z.object({ id: z.string().min(1).max(130), target: language });
const subscribeSchema = z.object({ targets: z.array(z.union([language, z.literal('original')])).max(2), allowGoogleTranslation: z.boolean().optional() });
const languageSchema = z.array(z.object({ code: language, name: z.string().min(1).max(100), targets: z.array(language).max(250).optional() })).min(1).max(250);
type Languages = z.infer<typeof languageSchema>;
export type Caption = { id: string; peerId: string; displayName: string; text: string; language: string; isFinal: true; timestamp: number; source: 'browser' | 'server' };
type StoredCaption = Caption & { allowGoogleTranslation: boolean };
export type TranscriptEntry = { id: string; peerId: string; speaker: string; language: string; text: string; timestamp: number };
type RoomCaptions = {
    meetingCode: string;
    captions: Map<string, StoredCaption>; translations: Map<string, string>; pending: Map<string, Promise<string>>;
    subscriptions: Map<string, Set<string>>; googleConsent: Set<string>;
    active: number; updated: number;
    transcript: TranscriptEntry[] | null; transcriptSince?: number;
};

function envInt(name: string, fallback: number, min: number, max: number) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
/** Read on every call so operators (and tests) can change limits without a rebuild. */
export function captionLimits() {
    return {
        maxRooms: envInt('CAPTION_MAX_ROOMS', 500, 1, 100_000),
        roomConcurrency: envInt('CAPTION_ROOM_CONCURRENCY', 8, 1, 256),
        globalConcurrency: envInt('CAPTION_GLOBAL_CONCURRENCY', 64, 1, 4096),
        peerPerMinute: envInt('CAPTION_PEER_TRANSLATIONS_PER_MINUTE', 240, 1, 100_000),
        publishIntervalMs: envInt('CAPTION_PUBLISH_INTERVAL_MS', 300, 0, 10_000),
        interimIntervalMs: envInt('CAPTION_INTERIM_INTERVAL_MS', 200, 0, 10_000),
        roomHistory: envInt('CAPTION_ROOM_HISTORY', 200, 10, 10_000),
        transcriptMax: envInt('TRANSCRIPT_MAX_SEGMENTS', 20_000, 100, 200_000),
    };
}

const googleEnabled = () => process.env.CAPTION_TRANSLATION_PROVIDER === 'google';
const rooms = new Map<string, RoomCaptions>();
const limits = new WeakMap<object, { published: number; interim: number; active: Set<string>; minute: number; count: number; capabilities: number }>();
let activeRequests = 0;
let capabilityCache: { url: string; expires: number; languages: Languages } | undefined;
let capabilityPending: { url: string; promise: Promise<Languages> } | undefined;

function member(ws: object | null, roomId: string, peerId: string) {
    const peer = roomManager.getRoom(roomId)?.peers.get(peerId);
    if (!peer || (ws !== null && peer.ws !== ws)) throw new Error('Not joined a room');
    return peer;
}
function quota(ws: object) {
    let state = limits.get(ws);
    if (!state) { state = { published: -Infinity, interim: -Infinity, active: new Set<string>(), minute: Date.now(), count: 0, capabilities: -Infinity }; limits.set(ws, state); }
    return state;
}
function roomState(roomId: string) {
    const now = Date.now();
    for (const [id, state] of rooms) {
        if (id === roomId || state.active) continue;
        if (now - state.updated > 600_000 || !roomManager.getRoom(id)?.peers.size) { void finishRoom(id, state); }
    }
    let state = rooms.get(roomId);
    if (!state) {
        if (rooms.size >= captionLimits().maxRooms) throw new Error('Caption capacity reached');
        state = { meetingCode: roomManager.getRoom(roomId)?.meetingCode || roomId, captions: new Map(), translations: new Map(), pending: new Map(), subscriptions: new Map(), googleConsent: new Set(), active: 0, updated: now, transcript: null };
        rooms.set(roomId, state);
    }
    state.updated = now;
    return state;
}
function configuredUrl() {
    const configured = process.env.LIBRETRANSLATE_URL;
    if (!configured) return undefined;
    try {
        const url = new URL(configured);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
        return url.href.replace(/\/$/, '');
    } catch { throw new Error('Translation configuration invalid'); }
}
async function providerJson(url: string, init?: RequestInit): Promise<unknown> {
    try {
        const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(Number(process.env.TRANSLATION_TIMEOUT_MS) || 8000) });
        if (!response.ok) throw new Error('Provider failed');
        const body = await response.text();
        if (body.length > 100_000) throw new Error('Provider response too large');
        return JSON.parse(body);
    } catch { throw new Error('Translation unavailable: configured server request failed'); }
}
async function supportedLanguages(url: string) {
    if (capabilityCache?.url === url && capabilityCache.expires > Date.now()) return capabilityCache.languages;
    if (capabilityPending?.url === url) return capabilityPending.promise;
    if (capabilityPending) throw new Error('Translation capability lookup busy');
    const promise = providerJson(`${url}/languages`).then(result => {
        const parsed = languageSchema.safeParse(result);
        if (!parsed.success) throw new Error('Translation unavailable: invalid language capabilities');
        capabilityCache = { url, expires: Date.now() + 60_000, languages: parsed.data };
        return parsed.data;
    }).finally(() => { capabilityPending = undefined; });
    capabilityPending = { url, promise };
    return promise;
}
async function providerLanguages(): Promise<{ key: string; languages: Languages }> {
    if (googleEnabled()) return { key: 'google-cloud', languages: await googleLanguages() };
    const url = configuredUrl();
    if (!url) throw new Error('Translation unavailable: no configured server');
    return { key: url, languages: await supportedLanguages(url) };
}

/** One translation of one stored caption into one target, shared by every listener. */
async function translateStored(state: RoomCaptions, caption: StoredCaption, target: string): Promise<string> {
    const google = googleEnabled();
    if (google && !caption.allowGoogleTranslation) throw new Error('The speaker has not enabled Google Cloud translation');
    const { key: providerKey, languages } = await providerLanguages();
    const key = `${providerKey}:${caption.id}:${target}`;
    const cached = state.translations.get(key);
    if (cached) return cached;
    let pending = state.pending.get(key);
    if (!pending) {
        pending = (async () => {
            if (google) {
                if (translationLanguage(caption.language) === translationLanguage(target)) return caption.text;
                return (await translateText(caption.text, caption.language, target, languages)).translatedText;
            }
            const normalize = (code: string) => languages.find(item => item.code === code) || languages.find(item => item.code === code.split('-')[0]);
            const source = normalize(caption.language);
            const destination = normalize(target);
            if (!source || !destination || (source.code !== destination.code && source.targets && !source.targets.includes(destination.code))) throw new Error('Language pair unavailable on configured server');
            if (source.code === destination.code) return caption.text;
            const result = await providerJson(`${providerKey}/translate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: caption.text, source: source.code, target: destination.code, format: 'text', ...(process.env.LIBRETRANSLATE_API_KEY ? { api_key: process.env.LIBRETRANSLATE_API_KEY } : {}) }),
            });
            const text = (result as { translatedText?: unknown })?.translatedText;
            if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('Translation unavailable: invalid server result');
            return text;
        })().then(text => {
            state.translations.set(key, text);
            if (state.translations.size > 600) state.translations.delete(state.translations.keys().next().value!);
            return text;
        }).finally(() => { state.pending.delete(key); });
        state.pending.set(key, pending);
    }
    return pending;
}

const sameLanguage = (a: string, b: string) => a === b || a.split('-')[0] === b.split('-')[0];

/** Push translations to everyone who chose a language. Bounded by room/global concurrency. */
async function fanOut(roomId: string, state: RoomCaptions, caption: StoredCaption) {
    const byTarget = new Map<string, string[]>();
    for (const [peerId, targets] of state.subscriptions) {
        for (const target of targets) {
            if (target === 'original' || sameLanguage(target, caption.language)) continue;
            byTarget.set(target, [...(byTarget.get(target) || []), peerId]);
        }
    }
    if (!byTarget.size) return;
    const { roomConcurrency, globalConcurrency } = captionLimits();
    await Promise.all([...byTarget].map(async ([target, peers]) => {
        const send = (method: string, params: object) => { for (const peerId of peers) roomManager.sendToPeer(roomId, peerId, method, params); };
        if (state.active >= roomConcurrency || activeRequests >= globalConcurrency) {
            send('captionTranslationFailed', { id: caption.id, target, reason: 'busy' });
            return;
        }
        state.active++; activeRequests++;
        try {
            const translatedText = await translateStored(state, caption, target);
            send('captionTranslated', { id: caption.id, target, translatedText, sourceLanguage: caption.language, peerId: caption.peerId, displayName: caption.displayName, timestamp: caption.timestamp });
        } catch (error) {
            send('captionTranslationFailed', { id: caption.id, target, reason: error instanceof Error && /not enabled Google/.test(error.message) ? 'consent' : 'unavailable' });
        } finally { state.active--; activeRequests--; }
    }));
}

function store(roomId: string, state: RoomCaptions, caption: StoredCaption) {
    state.captions.set(caption.id, caption);
    if (state.captions.size > captionLimits().roomHistory) state.captions.delete(state.captions.keys().next().value!);
    if (state.transcript) {
        state.transcript.push({ id: caption.id, peerId: caption.peerId, speaker: caption.displayName, language: caption.language, text: caption.text, timestamp: caption.timestamp });
        if (state.transcript.length > captionLimits().transcriptMax) state.transcript.shift();
    }
    const { allowGoogleTranslation: _private, ...publicCaption } = caption;
    roomManager.broadcast(roomId, 'captionReceived', publicCaption);
    void fanOut(roomId, state, caption);
}

export function publishCaption(ws: object, roomId: string, peerId: string, params: unknown) {
    const peer = member(ws, roomId, peerId);
    if (peer.audioMuted) throw new Error('Unmute your microphone before sharing captions');
    const parsed = publishSchema.safeParse(params);
    if (!parsed.success) throw new Error('Invalid final caption');
    const state = roomState(roomId);
    const id = `${peerId}:${parsed.data.id}`;
    const existing = state.captions.get(id);
    if (existing) {
        if (existing.text !== parsed.data.text || existing.language !== parsed.data.language) throw new Error('Final caption cannot be changed');
        return { accepted: true, id };
    }
    const rate = quota(ws);
    if (Date.now() - rate.published < captionLimits().publishIntervalMs) throw new Error('Caption rate limit reached');
    rate.published = Date.now();
    const { allowGoogleTranslation, ...textFields } = parsed.data;
    store(roomId, state, { ...textFields, id, peerId, displayName: peer.displayName, timestamp: Date.now(), source: 'browser', allowGoogleTranslation: allowGoogleTranslation === true || state.googleConsent.has(peerId) });
    return { accepted: true, id };
}

/** Final segment produced by the server speech service for a peer (identity from membership). */
export function publishServerCaption(roomId: string, peerId: string, segment: { id: string; text: string; language: string }) {
    const peer = member(null, roomId, peerId);
    if (peer.audioMuted) return null;
    const text = segment.text.trim().slice(0, 2000);
    if (!text || !language.safeParse(segment.language).success || !segmentId.safeParse(segment.id).success) return null;
    const state = roomState(roomId);
    const id = `${peerId}:${segment.id}`;
    if (state.captions.has(id)) return id;
    store(roomId, state, { id, peerId, displayName: peer.displayName, text, language: segment.language, isFinal: true, timestamp: Date.now(), source: 'server', allowGoogleTranslation: state.googleConsent.has(peerId) });
    return id;
}

/** Live (not yet final) text. Relayed to others only; never stored, translated or saved. */
export function publishInterim(ws: object, roomId: string, peerId: string, params: unknown) {
    const peer = member(ws, roomId, peerId);
    if (peer.audioMuted) return { accepted: false };
    const parsed = interimSchema.safeParse(params);
    if (!parsed.success) throw new Error('Invalid interim caption');
    const rate = quota(ws);
    if (Date.now() - rate.interim < captionLimits().interimIntervalMs) return { accepted: false };
    rate.interim = Date.now();
    roomManager.broadcast(roomId, 'captionInterim', { id: `${peerId}:${parsed.data.id}`, peerId, displayName: peer.displayName, text: parsed.data.text, language: parsed.data.language }, peerId);
    return { accepted: true };
}
export function publishServerInterim(roomId: string, peerId: string, segment: { id: string; text: string; language: string }) {
    const peer = roomManager.getRoom(roomId)?.peers.get(peerId);
    if (!peer || peer.audioMuted || !segment.text.trim()) return;
    roomManager.broadcast(roomId, 'captionInterim', { id: `${peerId}:${segment.id}`, peerId, displayName: peer.displayName, text: segment.text.trim().slice(0, 500), language: segment.language }, peerId);
}

/** A listener chooses up to two output languages (captions + spoken). */
export function subscribeCaptions(ws: object, roomId: string, peerId: string, params: unknown) {
    member(ws, roomId, peerId);
    const parsed = subscribeSchema.safeParse(params);
    if (!parsed.success) throw new Error('Invalid caption languages');
    const state = roomState(roomId);
    const targets = new Set(parsed.data.targets.filter(target => target !== 'original'));
    if (targets.size) state.subscriptions.set(peerId, targets); else state.subscriptions.delete(peerId);
    if (parsed.data.allowGoogleTranslation === true) state.googleConsent.add(peerId);
    if (parsed.data.allowGoogleTranslation === false) state.googleConsent.delete(peerId);
    return { targets: [...targets] };
}

export async function translationCapabilities(ws: object, roomId: string, peerId: string) {
    member(ws, roomId, peerId);
    const transcript = { saving: Boolean(rooms.get(roomId)?.transcript) };
    if (googleEnabled()) {
        const configured = Boolean(process.env.GOOGLE_TRANSLATE_API_KEY?.trim());
        return { configured, languages: configured ? await googleLanguages() : [], processing: 'google-cloud' as const, transcript };
    }
    const url = configuredUrl();
    if (url && !(capabilityCache?.url === url && capabilityCache.expires > Date.now())) {
        const rate = quota(ws);
        if (Date.now() - rate.capabilities < 2000) throw new Error('Translation capability rate limit reached');
        rate.capabilities = Date.now();
    }
    return { configured: Boolean(url), languages: url ? await supportedLanguages(url) : [], processing: 'configured-server' as const, transcript };
}

/** Pull API kept for older clients; new clients receive `captionTranslated` pushes. */
export async function translateCaption(ws: object, roomId: string, peerId: string, params: unknown) {
    member(ws, roomId, peerId);
    const parsed = translateSchema.safeParse(params);
    if (!parsed.success) throw new Error('Invalid translation request');
    const state = roomState(roomId);
    const caption = state.captions.get(parsed.data.id);
    if (!caption) throw new Error('Final caption not found in this room');
    if (googleEnabled() && !caption.allowGoogleTranslation) throw new Error('The speaker has not enabled Google Cloud translation');
    if (!googleEnabled() && !configuredUrl()) throw new Error('Translation unavailable: no configured server');
    const { roomConcurrency, globalConcurrency, peerPerMinute } = captionLimits();
    const rate = quota(ws);
    if (Date.now() - rate.minute >= 60_000) { rate.minute = Date.now(); rate.count = 0; }
    const key = `${caption.id}:${parsed.data.target}`;
    if (rate.active.has(key) || rate.active.size >= 4 || rate.count >= peerPerMinute || state.active >= roomConcurrency || activeRequests >= globalConcurrency) throw new Error('Translation rate limit reached');
    rate.active.add(key); rate.count++;
    state.active++; activeRequests++;
    try {
        const translatedText = await translateStored(state, caption, parsed.data.target);
        member(ws, roomId, peerId);
        return { translatedText, sourceLanguage: caption.language, targetLanguage: parsed.data.target };
    } finally {
        rate.active.delete(key); state.active--; activeRequests--;
    }
}

// ── Transcript (host opt-in) ─────────────────────────────────────────────

export function setTranscriptSaving(roomId: string, enabled: boolean) {
    const state = roomState(roomId);
    if (enabled && !state.transcript) { state.transcript = []; state.transcriptSince = Date.now(); }
    if (!enabled && state.transcript) { void saveTranscript(state.meetingCode, state.transcript, state.transcriptSince!); state.transcript = null; }
    roomManager.broadcast(roomId, 'transcriptStateChanged', { saving: enabled });
    return { saving: enabled };
}
export function transcriptEntries(roomId: string): { saving: boolean; since?: number; entries: TranscriptEntry[] } {
    const state = rooms.get(roomId);
    if (!state?.transcript) return { saving: false, entries: [] };
    return { saving: true, since: state.transcriptSince, entries: state.transcript.slice() };
}

async function finishRoom(roomId: string, state: RoomCaptions) {
    rooms.delete(roomId);
    if (state.transcript?.length) await saveTranscript(state.meetingCode, state.transcript, state.transcriptSince!);
}

export function forgetPeerCaptions(roomId: string, peerId: string) {
    const state = rooms.get(roomId);
    state?.subscriptions.delete(peerId);
    state?.googleConsent.delete(peerId);
}

export function clearEmptyRoomCaptions(roomId: string) {
    const state = rooms.get(roomId);
    if (state && !roomManager.getRoom(roomId)?.peers.size) void finishRoom(roomId, state);
}
