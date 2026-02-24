/**
 * SFU Cascade Manager — Enables multi-node SFU for 100+ participant meetings.
 *
 * Uses mediasoup PipeTransports to forward media between Worker nodes.
 * Supports:
 * - Room-to-worker load balancing
 * - Inter-node pipe transport creation
 * - Health-based failover routing
 * - Participant count per node tracking
 */
import type { types as msTypes } from 'mediasoup';
import { logger } from '../logger.js';

interface CascadeNode {
    nodeId: string;
    host: string;
    port: number;
    health: 'healthy' | 'degraded' | 'down';
    participantCount: number;
    maxParticipants: number;
    lastHeartbeat: number;
}

interface PipeConnection {
    fromNode: string;
    toNode: string;
    pipeTransport: msTypes.PipeTransport;
    pipeProducers: Map<string, msTypes.Producer>;
    pipeConsumers: Map<string, msTypes.Consumer>;
}

const MAX_PARTICIPANTS_PER_NODE = 50;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;

export class CascadeManager {
    private nodes: Map<string, CascadeNode> = new Map();
    private pipeConnections: Map<string, PipeConnection> = new Map();
    private roomToNode: Map<string, string[]> = new Map();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private localNodeId: string;

    constructor(localNodeId: string) {
        this.localNodeId = localNodeId;
    }

    /** Register a cascade node (including self). */
    registerNode(node: CascadeNode): void {
        this.nodes.set(node.nodeId, { ...node, lastHeartbeat: Date.now() });
        logger.info(`Cascade node registered: ${node.nodeId} (${node.host}:${node.port})`);
    }

    /** Remove a node from the cascade. */
    removeNode(nodeId: string): void {
        this.nodes.delete(nodeId);
        // Clean up pipe connections to this node
        for (const [key, pipe] of this.pipeConnections) {
            if (pipe.fromNode === nodeId || pipe.toNode === nodeId) {
                pipe.pipeTransport.close();
                this.pipeConnections.delete(key);
            }
        }
        logger.info(`Cascade node removed: ${nodeId}`);
    }

    /** Update node heartbeat and stats. */
    updateNodeHealth(nodeId: string, participantCount: number): void {
        const node = this.nodes.get(nodeId);
        if (node) {
            node.lastHeartbeat = Date.now();
            node.participantCount = participantCount;
            node.health = 'healthy';
        }
    }

    /** Select the best node for a new participant in a room. */
    selectNode(roomId: string): CascadeNode | null {
        const healthyNodes = Array.from(this.nodes.values())
            .filter(n => n.health !== 'down' && n.participantCount < n.maxParticipants);

        if (healthyNodes.length === 0) return null;

        // Prefer nodes already hosting this room
        const roomNodes = this.roomToNode.get(roomId) || [];
        const existingNodes = healthyNodes.filter(n => roomNodes.includes(n.nodeId));

        if (existingNodes.length > 0) {
            // Pick the least loaded existing node
            return existingNodes.sort((a, b) => a.participantCount - b.participantCount)[0];
        }

        // No existing node for this room — pick least loaded overall
        return healthyNodes.sort((a, b) => a.participantCount - b.participantCount)[0];
    }

    /** Track that a room is hosted on a specific node. */
    assignRoomToNode(roomId: string, nodeId: string): void {
        const nodes = this.roomToNode.get(roomId) || [];
        if (!nodes.includes(nodeId)) {
            nodes.push(nodeId);
            this.roomToNode.set(roomId, nodes);
        }
    }

