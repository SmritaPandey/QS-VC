import { describe, expect, it, vi } from 'vitest';
import { RoomManager } from './room-manager.js';

describe('signaling socket backpressure', () => {
    it('sends a payload while the projected buffer stays within one MiB', () => {
        const manager = new RoomManager();
        const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };

        manager.sendPayload(ws, { method: 'ok' }, 'peer-1');

        expect(ws.send).toHaveBeenCalledOnce();
        expect(ws.terminate).not.toHaveBeenCalled();
    });

    it('terminates a slow socket before the next payload would exceed one MiB', () => {
        const manager = new RoomManager();
        const payload = { method: 'notice', params: { message: 'slow client' } };
        const messageBytes = Buffer.byteLength(JSON.stringify(payload));
        const ws = {
            readyState: 1,
            bufferedAmount: 1_048_576 - messageBytes + 1,
            send: vi.fn(),
            terminate: vi.fn(),
        };

        manager.sendPayload(ws, payload, 'slow-peer');

        expect(ws.send).not.toHaveBeenCalled();
        expect(ws.terminate).toHaveBeenCalledOnce();
    });
});

describe('room capacity', () => {
    it('refuses new rooms beyond SIGNALING_MAX_ROOMS but still serves existing ones', async () => {
        const { roomManager } = await import('./room-manager.js');
        const before = process.env.SIGNALING_MAX_ROOMS;
        const existing = roomManager.getOrCreateRoom(`cap-${crypto.randomUUID().slice(0, 8)}`);
        process.env.SIGNALING_MAX_ROOMS = '1';
        try {
            expect(() => roomManager.getOrCreateRoom(`cap-${crypto.randomUUID().slice(0, 8)}`)).toThrow(/capacity/);
            expect(roomManager.getOrCreateRoom(existing.meetingCode)).toBe(existing);
        } finally { if (before === undefined) delete process.env.SIGNALING_MAX_ROOMS; else process.env.SIGNALING_MAX_ROOMS = before; }
    });
});
