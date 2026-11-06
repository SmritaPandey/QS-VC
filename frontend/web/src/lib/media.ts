/**
 * Media Manager: wraps mediasoup-client Device and transport management.
 */
import { Device, types as msTypes } from 'mediasoup-client';
import { signaling } from './signaling';
import { encodedTransformsSupported, type E2EEManager } from './e2ee';

export interface ProducerInfo {
    id: string;
    kind: msTypes.MediaKind;
    track: MediaStreamTrack;
    producer: msTypes.Producer;
    appData: Record<string, unknown>;
}

export interface ConsumerInfo {
    id: string;
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
            additionalSettings: encodedTransformsSupported() ? ({ encodedInsertableStreams: true } as Partial<RTCConfiguration>) : undefined,
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
            additionalSettings: encodedTransformsSupported() ? ({ encodedInsertableStreams: true } as Partial<RTCConfiguration>) : undefined,
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
        if (e2ee) {
            // Do not produce clear media while waiting for a key or installing the frame transform.
            track.enabled = false;
            try { await e2ee.waitUntilActive(); }
            catch (error) { track.enabled = wasEnabled; throw error; }
        }

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
                e2ee.setupSenderTransform(producer.rtpSender);
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

        const result = await signaling.request('consume', {
            producerPeerId,
            producerId,
            rtpCapabilities: this.device?.rtpCapabilities,
        });

        if (revision !== this.revision || transport.closed) throw new Error('Media session closed');
        const consumer = await transport.consume({
            id: result.consumerId,
            producerId: result.producerId,
            kind: result.kind,
            rtpParameters: result.rtpParameters,
        });

        if (this.e2ee) {
            try {
                if (!consumer.rtpReceiver) throw new Error('The media transport did not expose an encoded receiver');
                this.e2ee.setupReceiverTransform(consumer.rtpReceiver);
            } catch (error) {
                consumer.close();
                throw error;
            }
        }

        if (revision !== this.revision || transport.closed) { consumer.close(); throw new Error('Media session closed'); }
        // Resume the consumer on the server
        await signaling.request('resumeConsumer', {
            consumerId: consumer.id,
        });

        if (revision !== this.revision || transport.closed) { consumer.close(); throw new Error('Media session closed'); }
        const info: ConsumerInfo = {
            id: consumer.id,
            kind: consumer.kind,
            track: consumer.track,
            consumer,
            peerId: producerPeerId,
            appData: result.appData && typeof result.appData === 'object' ? result.appData : producerAppData,
        };

        this.consumers.set(consumer.id, info);
        this.onNewConsumer?.(info);

        consumer.on('transportclose', () => {
            this.consumers.delete(consumer.id);
            this.onConsumerRemoved?.(consumer.id);
        });

        consumer.on('trackended', () => {
            this.consumers.delete(consumer.id);
            this.onConsumerRemoved?.(consumer.id);
        });

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

    /** Close one media source without interrupting another producer of the same kind. */
    async closeProducerBySource(source: string): Promise<void> {
        const producers = Array.from(this.producers.values()).filter(producer => this.hasSource(producer, source) && !producer.closed);
        for (const producer of producers) {
            producer.close();
            this.producers.delete(producer.id);
        }
        await Promise.all(producers.map(producer => signaling.request('closeProducer', { producerId: producer.id })));
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
