import { z } from 'zod';
import { roomManager } from './room-manager.js';

const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/);
const publishSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), text: z.string().trim().min(1).max(2000), language, isFinal: z.literal(true) });
const translateSchema = z.object({ id: z.string().min(1).max(130), target: language });
const languageSchema = z.array(z.object({ code: language, name: z.string().min(1).max(100), targets: z.array(language).max(250).optional() })).min(1).max(250);
type Caption = { id: string; peerId: string; displayName: string; text: string; language: string; isFinal: true; timestamp: number };
type RoomCaptions = { captions: Map<string, Caption>; translations: Map<string, string>; pending: Map<string, Promise<string>>; active: number; updated: number };
const rooms = new Map<string, RoomCaptions>();
const limits = new WeakMap<object, { published: number; translated: number; active: boolean; minute: number; count: number; capabilities: number }>();
let activeRequests = 0;
let capabilityCache: { url: string; expires: number; languages: z.infer<typeof languageSchema> } | undefined;
let capabilityPending: { url: string; promise: Promise<z.infer<typeof languageSchema>> } | undefined;

function member(ws: object, roomId: string, peerId: string) {
    const peer = roomManager.getRoom(roomId)?.peers.get(peerId);
    if (!peer || peer.ws !== ws) throw new Error('Not joined a room');
    return peer;
}
function quota(ws: object) {
    let state = limits.get(ws);
    if (!state) { state = { published: -Infinity, translated: -Infinity, active: false, minute: Date.now(), count: 0, capabilities: -Infinity }; limits.set(ws, state); }
    return state;
}
function roomState(roomId: string) {
    const now = Date.now();
    for (const [id, state] of rooms) if (!state.active && (now - state.updated > 600_000 || !roomManager.getRoom(id)?.peers.size)) rooms.delete(id);
    let state = rooms.get(roomId);
    if (!state) {
        if (rooms.size >= 50) throw new Error('Caption capacity reached');
        state = { captions: new Map(), translations: new Map(), pending: new Map(), active: 0, updated: now };
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
        const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
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
    if (Date.now() - rate.published < 500) throw new Error('Caption rate limit reached');
    rate.published = Date.now();
    const caption: Caption = { ...parsed.data, id, peerId, displayName: peer.displayName, timestamp: Date.now() };
    state.captions.set(id, caption);
    if (state.captions.size > 100) state.captions.delete(state.captions.keys().next().value!);
    roomManager.broadcast(roomId, 'captionReceived', caption);
    return { accepted: true, id };
}
export async function translationCapabilities(ws: object, roomId: string, peerId: string) {
    member(ws, roomId, peerId);
    const url = configuredUrl();
    if (url && !(capabilityCache?.url === url && capabilityCache.expires > Date.now())) {
        const rate = quota(ws);
        if (Date.now() - rate.capabilities < 2000) throw new Error('Translation capability rate limit reached');
        rate.capabilities = Date.now();
    }
    return { configured: Boolean(url), languages: url ? await supportedLanguages(url) : [], processing: 'configured-server' as const };
}
export async function translateCaption(ws: object, roomId: string, peerId: string, params: unknown) {
    member(ws, roomId, peerId);
    const parsed = translateSchema.safeParse(params);
    if (!parsed.success) throw new Error('Invalid translation request');
    const state = roomState(roomId);
    const caption = state.captions.get(parsed.data.id);
    if (!caption) throw new Error('Final caption not found in this room');
    const url = configuredUrl();
    if (!url) throw new Error('Translation unavailable: no configured server');
    const rate = quota(ws);
    if (Date.now() - rate.minute >= 60_000) { rate.minute = Date.now(); rate.count = 0; }
    const key = `${url}:${caption.id}:${parsed.data.target}`;
    const cached = state.translations.get(key);
    if (cached) return { translatedText: cached, sourceLanguage: caption.language, targetLanguage: parsed.data.target };
    if (rate.active || rate.count >= 30 || state.active >= 4 || activeRequests >= 16) throw new Error('Translation rate limit reached');
    rate.active = true; rate.translated = Date.now(); rate.count++;
    state.active++; activeRequests++;
    try {
        let pending = state.pending.get(key);
        if (!pending) {
            pending = (async () => {
                const languages = await supportedLanguages(url);
                member(ws, roomId, peerId);
                const normalize = (code: string) => languages.find(item => item.code === code) || languages.find(item => item.code === code.split('-')[0]);
                const source = normalize(caption.language);
                const target = normalize(parsed.data.target);
                if (!source || !target || (source.code !== target.code && source.targets && !source.targets.includes(target.code))) throw new Error('Language pair unavailable on configured server');
                if (source.code === target.code) return caption.text;
                const result = await providerJson(`${url}/translate`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: caption.text, source: source.code, target: target.code, format: 'text', ...(process.env.LIBRETRANSLATE_API_KEY ? { api_key: process.env.LIBRETRANSLATE_API_KEY } : {}) }),
                });
                const text = (result as { translatedText?: unknown })?.translatedText;
                if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('Translation unavailable: invalid server result');
                return text;
            })();
            state.pending.set(key, pending);
        }
        const translatedText = await pending;
        member(ws, roomId, peerId);
        state.translations.set(key, translatedText);
        if (state.translations.size > 200) state.translations.delete(state.translations.keys().next().value!);
        return { translatedText, sourceLanguage: caption.language, targetLanguage: parsed.data.target };
    } finally {
        state.pending.delete(key); rate.active = false; state.active--; activeRequests--;
    }
}
export function clearEmptyRoomCaptions(roomId: string) {
    if (!roomManager.getRoom(roomId)?.peers.size) rooms.delete(roomId);
}
