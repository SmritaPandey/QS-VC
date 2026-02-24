/**
 * Media Manager: wraps mediasoup-client Device and transport management.
 */
import { Device, types as msTypes } from 'mediasoup-client';
import { signaling } from './signaling';

export interface ProducerInfo {
    id: string;
    kind: msTypes.MediaKind;
    track: MediaStreamTrack;
    producer: msTypes.Producer;
}

export interface ConsumerInfo {
    id: string;
    kind: msTypes.MediaKind;
    track: MediaStreamTrack;
    consumer: msTypes.Consumer;
    peerId: string;
}

export class MediaManager {
    private device: Device | null = null;
    private sendTransport: msTypes.Transport | null = null;
    private recvTransport: msTypes.Transport | null = null;
    private producers: Map<string, msTypes.Producer> = new Map();
    private consumers: Map<string, ConsumerInfo> = new Map();

    private onNewConsumer: ((info: ConsumerInfo) => void) | null = null;
    private onConsumerRemoved: ((consumerId: string) => void) | null = null;

    setConsumerCallbacks(
        onNew: (info: ConsumerInfo) => void,
        onRemoved: (consumerId: string) => void
    ): void {
        this.onNewConsumer = onNew;
        this.onConsumerRemoved = onRemoved;
    }

    /**
     * Initialize the mediasoup Device with router RTP capabilities.
     */
    async loadDevice(routerRtpCapabilities: msTypes.RtpCapabilities): Promise<void> {
        this.device = new Device();
        await this.device.load({ routerRtpCapabilities });
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
        if (!this.sendTransport) throw new Error('Send transport not created');

        const producer = await this.sendTransport.produce({
            track,
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

        this.producers.set(producer.id, producer);
        console.log(`[Media] Producing ${track.kind} [producer:${producer.id}]`);
        return producer;
    }

    /**
     * Consume a remote producer (audio or video from another peer).
     */
    async consume(producerPeerId: string, producerId: string): Promise<ConsumerInfo> {
        if (!this.recvTransport) throw new Error('Recv transport not created');

        const result = await signaling.request('consume', {
            producerPeerId,
            producerId,
        });

        const consumer = await this.recvTransport.consume({
            id: result.consumerId,
            producerId: result.producerId,
            kind: result.kind,
            rtpParameters: result.rtpParameters,
        });

        // Resume the consumer on the server
        await signaling.request('resumeConsumer', {
            consumerId: consumer.id,
        });

        const info: ConsumerInfo = {
            id: consumer.id,
            kind: consumer.kind,
            track: consumer.track,
            consumer,
            peerId: producerPeerId,
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
     * Mute/unmute a producer's track.
     */
    async toggleMute(kind: msTypes.MediaKind): Promise<boolean> {
        for (const producer of this.producers.values()) {
            if (producer.kind === kind) {
                if (producer.paused) {
                    producer.resume();
                    return false; // unmuted
                } else {
                    producer.pause();
                    return true; // muted
                }
            }
        }
        return false;
    }

    /**
     * Replace video track (e.g. switch camera or screen share).
     */
    async replaceVideoTrack(newTrack: MediaStreamTrack): Promise<void> {
        for (const producer of this.producers.values()) {
            if (producer.kind === 'video') {
                await producer.replaceTrack({ track: newTrack });
                break;
            }
        }
    }

    getConsumers(): ConsumerInfo[] {
        return Array.from(this.consumers.values());
    }

    /**
     * Close everything gracefully.
     */
    close(): void {
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

        console.log('[Media] All media closed');
    }
}

// Singleton
export const media = new MediaManager();
