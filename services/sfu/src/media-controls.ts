import type { Request, Response } from 'express';
import type { Room } from './mediasoup/room.js';
import { logger } from './logger.js';

export function mediaControls(rooms: Map<string, Room>) {
    return {
        restartIce: async (req: Request<{ roomId: string; transportId: string }>, res: Response) => {
    try {
        const transport = rooms.get(req.params.roomId)?.getPeer(req.body.peerId)?.getTransport(req.params.transportId);
        if (!transport) return res.status(404).json({ error: 'Transport not found' });
        res.json({ iceParameters: await transport.restartIce() });
    } catch (error) { logger.error(error, 'ICE restart failed'); res.status(500).json({ error: 'ICE restart failed' }); }
        },
        quality: async (req: Request<{ roomId: string; consumerId: string }>, res: Response) => {
    try {
        const consumer = rooms.get(req.params.roomId)?.getPeer(req.body.peerId)?.getConsumer(req.params.consumerId);
        if (!consumer) return res.status(404).json({ error: 'Consumer not found' });
        if (consumer.kind !== 'video') return res.status(400).json({ error: 'Video consumer required' });
        if (req.body.quality === 'paused') await consumer.pause();
        else {
            if (consumer.type === 'simulcast' || consumer.type === 'svc') await consumer.setPreferredLayers({ spatialLayer: req.body.quality === 'low' ? 0 : 2, temporalLayer: req.body.quality === 'low' ? 0 : 2 });
            await consumer.resume();
        }
        res.json({ updated: true });
    } catch (error) { logger.error(error, 'Consumer quality update failed'); res.status(500).json({ error: 'Consumer quality update failed' }); }
        },
    };
}
