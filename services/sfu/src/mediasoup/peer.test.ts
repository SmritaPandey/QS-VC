import { describe, expect, it, vi } from 'vitest';
import { Peer } from './peer.js';

describe('SFU producer controls', () => {
    it('pauses, resumes, and closes only the addressed producer', () => {
        const first = { id: 'producer-one', closed: false, paused: false, on: vi.fn(), pause: vi.fn(), resume: vi.fn(), close: vi.fn() };
        const second = { id: 'producer-two', closed: false, paused: false, on: vi.fn(), pause: vi.fn(), resume: vi.fn(), close: vi.fn() };
        const peer = new Peer('peer-one', 'Peer');
        peer.addProducer(first as any);
        peer.addProducer(second as any);

        expect(peer.setProducerPaused(first.id, true)).toBe(true);
        expect(first.pause).toHaveBeenCalledOnce();
        expect(second.pause).not.toHaveBeenCalled();
        first.paused = true;
        expect(peer.setProducerPaused(first.id, false)).toBe(true);
        expect(first.resume).toHaveBeenCalledOnce();
        expect(peer.closeProducer(first.id)).toBe(true);
        expect(first.close).toHaveBeenCalledOnce();
        expect(peer.getProducer(first.id)).toBeUndefined();
        expect(peer.getProducer(second.id)).toBe(second);
        expect(peer.closeProducer('missing')).toBe(false);
    });
});
