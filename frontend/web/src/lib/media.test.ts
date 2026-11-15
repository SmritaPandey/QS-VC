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


describe('remote producer removal', () => {
    async function receiver() {
        const manager = await managerWithTransport(vi.fn());
        const made: any[] = [];
        mocks.recvTransport = { id: 'recv', closed: false, on: vi.fn(), close: vi.fn(), consume: vi.fn(async (options: any) => {
            const events = new Map<string, () => void>();
            const consumer = { id: options.id, kind: 'video', track: { id: options.id }, close: vi.fn(), on: vi.fn((event, listener) => events.set(event, listener)), events };
            made.push(consumer); return consumer;
        }) };
        await manager.createRecvTransport({ id: 'recv' });
        mocks.request.mockImplementation(async (method: string, params: any) => method === 'consume'
            ? { consumerId: `consumer-${params.producerId}`, producerId: params.producerId, kind: 'video', rtpParameters: {}, appData: { source: params.producerId.startsWith('screen') ? 'screen' : 'camera' } }
            : { resumed: true });
        return { manager, made };
    }

    it('removes the stopped screen consumer immediately without removing the camera or a replacement share', async () => {
        const { manager, made } = await receiver();
        const onNew = vi.fn(), onRemoved = vi.fn(); manager.setConsumerCallbacks(onNew, onRemoved);
        await manager.consume('peer', 'camera'); await manager.consume('peer', 'screen-old'); await manager.consume('peer', 'screen-new');
        manager.closeConsumerByProducer('screen-old');
        expect(made[1].close).toHaveBeenCalledOnce();
        expect(made[0].close).not.toHaveBeenCalled(); expect(made[2].close).not.toHaveBeenCalled();
        expect(manager.getConsumers().map(info => info.producerId)).toEqual(['camera', 'screen-new']);
        expect(onRemoved).toHaveBeenCalledExactlyOnceWith('consumer-screen-old');
        made[1].events.get('trackended')!(); manager.closeConsumerByProducer('screen-old');
        expect(onRemoved).toHaveBeenCalledOnce();
        await expect(manager.consume('peer', 'screen-old')).rejects.toThrow('Remote producer closed');
    });

    it('does not attach a screen whose close notification arrives during consume setup', async () => {
        const { manager, made } = await receiver();
        const onNew = vi.fn(); manager.setConsumerCallbacks(onNew, vi.fn());
        let resume!: () => void;
        const normal = mocks.request.getMockImplementation()!;
        mocks.request.mockImplementation((method: string, params: any) => method === 'resumeConsumer' ? new Promise<void>(done => { resume = done; }) : normal(method, params));
        const pending = manager.consume('peer', 'screen');
        await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
        manager.closeConsumerByProducer('screen'); resume();
        await expect(pending).rejects.toThrow('closed');
        expect(made[0].close).toHaveBeenCalledOnce(); expect(onNew).not.toHaveBeenCalled(); expect(manager.getConsumers()).toEqual([]);
    });

    it('closes a partially created consumer if server resume fails', async () => {
        const { manager, made } = await receiver();
        const normal = mocks.request.getMockImplementation()!;
        mocks.request.mockImplementation((method: string, params: any) => method === 'resumeConsumer' ? Promise.reject(new Error('Producer no longer exists')) : normal(method, params));
        await expect(manager.consume('peer', 'screen')).rejects.toThrow('Producer no longer exists');
        expect(made[0].close).toHaveBeenCalledOnce(); expect(manager.getConsumers()).toEqual([]);
    });
});
