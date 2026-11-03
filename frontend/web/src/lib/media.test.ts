import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transport: null as any }));
vi.mock('mediasoup-client', () => ({ Device: class {
    rtpCapabilities = {};
    async load() {}
    createSendTransport() { return mocks.transport; }
} }));
vi.mock('./signaling', () => ({ signaling: { request: vi.fn() } }));
import { MediaManager } from './media';

afterEach(() => vi.clearAllMocks());

async function managerWithTransport(produce: (...args: any[]) => any) {
    mocks.transport = { id: 'send', closed: false, produce, on: vi.fn(), close: vi.fn() };
    const manager = new MediaManager();
    await manager.loadDevice({} as any);
    await manager.createSendTransport({ id: 'send' });
    return manager;
}

describe('media producer lifetime', () => {
    it('keeps track lifetime with the page when replacing camera with a screen', async () => {
        const producer = { id: 'video', kind: 'video', closed: false, replaceTrack: vi.fn(), close: vi.fn() };
        const produce = vi.fn().mockResolvedValue(producer);
        const manager = await managerWithTransport(produce);
        const camera = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
        const screen = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
        await manager.produce(camera, { source: 'camera' });
        expect(produce.mock.calls[0][0].stopTracks).toBe(false);
        await manager.replaceTrack('video', screen);
        expect(producer.replaceTrack).toHaveBeenCalledWith({ track: screen });
        expect(camera.stop).not.toHaveBeenCalled();
        expect(manager.hasProducer('video')).toBe(true);
        manager.close();
        expect(producer.close).toHaveBeenCalledOnce();
    });

    it('closes a producer that finishes after the meeting has closed', async () => {
        let resolve!: (producer: any) => void;
        const manager = await managerWithTransport(() => new Promise(done => { resolve = done; }));
        const pending = manager.produce({ kind: 'video' } as MediaStreamTrack);
        manager.close();
        const producer = { id: 'late', close: vi.fn() };
        resolve(producer);
        await expect(pending).rejects.toThrow('Media session closed');
        expect(producer.close).toHaveBeenCalledOnce();
        expect(manager.hasProducer('video')).toBe(false);
    });
});
