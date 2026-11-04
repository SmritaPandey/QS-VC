/**
 * SFU Client: HTTP wrapper to communicate with the SFU service.
 */
import { config } from './config.js';
import { logger } from './logger.js';

const SFU_BASE = config.sfuUrl;

/** Join-time probes fail fast (signaling-only fallback); media calls get time to finish under load. */
const PROBE_TIMEOUT_MS = 2500;
const MEDIA_TIMEOUT_MS = 8000;

async function sfuFetch(path: string, options: RequestInit = {}, timeoutMs = MEDIA_TIMEOUT_MS): Promise<any> {
    const url = `${SFU_BASE}${path}`;
    // A 1 s limit on every call made produce/consume fail whenever the SFU was briefly busy
    // (several people joining, a camera starting), which left people without audio/video.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
            redirect: 'error',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
                ...(process.env.SFU_CONTROL_TOKEN ? { Authorization: `Bearer ${process.env.SFU_CONTROL_TOKEN}` } : {}),
            },
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`SFU request failed: ${res.status} ${body}`);
        }

        return res.json();
    } finally {
        clearTimeout(timeout);
    }
}

export const sfuClient = {
    polySnapshot: (roomId: string) => sfuFetch(`/api/poly/rooms/${encodeURIComponent(roomId)}/snapshot`, {}, PROBE_TIMEOUT_MS),
    polyLobbyAction: (roomId: string, callId: string, action: 'admit' | 'deny') =>
        sfuFetch(`/api/poly/rooms/${encodeURIComponent(roomId)}/lobby/${encodeURIComponent(callId)}/${action}`, { method: 'POST' }),
    stopPolyRoom: (roomId: string) =>
        sfuFetch(`/api/poly/rooms/${encodeURIComponent(roomId)}/stop`, { method: 'POST' }),

    getRtpCapabilities: (roomId: string) =>
        sfuFetch(`/api/rooms/${roomId}/rtp-capabilities`, {}, PROBE_TIMEOUT_MS),

    createTransport: (roomId: string, peerId: string, displayName: string, direction: string) =>
        sfuFetch(`/api/rooms/${roomId}/transports`, {
            method: 'POST',
            body: JSON.stringify({ peerId, displayName, direction }),
        }, PROBE_TIMEOUT_MS),

    connectTransport: (roomId: string, transportId: string, peerId: string, dtlsParameters: any) =>
        sfuFetch(`/api/rooms/${roomId}/transports/${transportId}/connect`, {
            method: 'POST',
            body: JSON.stringify({ peerId, dtlsParameters }),
        }),

    produce: (roomId: string, peerId: string, transportId: string, kind: string, rtpParameters: any, appData: any) =>
        sfuFetch(`/api/rooms/${roomId}/produce`, {
            method: 'POST',
            body: JSON.stringify({ peerId, transportId, kind, rtpParameters, appData }),
        }),

    consume: (roomId: string, consumerPeerId: string, producerPeerId: string, producerId: string, rtpCapabilities: any) =>
        sfuFetch(`/api/rooms/${roomId}/consume`, {
            method: 'POST',
            body: JSON.stringify({ consumerPeerId, producerPeerId, producerId, rtpCapabilities }),
        }),

    resumeConsumer: (roomId: string, consumerId: string, peerId: string) =>
        sfuFetch(`/api/rooms/${roomId}/consumers/${consumerId}/resume`, {
            method: 'POST',
            body: JSON.stringify({ peerId }),
        }),

    removePeer: (roomId: string, peerId: string) =>
        sfuFetch(`/api/rooms/${roomId}/peers/${peerId}`, { method: 'DELETE' }),

    getRoomInfo: (roomId: string) =>
        sfuFetch(`/api/rooms/${roomId}`),
};
