/**
 * Media Manager: wraps mediasoup-client Device and transport management.
 */
import { Device, types as msTypes } from 'mediasoup-client';
import { signaling } from './signaling';
import type { E2EEManager } from './e2ee';

export interface ProducerInfo {
    id: string;
    kind: msTypes.MediaKind;
    track: MediaStreamTrack;
    producer: msTypes.Producer;
    appData: Record<string, unknown>;
}

export interface ConsumerInfo {
    id: string;
    producerId: string;
    kind: msTypes.MediaKind;
    track: MediaStreamTrack;
    consumer: msTypes.Consumer;
    peerId: string;
    appData: Record<string, unknown>;
}

export class MediaManager {
    private device: Device | null = null;
    private revision = 0;
    private sendTransport: msTypes.Transport | null = null;
    private recvTransport: msTypes.Transport | null = null;
    private producers: Map<string, msTypes.Producer> = new Map();
    private consumers: Map<string, ConsumerInfo> = new Map();
    // A closed producer must not reappear from a pending consume or stale room snapshot.
    private closedRemoteProducers = new Set<string>();
    private e2ee: E2EEManager | null = null;

    private onNewConsumer: ((info: ConsumerInfo) => void) | null = null;
    private onConsumerRemoved: ((consumerId: string) => void) | null = null;

    setConsumerCallbacks(
        onNew: (info: ConsumerInfo) => void,
        onRemoved: (consumerId: string) => void
    ): void {
        this.onNewConsumer = onNew;
        this.onConsumerRemoved = onRemoved;
    }

    setE2EEManager(manager: E2EEManager | null): void { this.e2ee = manager; }

    private iceServers: RTCIceServer[] | undefined;
    /** TURN/STUN servers from the signaling service, used when a direct path to the SFU is blocked. */
    setIceServers(servers: RTCIceServer[] | undefined): void { this.iceServers = servers?.length ? servers : undefined; }

    /**
     * Initialize the mediasoup Device with router RTP capabilities.
     */
    async loadDevice(routerRtpCapabilities: msTypes.RtpCapabilities): Promise<void> {
        const revision = this.revision;
        const device = new Device();
        await device.load({ routerRtpCapabilities });
        if (revision !== this.revision) throw new Error('Media session closed');
        this.device = device;
        console.log('[Media] Device loaded, capabilities:', this.device.rtpCapabilities);
    }

    get rtpCapabilities(): msTypes.RtpCapabilities | undefined {
        return this.device?.rtpCapabilities;
    }

