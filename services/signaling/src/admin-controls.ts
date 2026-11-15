import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { RoomManager } from './room-manager.js';
import { InvalidAuthentication } from './ws-attach.js';

type Identity = { sub: string; tenantId: string; role: string };
type Audit = { actorId: string; tenantId: string; roomId: string; peerId: string; kind: 'audio' | 'video'; outcome: 'paused' | 'failed'; producerCount: number };
type Dependencies = {
    rooms: Pick<RoomManager, 'getRooms' | 'getRoom' | 'broadcast' | 'sendToPeer'>;
    verify: (token: string) => Promise<Identity>;
    pause: (roomId: string, peerId: string, producerId: string, paused: boolean) => Promise<unknown>;
    audit: (event: Audit) => void;
    authUrl: string;
};
const actionBody = z.object({ kind: z.enum(['audio', 'video']), muted: z.literal(true) }).strict();

/** Platform operators can stop current public media; participants retain control of enabling it. */
export function adminControlsRouter({ rooms, verify, pause, audit, authUrl }: Dependencies) {
    const router = Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
    router.use(async (req, res, next) => {
        const authorization = req.headers.authorization;
        if (!authorization?.startsWith('Bearer ') || !authorization.slice(7)) return res.status(401).json({ error: 'Sign in as a platform administrator.' });
        try {
            const user = await verify(authorization.slice(7));
            if (!user.sub || !user.tenantId) throw new Error('Invalid verified identity');
            if (user.role !== 'admin') return res.status(403).json({ error: 'Platform administrator access is required.' });
            const response = await fetch(`${authUrl.replace(/\/$/, '')}/api/auth/me`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(3000), redirect: 'error' });
            if (response.status === 401) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
            if (response.status === 403) return res.status(403).json({ error: 'Platform administrator access is required.' });
            if (!response.ok) throw new Error('Profile unavailable');
            const profile = await response.json() as { id?: string; tenantId?: string; role?: string; isPlatformAdmin?: boolean };
            if (profile.id !== user.sub || profile.tenantId !== user.tenantId || profile.role !== 'admin' || profile.isPlatformAdmin !== true) {
                return res.status(403).json({ error: 'Platform administrator access is required.' });
            }
            res.locals.admin = user;
            next();
        } catch (error) {
            return res.status(error instanceof InvalidAuthentication ? 401 : 503).json({ error: error instanceof InvalidAuthentication ? 'Your session expired. Sign in again.' : 'Administrator verification is temporarily unavailable.' });
        }
    });
    router.get('/', (_req, res) => res.json({ rooms: rooms.getRooms().filter(room => room.peers.size > 0).map(room => ({
        id: room.id, meetingCode: room.meetingCode, startedAt: room.createdAt.toISOString(),
        participants: [...room.peers.values()].map(peer => ({ id: peer.id, displayName: peer.displayName, role: peer.role, audioMuted: peer.audioMuted, videoOff: peer.videoOff })),
    })), scope: 'Live rooms on this signaling server. Microphone actions exclude private conversations and screen audio; camera actions include all cameras and exclude screen sharing.' }));
    router.post('/:roomId/peers/:peerId/media', async (req, res) => {
        const parsed = actionBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Choose microphone mute or camera off. Remote enabling is unavailable.' });
        const roomId = String(req.params.roomId), peerId = String(req.params.peerId);
        const room = rooms.getRoom(roomId), peer = room?.peers.get(peerId);
        if (!room || !peer) return res.status(404).json({ error: 'This participant is no longer in a live room.' });
        const { kind } = parsed.data;
        const producers = [...peer.producers.values()].filter(producer => producer.kind === kind && producer.appData?.type !== 'private-audio' && producer.appData?.type !== 'screen' && producer.appData?.source !== 'screen');
        const admin = res.locals.admin as Identity;
        const results = await Promise.allSettled(producers.map(producer => pause(roomId, peerId, producer.id, true)));
        const failed = results.some(result => result.status === 'rejected');
        audit({ actorId: admin.sub, tenantId: admin.tenantId, roomId, peerId, kind, outcome: failed ? 'failed' : 'paused', producerCount: producers.length });
        if (failed) return res.status(503).json({ error: 'Some media could not be paused. Refresh and retry.', partial: true });
        if (rooms.getRoom(roomId)?.peers.get(peerId) !== peer) return res.status(404).json({ error: 'This participant has left the room.' });
        if (kind === 'audio') peer.audioMuted = true; else peer.videoOff = true;
        rooms.broadcast(roomId, 'peerMuteChanged', { peerId, kind, muted: true }, peerId);
        rooms.sendToPeer(roomId, peerId, 'forceMute', { kind, by: 'A platform administrator', reason: 'admin' });
        return res.json({ muted: true, kind, pausedProducers: producers.length });
    });
    return router;
}
