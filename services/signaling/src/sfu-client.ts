/**
 * SFU Client: HTTP wrapper to communicate with the SFU service.
 */
import { config } from './config.js';
import { logger } from './logger.js';

const SFU_BASE = config.sfuUrl;

async function sfuFetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${SFU_BASE}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`SFU request failed: ${res.status} ${body}`);
    }

    return res.json();
}

export const sfuClient = {
    getRtpCapabilities: (roomId: string) =>
        sfuFetch(`/api/rooms/${roomId}/rtp-capabilities`),

    createTransport: (roomId: string, peerId: string, displayName: string, direction: string) =>
        sfuFetch(`/api/rooms/${roomId}/transports`, {
            method: 'POST',
            body: JSON.stringify({ peerId, displayName, direction }),
        }),

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
