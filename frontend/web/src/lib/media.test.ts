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

    it('keeps receiving visible screens during automatic bandwidth fallback', async () => {
        const { manager } = await receiver();
        await manager.consume('peer', 'camera');
        await manager.setNetworkProfile('audio-only', true);
        expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer-camera', quality: 'paused' });
        await manager.consume('peer', 'screen');
        expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer-screen', quality: 'low' });
        await manager.setNetworkProfile('audio-only');
        expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer-screen', quality: 'paused' });
    });

    it('keeps receiving screen video when the viewer hides the meeting tab', async () => {
        const { manager, made } = await receiver();
        await manager.setNetworkProfile('good');
        await manager.consume('peer', 'camera');
        await manager.consume('peer', 'screen');
        mocks.request.mockClear();
        await manager.setConsumerVideoQuality('peer', 'paused');
        expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer-camera', quality: 'paused' });
        expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer-screen', quality: 'low' });
        expect(made[1].close).not.toHaveBeenCalled();
        await manager.setConsumerVideoQuality('peer', 'high');
        expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer-screen', quality: 'high' });
    });

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


describe('simultaneous camera capture ownership', () => {
    function captured(deviceId: string) {
        const track = { id: deviceId, kind: 'video', readyState: 'live', onended: null as (() => void) | null, getSettings: () => ({ deviceId }),
            stop: vi.fn(function (this: { readyState: string }) { this.readyState = 'ended'; }) };
        const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
        return { track, stream };
    }
    async function setup() {
        const { MultiCameraManager } = await import('./media');
        const made: ReturnType<typeof captured>[] = [];
        const capture = vi.fn(async (constraints: MediaStreamConstraints) => {
            const id = ((constraints.video as MediaTrackConstraints).deviceId as ConstrainDOMStringParameters).exact as string;
            const source = captured(id); made.push(source); return source.stream;
        });
        const publisher = { produce: vi.fn(async (track: MediaStreamTrack) => ({ id: track.id })), closeProducer: vi.fn().mockResolvedValue(undefined) };
        const changed = vi.fn();
        return { manager: new MultiCameraManager(publisher as any, capture, changed), capture, publisher, made, changed, MultiCameraManager };
    }
    it('publishes three separate extra cameras without microphones and refuses a fifth total camera', async () => {
        const { manager, capture, publisher } = await setup();
        await Promise.all(['second', 'third', 'fourth'].map(device => manager.startCamera(device, 'primary')));
        expect(manager.active.map(camera => camera.source)).toEqual(['camera:2', 'camera:3', 'camera:4']);
        expect(publisher.produce.mock.calls.map((call: any[]) => call[1].source)).toEqual(['camera:2', 'camera:3', 'camera:4']);
        expect(capture.mock.calls.every(call => call[0].audio === false)).toBe(true);
        await expect(manager.startCamera('fifth', 'primary')).rejects.toThrow('up to four');
        expect(capture).toHaveBeenCalledTimes(3);
    });
    it('rejects the primary device and duplicate pending captures before requesting permissions twice', async () => {
        const { manager, capture, made } = await setup();
        await expect(manager.startCamera('primary', 'primary')).rejects.toThrow('already in use');
        let resolve!: (stream: MediaStream) => void;
        capture.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = manager.startCamera('same', 'primary');
        await expect(manager.startCamera('same', 'primary')).rejects.toThrow('already in use');
        const input = captured('same'); made.push(input); resolve(input.stream);
        await pending;
        expect(capture).toHaveBeenCalledOnce();
    });
    it('stops late permission results after leave or hiding without publishing them', async () => {
        const { manager, capture, publisher } = await setup();
        let resolve!: (stream: MediaStream) => void;
        capture.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = manager.startCamera('late', 'primary');
        await manager.stopAll();
        const input = captured('late'); resolve(input.stream);
        await expect(pending).rejects.toThrow('cancelled');
        expect(input.track.stop).toHaveBeenCalled();
        expect(publisher.produce).not.toHaveBeenCalled();
        expect(manager.active).toEqual([]);
    });
    it('stops captures immediately while publication is pending and closes only their exact late producer', async () => {
        const { manager, publisher, made } = await setup();
        let resolve!: (producer: { id: string }) => void;
        publisher.produce.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = manager.startCamera('old-device', 'primary');
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        await manager.stopAll();
        expect(made[0].track.stop).toHaveBeenCalled();
        await manager.startCamera('replacement', 'primary');
        resolve({ id: 'old-producer' });
        await expect(pending).rejects.toThrow('cancelled');
        expect(publisher.closeProducer).toHaveBeenCalledWith('old-producer');
        expect(publisher.closeProducer).not.toHaveBeenCalledWith('replacement');
        expect(manager.active.map(camera => camera.deviceId)).toEqual(['replacement']);
    });
    it('releases all owned tracks when publishing fails or an extra camera is stopped', async () => {
        const { manager, publisher, made, changed } = await setup();
        publisher.produce.mockRejectedValueOnce(new Error('Encrypted transport unavailable'));
        await expect(manager.startCamera('failed', 'primary')).rejects.toThrow('Encrypted transport');
        expect(made[0].track.stop).toHaveBeenCalled();
        await manager.startCamera('working', 'primary');
        await manager.stopCamera('camera:2');
        expect(made[1].track.stop).toHaveBeenCalled();
        expect(publisher.closeProducer).toHaveBeenCalledWith('working');
        expect(changed).toHaveBeenLastCalledWith([]);
    });
});