    /**
     * Create the send transport (for publishing local audio/video).
     */
    async createSendTransport(transportParams: any): Promise<void> {
        if (!this.device) throw new Error('Device not loaded');

        this.sendTransport = this.device.createSendTransport({
            id: transportParams.id,
            iceParameters: transportParams.iceParameters,
            iceCandidates: transportParams.iceCandidates,
            dtlsParameters: transportParams.dtlsParameters,
            iceServers: this.iceServers,
            // End-to-end encryption needs encoded-frame access on every sender and receiver.
            // Chrome only allows it when the peer connection is created with this flag.
            additionalSettings: this.e2ee && this.e2ee.getMode() !== 'none' ? ({ encodedInsertableStreams: true } as Partial<RTCConfiguration>) : undefined,
        });

        // When the transport needs to connect to the SFU
        this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await signaling.request('connectTransport', {
                    transportId: this.sendTransport!.id,
                    dtlsParameters,
                });
                callback();
            } catch (err: any) {
                errback(err);
            }
        });

        // When the transport needs to produce media
        this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
                const result = await signaling.request('produce', {
                    transportId: this.sendTransport!.id,
                    kind,
                    rtpParameters,
                    appData,
                });
                callback({ id: result.producerId });
            } catch (err: any) {
                errback(err);
            }
        });

        console.log('[Media] Send transport created:', transportParams.id);
    }

    /**
     * Create the receive transport (for consuming remote audio/video).
     */
    async createRecvTransport(transportParams: any): Promise<void> {
        if (!this.device) throw new Error('Device not loaded');

        this.recvTransport = this.device.createRecvTransport({
            id: transportParams.id,
            iceParameters: transportParams.iceParameters,
            iceCandidates: transportParams.iceCandidates,
            dtlsParameters: transportParams.dtlsParameters,
            iceServers: this.iceServers,
            // End-to-end encryption needs encoded-frame access on every sender and receiver.
            // Chrome only allows it when the peer connection is created with this flag.
            additionalSettings: this.e2ee && this.e2ee.getMode() !== 'none' ? ({ encodedInsertableStreams: true } as Partial<RTCConfiguration>) : undefined,
        });

        this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await signaling.request('connectTransport', {
                    transportId: this.recvTransport!.id,
                    dtlsParameters,
                });
                callback();
            } catch (err: any) {
                errback(err);
            }
        });

        console.log('[Media] Recv transport created:', transportParams.id);
    }

    /**
     * Publish a local media track (audio or video).
     */
    async produce(track: MediaStreamTrack, appData: Record<string, unknown> = {}): Promise<msTypes.Producer> {
        const transport = this.sendTransport;
        const revision = this.revision;
        if (!transport) throw new Error('Send transport not created');
        const e2ee = this.e2ee;
        const wasEnabled = track.enabled;
        // Hold the source silent/black until the encryptor is attached. Frames encoded before a
        // group key arrives are dropped by the encryptor, so nothing is sent unencrypted and nobody
        // has to wait for the key before publishing.
        if (e2ee) track.enabled = false;
        // VP8 keeps its payload header readable for the SFU (see e2ee-frame.ts); H.264 packetisation
        // cannot survive frame encryption, so encrypted meetings always publish VP8.
        const vp8 = e2ee && track.kind === 'video' ? this.device?.rtpCapabilities.codecs?.find(codec => codec.mimeType.toLowerCase() === 'video/vp8') : undefined;

        let producer: msTypes.Producer;
        try {
            producer = await transport.produce({
                track,
                // The page owns camera/screen lifetime; replacing a producer must not stop its previous source.
                stopTracks: false,
                encodings: track.kind === 'video'
                    ? [
                        { maxBitrate: 100000, scaleResolutionDownBy: 4 },   // low
                        { maxBitrate: 300000, scaleResolutionDownBy: 2 },   // mid
                        { maxBitrate: 900000, scaleResolutionDownBy: 1 },   // high
                    ]
                    : undefined,
                codecOptions: track.kind === 'video'
                    ? { videoGoogleStartBitrate: 1000 }
                    : undefined,
                ...(vp8 ? { codec: vp8 } : {}),
                appData,
            });
        } catch (error) {
            if (e2ee) track.enabled = wasEnabled;
            throw error;
        }

        if (e2ee) {
            // The source is disabled until createEncodedStreams() is attached. Any browser that
            // cannot provide the transform fails closed and never sends this producer.
            try {
                if (!producer.rtpSender) throw new Error('The media transport did not expose an encoded sender');
                e2ee.setupSenderTransform(producer.rtpSender, track.kind === 'video' ? 'video' : 'audio');
                track.enabled = wasEnabled;
            } catch (error) {
                producer.close();
                track.enabled = false;
                throw error;
            }
        }

        if (revision !== this.revision || transport.closed) { producer.close(); throw new Error('Media session closed'); }
        this.producers.set(producer.id, producer);
        console.log(`[Media] Producing ${track.kind} [producer:${producer.id}]`);
        return producer;
    }

    /**
     * Consume a remote producer (audio or video from another peer).
     */
    async consume(producerPeerId: string, producerId: string, producerAppData: Record<string, unknown> = {}): Promise<ConsumerInfo> {
        const transport = this.recvTransport;
        const revision = this.revision;
        if (!transport) throw new Error('Recv transport not created');
        if (this.closedRemoteProducers.has(producerId)) throw new Error('Remote producer closed');

        const result = await signaling.request('consume', {
            producerPeerId,
            producerId,
            rtpCapabilities: this.device?.rtpCapabilities,
        });

        if (revision !== this.revision || transport.closed) throw new Error('Media session closed');
        if (this.closedRemoteProducers.has(producerId)) throw new Error('Remote producer closed');
        const consumer = await transport.consume({
            id: result.consumerId,
            producerId: result.producerId,
            kind: result.kind,
            rtpParameters: result.rtpParameters,
        });

        if (this.e2ee) {
            try {
                if (!consumer.rtpReceiver) throw new Error('The media transport did not expose an encoded receiver');
                this.e2ee.setupReceiverTransform(consumer.rtpReceiver, producerPeerId, consumer.kind === 'video' ? 'video' : 'audio', consumer.id);
            } catch (error) {
                consumer.close();
                throw error;
            }
        }

        if (revision !== this.revision || transport.closed || this.closedRemoteProducers.has(producerId)) { consumer.close(); throw new Error('Remote producer or media session closed'); }
        // Resume the consumer on the server
        try {
            await signaling.request('resumeConsumer', { consumerId: consumer.id });
        } catch (error) { consumer.close(); throw error; }

        if (revision !== this.revision || transport.closed || this.closedRemoteProducers.has(producerId)) { consumer.close(); throw new Error('Remote producer or media session closed'); }
        const info: ConsumerInfo = {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            track: consumer.track,
            consumer,
            peerId: producerPeerId,
            appData: result.appData && typeof result.appData === 'object' ? result.appData : producerAppData,
        };

        this.consumers.set(consumer.id, info);
        this.onNewConsumer?.(info);

        consumer.on('transportclose', () => this.removeConsumer(consumer.id));
        consumer.on('trackended', () => this.removeConsumer(consumer.id));

        console.log(`[Media] Consuming ${result.kind} from peer ${producerPeerId} [consumer:${consumer.id}]`);
        return info;
    }

    /**
     * Pause or resume the producer of a kind explicitly (idempotent).
     * Keeps the sent state matching the UI.
     */
    setPaused(kind: msTypes.MediaKind, paused: boolean, source?: string): void {
        for (const producer of this.producers.values()) {
            if (producer.kind !== kind || producer.closed || !this.hasSource(producer, source)) continue;
            if (paused && !producer.paused) producer.pause();
            if (!paused && producer.paused) producer.resume();
        }
    }

    /**
     * Replace video track (e.g. switch camera or screen share).
     */
    async replaceTrack(kind: msTypes.MediaKind, newTrack: MediaStreamTrack, source?: string): Promise<void> {
        for (const producer of this.producers.values()) {
            if (producer.kind === kind && !producer.closed && this.hasSource(producer, source)) {
                await producer.replaceTrack({ track: newTrack });
                return;
            }
        }
    }

    get canSend(): boolean { return !!this.sendTransport && !this.sendTransport.closed; }

    hasProducer(kind: msTypes.MediaKind, source?: string): boolean {
        return Array.from(this.producers.values()).some(p => p.kind === kind && !p.closed && this.hasSource(p, source));
    }

    /** Read actual transport counters; failures stay unavailable rather than synthetic zeroes. */
    async getTransportStats(): Promise<RTCStatsReport[]> {
        const transports = [this.sendTransport, this.recvTransport].filter((transport): transport is msTypes.Transport => Boolean(transport && !transport.closed));
        return Promise.all(transports.map(transport => transport.getStats()));
    }

    /** Exact ownership prevents a late camera start from closing a newer camera in the same slot. */
    async closeProducer(producerId: string): Promise<void> {
        const producer = this.producers.get(producerId);
        if (!producer) return;
        this.producers.delete(producerId);
        producer.close();
        await signaling.request('closeProducer', { producerId });
    }

    /** Close one media source without interrupting another producer of the same kind. */
    async closeProducerBySource(source: string): Promise<void> {
        const producers = Array.from(this.producers.values()).filter(producer => this.hasSource(producer, source) && !producer.closed);
        for (const producer of producers) {
            producer.close();
            this.producers.delete(producer.id);
        }
        await Promise.all(producers.map(producer => signaling.request('closeProducer', { producerId: producer.id })));
    }

    /** WebRTC does not forward the SFU's producer-close event to remote tracks. */
    closeConsumerByProducer(producerId: string): void {
        this.closedRemoteProducers.add(producerId);
        for (const info of this.consumers.values()) {
            if (info.producerId === producerId) this.removeConsumer(info.id);
        }
    }

    private removeConsumer(consumerId: string): void {
        const info = this.consumers.get(consumerId);
        if (!info) return;
        this.consumers.delete(consumerId);
        info.consumer.close();
        this.onConsumerRemoved?.(consumerId);
    }

    getConsumers(): ConsumerInfo[] {
        return Array.from(this.consumers.values());
    }

    private hasSource(producer: msTypes.Producer, source?: string): boolean {
        if (!source) return true;
        const appData = producer.appData as Record<string, unknown>;
        return appData.source === source || appData.type === source;
    }

    /**
     * Close everything gracefully.
     */
    close(): void {
        this.revision++;
        for (const producer of this.producers.values()) {
            producer.close();
        }
        this.producers.clear();

        for (const { consumer } of this.consumers.values()) {
            consumer.close();
        }
        this.consumers.clear();
        this.closedRemoteProducers.clear();

        this.sendTransport?.close();
        this.recvTransport?.close();
        this.sendTransport = null;
        this.recvTransport = null;
        this.e2ee?.destroy();
        this.e2ee = null;

        console.log('[Media] All media closed');
    }
}

