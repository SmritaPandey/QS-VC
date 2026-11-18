import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Room } from './mediasoup/room.js';
import { mediaControls } from './media-controls.js';

function fixture(kind = 'video') {
    const transport = { restartIce: vi.fn().mockResolvedValue({ usernameFragment: 'new-ice' }) };
    const consumer = { kind, type: 'simulcast', pause: vi.fn(), resume: vi.fn(), setPreferredLayers: vi.fn() };
    const owner = { getTransport: (id: string) => id === 'transport' ? transport : undefined, getConsumer: (id: string) => id === 'consumer' ? consumer : undefined };
    const outsider = { getTransport: () => undefined, getConsumer: () => undefined };
    const room = { getPeer: (id: string) => id === 'owner' ? owner : id === 'outsider' ? outsider : undefined };
    const handlers = mediaControls(new Map([['room', room as unknown as Room]]));
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    return { handlers, transport, consumer, response, res: response as unknown as Response };
}

describe('peer-owned media recovery controls', () => {
    it('rejects another peer’s transport and consumer without invoking media controls', async () => {
        const { handlers, transport, consumer, response, res } = fixture();
        await handlers.restartIce({ params: { roomId: 'room', transportId: 'transport' }, body: { peerId: 'outsider' } } as unknown as Request<{ roomId: string; transportId: string }>, res);
        await handlers.quality({ params: { roomId: 'room', consumerId: 'consumer' }, body: { peerId: 'outsider', quality: 'paused' } } as unknown as Request<{ roomId: string; consumerId: string }>, res);
        expect(response.status.mock.calls).toEqual([[404], [404]]);
        expect(transport.restartIce).not.toHaveBeenCalled();
        expect(consumer.pause).not.toHaveBeenCalled();
    });
    it('never pauses an audio consumer through video adaptation', async () => {
        const { handlers, consumer, response, res } = fixture('audio');
        await handlers.quality({ params: { roomId: 'room', consumerId: 'consumer' }, body: { peerId: 'owner', quality: 'paused' } } as unknown as Request<{ roomId: string; consumerId: string }>, res);
        expect(response.status).toHaveBeenCalledWith(400);
        expect(consumer.pause).not.toHaveBeenCalled();
    });
    it('restarts owned ICE and lowers only the owned video consumer', async () => {
        const { handlers, transport, consumer, response, res } = fixture();
        await handlers.restartIce({ params: { roomId: 'room', transportId: 'transport' }, body: { peerId: 'owner' } } as unknown as Request<{ roomId: string; transportId: string }>, res);
        expect(transport.restartIce).toHaveBeenCalledOnce();
        expect(response.json).toHaveBeenCalledWith({ iceParameters: { usernameFragment: 'new-ice' } });
        await handlers.quality({ params: { roomId: 'room', consumerId: 'consumer' }, body: { peerId: 'owner', quality: 'low' } } as unknown as Request<{ roomId: string; consumerId: string }>, res);
        expect(consumer.setPreferredLayers).toHaveBeenCalledWith({ spatialLayer: 0, temporalLayer: 0 });
        expect(consumer.resume).toHaveBeenCalledOnce();
    });
});
