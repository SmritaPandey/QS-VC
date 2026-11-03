import http from 'http';
import path from 'path';
import { pathToFileURL } from 'url';
import pino from 'pino';

const logger = pino({ name: 'qsvc-meeting-signaling-bridge' });

/** Attach signaling WebSocket when bundled signaling dist is present (production image). */
export async function attachSignalingIfAvailable(server: http.Server): Promise<boolean> {
    const signalingPath = process.env.SIGNALING_DIST
        || path.join(process.cwd(), 'signaling-dist', 'ws-attach.js');

    try {
        if (process.env.SIGNALING_DIST && !process.env.MEETING_INTERNAL_URL) {
            process.env.MEETING_INTERNAL_URL = `http://127.0.0.1:${process.env.PORT || process.env.MEETING_PORT || '4003'}`;
        }
        const mod = await import(pathToFileURL(signalingPath).href);
        if (typeof mod.attachSignalingWebSocket !== 'function') {
            throw new Error('attachSignalingWebSocket export missing');
        }
        mod.attachSignalingWebSocket(server);
        logger.info(`WebSocket signaling attached at /ws (${signalingPath})`);
        return true;
    } catch (err: any) {
        if (process.env.SIGNALING_DIST) throw err;
        logger.warn(`Signaling WebSocket unavailable: ${err.message}`);
        return false;
    }
}