    /**
     * Create a pipe transport between two routers for media forwarding.
     * This is the core cascade mechanism.
     */
    async createPipeTransport(
        sourceRouter: msTypes.Router,
        targetRouter: msTypes.Router,
        sourceNodeId: string,
        targetNodeId: string
    ): Promise<PipeConnection> {
        const pipeKey = `${sourceNodeId}->${targetNodeId}`;

        // Check if pipe already exists
        if (this.pipeConnections.has(pipeKey)) {
            return this.pipeConnections.get(pipeKey)!;
        }

        // Create pipe transports on both routers
        const [localPipe, remotePipe] = await Promise.all([
            sourceRouter.createPipeTransport({
                listenIp: { ip: '0.0.0.0', announcedIp: undefined },
                enableSctp: true,
                enableRtx: true,
                enableSrtp: true,
            }),
            targetRouter.createPipeTransport({
                listenIp: { ip: '0.0.0.0', announcedIp: undefined },
                enableSctp: true,
                enableRtx: true,
                enableSrtp: true,
            }),
        ]);

        // Connect pipe transports to each other
        await Promise.all([
            localPipe.connect({
                ip: remotePipe.tuple.localIp,
                port: remotePipe.tuple.localPort,
                srtpParameters: remotePipe.srtpParameters,
            }),
            remotePipe.connect({
                ip: localPipe.tuple.localIp,
                port: localPipe.tuple.localPort,
                srtpParameters: localPipe.srtpParameters,
            }),
        ]);

        const connection: PipeConnection = {
            fromNode: sourceNodeId,
            toNode: targetNodeId,
            pipeTransport: localPipe,
            pipeProducers: new Map(),
            pipeConsumers: new Map(),
        };

        this.pipeConnections.set(pipeKey, connection);
        logger.info(`Pipe transport created: ${pipeKey}`);
        return connection;
    }

    /**
     * Pipe a producer from one node to another.
     * Used when a participant on node A needs to receive media from node B.
     */
    async pipeProducer(
        sourceRouter: msTypes.Router,
        targetRouter: msTypes.Router,
        producerId: string,
        sourceNodeId: string,
        targetNodeId: string
    ): Promise<{ pipeConsumer: msTypes.Consumer; pipeProducer: msTypes.Producer }> {
        const result = await sourceRouter.pipeToRouter({
            producerId,
            router: targetRouter,
            enableRtx: true,
            enableSrtp: true,
        });

        logger.info(`Producer ${producerId} piped from ${sourceNodeId} to ${targetNodeId}`);
        return result;
    }

    /** Get cascade routing info for a room. */
    getRoomTopology(roomId: string): {
        nodes: CascadeNode[];
        pipes: { from: string; to: string }[];
    } {
        const nodeIds = this.roomToNode.get(roomId) || [];
        const nodes = nodeIds.map(id => this.nodes.get(id)).filter(Boolean) as CascadeNode[];
        const pipes: { from: string; to: string }[] = [];

        for (const [key] of this.pipeConnections) {
            const [from, to] = key.split('->');
            if (nodeIds.includes(from) && nodeIds.includes(to)) {
                pipes.push({ from, to });
            }
        }

        return { nodes, pipes };
    }

    /** Start heartbeat monitoring for cascade nodes. */
    startHeartbeatMonitor(): void {
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            for (const [nodeId, node] of this.nodes) {
                if (nodeId === this.localNodeId) continue;
                if (now - node.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
                    node.health = 'down';
                    logger.warn(`Cascade node ${nodeId} appears down (no heartbeat)`);
                }
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    /** Stop heartbeat monitor. */
    stopHeartbeatMonitor(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /** Get stats for all nodes. */
    getStats(): {
        nodeCount: number;
        healthyNodes: number;
        totalParticipants: number;
        pipeCount: number;
        nodes: CascadeNode[];
    } {
        const all = Array.from(this.nodes.values());
        return {
            nodeCount: all.length,
            healthyNodes: all.filter(n => n.health === 'healthy').length,
            totalParticipants: all.reduce((sum, n) => sum + n.participantCount, 0),
            pipeCount: this.pipeConnections.size,
            nodes: all,
        };
    }

    /** Clean up all resources. */
    destroy(): void {
        this.stopHeartbeatMonitor();
        for (const pipe of this.pipeConnections.values()) {
            pipe.pipeTransport.close();
        }
        this.pipeConnections.clear();
        this.nodes.clear();
        this.roomToNode.clear();
    }
}

export { MAX_PARTICIPANTS_PER_NODE };
