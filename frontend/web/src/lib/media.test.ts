import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transport: null as any, recvTransport: null as any, request: vi.fn() }));
vi.mock('mediasoup-client', () => ({ Device: class {
    rtpCapabilities = {};
    async load() {}
    createSendTransport() { return mocks.transport; }
    createRecvTransport() { return mocks.recvTransport; }
} }));
vi.mock('./signaling', () => ({ signaling: { request: mocks.request } }));
import { MediaManager } from './media';

afterEach(() => { vi.clearAllMocks(); mocks.recvTransport = null; });

async function managerWithTransport(produce: (...args: any[]) => any) {
    mocks.transport = { id: 'send', closed: false, produce, on: vi.fn(), close: vi.fn() };
    const manager = new MediaManager();
    await manager.loadDevice({} as any);
    await manager.createSendTransport({ id: 'send' });
    return manager;
}

describe('media producer lifetime', () => {
    it('keeps camera and screen video producers separate and scopes media controls by source', async () => {
        const producers: any[] = [];
        const produce = vi.fn().mockImplementation((options: any) => {
            const producer = { id: `video-${producers.length}`, kind: 'video', appData: options.appData, closed: false, paused: false,
                replaceTrack: vi.fn(), pause: vi.fn(function (this: any) { this.paused = true; }), resume: vi.fn(function (this: any) { this.paused = false; }), close: vi.fn() };
            producers.push(producer);
            return producer;
        });
        const manager = await managerWithTransport(produce);
        const camera = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
        const screen = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
        const replacementCamera = { kind: 'video' } as MediaStreamTrack;
        await manager.produce(camera, { source: 'camera' });
        await manager.produce(screen, { type: 'screen' });
        expect(produce.mock.calls[0][0].stopTracks).toBe(false);
        expect(manager.hasProducer('video', 'camera')).toBe(true);
        expect(manager.hasProducer('video', 'screen')).toBe(true);
        await manager.replaceTrack('video', replacementCamera, 'camera');
        expect(producers[0].replaceTrack).toHaveBeenCalledWith({ track: replacementCamera });
        expect(producers[1].replaceTrack).not.toHaveBeenCalled();
        manager.setPaused('video', true, 'camera');
        expect(producers[0].pause).toHaveBeenCalledOnce();
        expect(producers[1].pause).not.toHaveBeenCalled();
        await manager.closeProducerBySource('screen');
        expect(producers[1].close).toHaveBeenCalledOnce();
        expect(mocks.request).toHaveBeenCalledWith('closeProducer', { producerId: 'video-1' });
        expect(manager.hasProducer('video', 'camera')).toBe(true);
        expect(manager.hasProducer('video', 'screen')).toBe(false);
        expect(camera.stop).not.toHaveBeenCalled();
        manager.close();
        expect(producers[0].close).toHaveBeenCalledOnce();
    });

    it('keeps server producer metadata with consumed tracks', async () => {
        const manager = await managerWithTransport(vi.fn());
        const consumer = { id: 'consumer', kind: 'video', track: { id: 'remote-screen', kind: 'video' }, on: vi.fn(), close: vi.fn() };
        mocks.recvTransport = { id: 'recv', closed: false, on: vi.fn(), consume: vi.fn().mockResolvedValue(consumer), close: vi.fn() };
        await manager.createRecvTransport({ id: 'recv' });
        mocks.request.mockImplementation(async (method: string) => method === 'consume'
            ? { consumerId: 'consumer', producerId: 'screen', kind: 'video', rtpParameters: {}, appData: { source: 'screen' } }
            : { resumed: true });
        const info = await manager.consume('peer', 'screen');
        expect(info.appData).toEqual({ source: 'screen' });
        expect(info.peerId).toBe('peer');
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