describe('real media transport statistics', () => {
    it('returns unavailable as no transport and rejects failed live transport reads', async () => {
        const empty = new MediaManager();
        expect(await empty.getTransportStats()).toEqual([]);
        const manager = await managerWithTransport(vi.fn());
        mocks.transport.getStats = vi.fn().mockResolvedValue(new Map([['sample', { type: 'outbound-rtp', bytesSent: 123 }]]));
        expect((await manager.getTransportStats())[0].get('sample').bytesSent).toBe(123);
        mocks.transport.getStats.mockRejectedValueOnce(new Error('transport stats unavailable'));
        await expect(manager.getTransportStats()).rejects.toThrow('stats unavailable');
    });
});


it('keeps audio and explicitly muted cameras unchanged across bandwidth profiles', async () => {
    const producers: any[] = [];
    const manager = await managerWithTransport(async (options: any) => {
        const producer = { id: String(producers.length), kind: options.track.kind, appData: options.appData, closed: false, paused: false,
            pause: vi.fn(function(this: any) { this.paused = true; }), resume: vi.fn(function(this: any) { this.paused = false; }),
            setMaxSpatialLayer: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
        producers.push(producer); return producer;
    });
    await manager.produce({ kind: 'audio' } as MediaStreamTrack);
    await manager.produce({ kind: 'video' } as MediaStreamTrack, { source: 'camera' });
    expect(producers[1].setMaxSpatialLayer).toHaveBeenCalledWith(0);
    await manager.produce({ kind: 'video' } as MediaStreamTrack, { source: 'screen' });
    await manager.setNetworkProfile('audio-only', true);
    expect(producers[2].paused).toBe(false);
    manager.setPaused('video', true, 'screen');
    await manager.setNetworkProfile('audio-only', true);
    expect(producers[2].paused).toBe(true);
    manager.setPaused('video', false, 'screen');
    expect(producers[2].paused).toBe(false);
    await manager.produce({ kind: 'video' } as MediaStreamTrack, { type: 'screen' });
    expect(producers[3].paused).toBe(false);
    await manager.setNetworkProfile('audio-only');
    expect(producers[2].paused).toBe(true);
    expect(producers[0].pause).not.toHaveBeenCalled();
    expect(producers[1].paused).toBe(true);
    manager.setPaused('video', true, 'camera');
    await manager.setNetworkProfile('good');
    expect(producers[1].resume).not.toHaveBeenCalled();
    manager.close();
});

it('serializes transport-local ICE retries and cancels them when media closes', async () => {
    vi.useFakeTimers();
    const manager = await managerWithTransport(vi.fn());
    const listener = mocks.transport.on.mock.calls.find((call: any[]) => call[0] === 'connectionstatechange')[1];
    mocks.transport.connectionState = 'failed';
    mocks.request.mockResolvedValue({ iceParameters: {} });
    mocks.transport.restartIce = vi.fn().mockResolvedValue(undefined);
    listener('failed'); listener('failed');
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.transport.restartIce).toHaveBeenCalledOnce();
    manager.close();
    await vi.advanceTimersByTimeAsync(20000);
    expect(mocks.transport.restartIce).toHaveBeenCalledOnce();
    vi.useRealTimers();
});

it('requests server-side video pausing for hidden peers and deduplicates unchanged quality', async () => {
    const manager = await managerWithTransport(vi.fn());
    const consumer = { id: 'consumer', kind: 'video', track: { id: 'remote', kind: 'video' }, on: vi.fn(), close: vi.fn(), closed: false };
    mocks.recvTransport = { id: 'recv', closed: false, on: vi.fn(), consume: vi.fn().mockResolvedValue(consumer), close: vi.fn() };
    await manager.createRecvTransport({ id: 'recv' });
    mocks.request.mockImplementation(async (method: string) => method === 'consume' ? { consumerId: 'consumer', producerId: 'video', kind: 'video', rtpParameters: {} } : {});
    await manager.consume('peer', 'video');
    await manager.setConsumerVideoQuality('peer', 'paused');
    expect(mocks.request).toHaveBeenCalledWith('setConsumerQuality', { consumerId: 'consumer', quality: 'paused' });
    const count = mocks.request.mock.calls.length;
    await manager.setConsumerVideoQuality('peer', 'paused');
    expect(mocks.request.mock.calls).toHaveLength(count);
    manager.close();
});