// Singleton
export const media = new MediaManager();


export type CameraSource = 'camera:2' | 'camera:3' | 'camera:4';
export interface AdditionalCamera { source: CameraSource; deviceId: string; track: MediaStreamTrack; }
type CameraPublisher = Pick<MediaManager, 'produce' | 'closeProducer'>;
type CameraCapture = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** Owns only the three additional captures; the existing meeting camera remains the primary. */
export class MultiCameraManager {
    private cameras = new Map<CameraSource, AdditionalCamera & { stream: MediaStream; producerId: string }>();
    private pending = new Map<CameraSource, { deviceId: string; cancelled: boolean; stream?: MediaStream }>();
    constructor(private publisher: CameraPublisher = media, private capture: CameraCapture = constraints => navigator.mediaDevices.getUserMedia(constraints),
        private onChange: (cameras: AdditionalCamera[]) => void = () => {}) {}

    get active(): AdditionalCamera[] { return [...this.cameras.values()].map(({ source, deviceId, track }) => ({ source, deviceId, track })); }
    private notify() { this.onChange(this.active); }

    async startCamera(deviceId: string, primaryDeviceId?: string): Promise<AdditionalCamera> {
        if (!deviceId.trim()) throw new Error('Choose a camera first.');
        if (typeof document !== 'undefined' && document.hidden) throw new Error('Return to the meeting tab to start a camera.');
        if (deviceId === primaryDeviceId || [...this.cameras.values(), ...this.pending.values()].some(camera => camera.deviceId === deviceId)) throw new Error('This camera is already in use.');
        const source = (['camera:2', 'camera:3', 'camera:4'] as const).find(slot => !this.cameras.has(slot) && !this.pending.has(slot));
        if (!source) throw new Error('You can use up to four cameras, including your main camera.');
        const reservation: { deviceId: string; cancelled: boolean; stream?: MediaStream } = { deviceId, cancelled: false };
        this.pending.set(source, reservation);
        let stream: MediaStream | undefined;
        let producerId: string | undefined;
        try {
            stream = await this.capture({ audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
            reservation.stream = stream;
            const track = stream.getVideoTracks()[0];
            if (reservation.cancelled || !track || track.readyState !== 'live') throw new Error('Camera start was cancelled.');
            const actualDeviceId = track.getSettings().deviceId || deviceId;
            if (actualDeviceId === primaryDeviceId || [...this.cameras.values()].some(camera => camera.deviceId === actualDeviceId) || [...this.pending.values()].some(other => other !== reservation && other.deviceId === actualDeviceId)) throw new Error('This camera is already in use.');
            reservation.deviceId = actualDeviceId;
            const producer = await this.publisher.produce(track, { source });
            producerId = producer.id;
            if (reservation.cancelled || track.readyState !== 'live') throw new Error('Camera start was cancelled.');
            this.cameras.set(source, { source, deviceId: actualDeviceId, track, stream, producerId });
            track.onended = () => { void this.stopCamera(source).catch(() => undefined); };
            this.notify();
            return { source, deviceId: actualDeviceId, track };
        } catch (error) {
            stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
            if (producerId) await this.publisher.closeProducer(producerId).catch(() => undefined);
            throw error;
        } finally { if (this.pending.get(source) === reservation) this.pending.delete(source); }
    }

    async stopCamera(source: CameraSource): Promise<void> {
        const reservation = this.pending.get(source);
        if (reservation) { reservation.cancelled = true; reservation.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.pending.delete(source); }
        const camera = this.cameras.get(source);
        if (!camera) return;
        this.cameras.delete(source);
        camera.stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
        this.notify();
        await this.publisher.closeProducer(camera.producerId);
    }

    async stopAll(): Promise<void> {
        for (const reservation of this.pending.values()) { reservation.cancelled = true; reservation.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); }
        this.pending.clear();
        await Promise.all([...this.cameras.keys()].map(source => this.stopCamera(source)));
    }
}
