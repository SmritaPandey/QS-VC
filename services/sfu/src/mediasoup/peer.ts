import { types as msTypes } from 'mediasoup';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger.js';

/**
 * Peer: represents a single participant in a Room.
 * Owns WebRTC transports, Producers (outgoing media), and Consumers (incoming media).
 */
export interface PeerInfo {
    id: string;
    displayName: string;
    device?: string;
    joinedAt: Date;
}

export class Peer {
    readonly id: string;
    readonly displayName: string;
    readonly device: string;
    readonly joinedAt: Date;

    private transports: Map<string, msTypes.WebRtcTransport> = new Map();
    private producers: Map<string, msTypes.Producer> = new Map();
    private consumers: Map<string, msTypes.Consumer> = new Map();

    private closed = false;

    constructor(id: string, displayName: string, device = 'unknown') {
        this.id = id;
        this.displayName = displayName;
        this.device = device;
        this.joinedAt = new Date();
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TRANSPORTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    addTransport(transport: msTypes.WebRtcTransport): void {
        this.transports.set(transport.id, transport);
        transport.on('routerclose', () => {
            this.transports.delete(transport.id);
        });
    }

    getTransport(transportId: string): msTypes.WebRtcTransport | undefined {
        return this.transports.get(transportId);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PRODUCERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    addProducer(producer: msTypes.Producer): void {
        this.producers.set(producer.id, producer);
        producer.on('transportclose', () => {
            this.producers.delete(producer.id);
        });
    }

    getProducer(producerId: string): msTypes.Producer | undefined {
        return this.producers.get(producerId);
    }

    getProducers(): msTypes.Producer[] {
        return Array.from(this.producers.values());
    }

    getProducerByKind(kind: msTypes.MediaKind): msTypes.Producer | undefined {
        for (const producer of this.producers.values()) {
            if (producer.kind === kind && !producer.closed) {
                return producer;
            }
        }
        return undefined;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CONSUMERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    addConsumer(consumer: msTypes.Consumer): void {
        this.consumers.set(consumer.id, consumer);
        consumer.on('transportclose', () => {
            this.consumers.delete(consumer.id);
        });
        consumer.on('producerclose', () => {
            this.consumers.delete(consumer.id);
        });
    }

    getConsumer(consumerId: string): msTypes.Consumer | undefined {
        return this.consumers.get(consumerId);
    }

    getConsumers(): msTypes.Consumer[] {
        return Array.from(this.consumers.values());
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LIFECYCLE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    close(): void {
        if (this.closed) return;
        this.closed = true;

        // Close all consumers
        for (const consumer of this.consumers.values()) {
            consumer.close();
        }
        this.consumers.clear();

        // Close all producers
        for (const producer of this.producers.values()) {
            producer.close();
        }
        this.producers.clear();

        // Close all transports
        for (const transport of this.transports.values()) {
            transport.close();
        }
        this.transports.clear();

        logger.info(`Peer ${this.id} (${this.displayName}) closed`);
    }

    isClosed(): boolean {
        return this.closed;
    }

    toJSON(): PeerInfo {
        return {
            id: this.id,
            displayName: this.displayName,
            device: this.device,
            joinedAt: this.joinedAt,
        };
    }
}
