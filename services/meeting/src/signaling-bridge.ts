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
        const mod = await import(pathToFileURL(signalingPath).href);
        if (typeof mod.attachSignalingWebSocket !== 'function') {
            throw new Error('attachSignalingWebSocket export missing');
        }
        mod.attachSignalingWebSocket(server);
        logger.info(`WebSocket signaling attached at /ws (${signalingPath})`);
        return true;
    } catch (err: any) {
        logger.warn(`Signaling WebSocket unavailable: ${err.message}`);
        return false;
    }
}
