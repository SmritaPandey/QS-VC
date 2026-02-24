import { types as msTypes } from 'mediasoup';
import { Peer, PeerInfo } from './peer.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EventEmitter } from 'events';

export interface RoomInfo {
    id: string;
    peers: PeerInfo[];
    createdAt: Date;
}

/**
 * Room: wraps a mediasoup Router.
 * Manages peers, their transports, producers, and consumers.
 */
export class Room extends EventEmitter {
    readonly id: string;
    readonly router: msTypes.Router;
    readonly createdAt: Date;

    private peers: Map<string, Peer> = new Map();
    private closed = false;

    constructor(id: string, router: msTypes.Router) {
        super();
        this.id = id;
        this.router = router;
        this.createdAt = new Date();

        router.on('workerclose', () => {
            logger.warn(`Room ${id}: Router's Worker closed, closing room`);
            this.close();
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PEER MANAGEMENT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    addPeer(peer: Peer): void {
        this.peers.set(peer.id, peer);
        this.emit('peerJoined', peer);
        logger.info(`Room ${this.id}: Peer ${peer.id} (${peer.displayName}) joined [total: ${this.peers.size}]`);
    }

    removePeer(peerId: string): Peer | undefined {
        const peer = this.peers.get(peerId);
        if (!peer) return undefined;

        peer.close();
        this.peers.delete(peerId);
        this.emit('peerLeft', peer);
        logger.info(`Room ${this.id}: Peer ${peerId} left [remaining: ${this.peers.size}]`);

        // Auto-close empty rooms after a delay
        if (this.peers.size === 0) {
            logger.info(`Room ${this.id}: Empty, will close in 60s if no one joins`);
            setTimeout(() => {
                if (this.peers.size === 0 && !this.closed) {
                    this.close();
                }
            }, 60000);
        }

        return peer;
    }

    getPeer(peerId: string): Peer | undefined {
        return this.peers.get(peerId);
    }

    getPeers(): Peer[] {
        return Array.from(this.peers.values());
    }

    hasPeer(peerId: string): boolean {
        return this.peers.has(peerId);
    }

    get peerCount(): number {
        return this.peers.size;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TRANSPORT CREATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async createWebRtcTransport(peerId: string): Promise<msTypes.WebRtcTransport> {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error(`Peer ${peerId} not found in room ${this.id}`);

        const transport = await this.router.createWebRtcTransport({
            listenIps: config.webRtcTransport.listenIps,
            enableUdp: config.webRtcTransport.enableUdp,
            enableTcp: config.webRtcTransport.enableTcp,
            preferUdp: config.webRtcTransport.preferUdp,
            initialAvailableOutgoingBitrate: config.webRtcTransport.initialAvailableOutgoingBitrate,
            maxSctpMessageSize: config.webRtcTransport.maxSctpMessageSize,
        });

        // Set max incoming bitrate
        if (config.webRtcTransport.maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(config.webRtcTransport.maxIncomingBitrate);
            } catch (e) {
                // Ignore — not supported in all versions
            }
        }

        peer.addTransport(transport);

        transport.on('dtlsstatechange', (dtlsState: msTypes.DtlsState) => {
            if (dtlsState === 'failed' || dtlsState === 'closed') {
                logger.warn(`Room ${this.id}: Transport ${transport.id} DTLS state: ${dtlsState}`);
            }
        });

        logger.debug(`Room ${this.id}: WebRtcTransport created for peer ${peerId} [id:${transport.id}]`);
        return transport;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PRODUCER / CONSUMER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async createProducer(
        peerId: string,
        transportId: string,
        kind: msTypes.MediaKind,
        rtpParameters: msTypes.RtpParameters,
        appData: Record<string, unknown> = {}
    ): Promise<msTypes.Producer> {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error(`Peer ${peerId} not found`);

        const transport = peer.getTransport(transportId);
        if (!transport) throw new Error(`Transport ${transportId} not found for peer ${peerId}`);

        const producer = await transport.produce({
            kind,
            rtpParameters,
            appData: { ...appData, peerId },
        });

        peer.addProducer(producer);

        producer.on('score', (score) => {
            logger.debug(`Producer ${producer.id} score: ${JSON.stringify(score)}`);
        });

        logger.info(`Room ${this.id}: Producer created [kind:${kind}, id:${producer.id}] for peer ${peerId}`);
        this.emit('newProducer', { peerId, producer });

        return producer;
    }

    async createConsumer(
        consumerPeerId: string,
        producerPeerId: string,
        producerId: string,
        rtpCapabilities: msTypes.RtpCapabilities
    ): Promise<msTypes.Consumer | null> {
        // Check if the router can consume this producer
        if (!this.router.canConsume({ producerId, rtpCapabilities })) {
            logger.warn(`Room ${this.id}: Cannot consume producer ${producerId} for peer ${consumerPeerId}`);
            return null;
        }

        const consumerPeer = this.peers.get(consumerPeerId);
        if (!consumerPeer) throw new Error(`Consumer peer ${consumerPeerId} not found`);

        // Find the consumer's receive transport
        // Convention: the second transport created is the receive transport
        const transports = Array.from(consumerPeer['transports'].values());
        const recvTransport = transports.find((t) => t.appData.direction === 'recv') || transports[1];
        if (!recvTransport) throw new Error(`No receive transport for peer ${consumerPeerId}`);

        const consumer = await recvTransport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // Start paused, client resumes after setup
            appData: { peerId: producerPeerId },
        });

        consumerPeer.addConsumer(consumer);

        consumer.on('score', (score) => {
            logger.debug(`Consumer ${consumer.id} score: ${JSON.stringify(score)}`);
        });

        consumer.on('layerschange', (layers) => {
            logger.debug(`Consumer ${consumer.id} layers: ${JSON.stringify(layers)}`);
        });

        logger.info(`Room ${this.id}: Consumer created [id:${consumer.id}] peer ${consumerPeerId} ← producer ${producerId}`);
        return consumer;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ROOM CAPABILITIES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    get rtpCapabilities(): msTypes.RtpCapabilities {
        return this.router.rtpCapabilities;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LIFECYCLE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    close(): void {
        if (this.closed) return;
        this.closed = true;

        for (const peer of this.peers.values()) {
            peer.close();
        }
        this.peers.clear();

        this.router.close();
        this.emit('close');

        logger.info(`Room ${this.id} closed`);
    }

    isClosed(): boolean {
        return this.closed;
    }

    toJSON(): RoomInfo {
        return {
            id: this.id,
            peers: this.getPeers().map((p) => p.toJSON()),
            createdAt: this.createdAt,
        };
    }
}
