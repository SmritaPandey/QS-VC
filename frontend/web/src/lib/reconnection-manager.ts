/**
 * WebSocket Reconnection Manager for QS-VC.
 *
 * Handles automatic reconnection with:
 * - Exponential backoff (1s → 2s → 4s → 8s → 16s → 30s max)
 * - Reconnection state tracking
 * - Automatic re-join after reconnect
 * - Connection health monitoring via ping/pong
 * - Event callbacks for UI updates
 */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface ReconnectionConfig {
    /** Base delay in ms (default: 1000) */
    baseDelay: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelay: number;
    /** Maximum number of reconnection attempts (default: 10) */
    maxAttempts: number;
    /** Backoff multiplier (default: 2) */
    backoffMultiplier: number;
    /** Ping interval in ms (default: 25000) */
    pingInterval: number;
    /** Pong timeout in ms (default: 10000) */
    pongTimeout: number;
}

interface ReconnectionCallbacks {
    onStateChange: (state: ConnectionState) => void;
    onReconnected: (ws: WebSocket) => void;
    onMessage: (data: any) => void;
    onMaxRetriesReached: () => void;
}

const DEFAULT_CONFIG: ReconnectionConfig = {
    baseDelay: 1000,
    maxDelay: 30000,
    maxAttempts: 10,
    backoffMultiplier: 2,
    pingInterval: 25000,
    pongTimeout: 10000,
};

export class ReconnectionManager {
    private ws: WebSocket | null = null;
    private url: string;
    private config: ReconnectionConfig;
    private callbacks: ReconnectionCallbacks;
    private state: ConnectionState = 'disconnected';
    private attemptCount: number = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private pongTimer: ReturnType<typeof setTimeout> | null = null;
    private intentionalClose: boolean = false;

    // Session state for re-joining after reconnect
    private sessionData: {
        roomId?: string;
        peerId?: string;
        displayName?: string;
        rtpCapabilities?: any;
    } = {};

    constructor(
        url: string,
        callbacks: ReconnectionCallbacks,
        config: Partial<ReconnectionConfig> = {}
    ) {
        this.url = url;
        this.callbacks = callbacks;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /** Connect to the WebSocket server. */
    connect(): void {
        this.intentionalClose = false;
        this.attemptCount = 0;
        this.setState('connecting');
        this.createConnection();
    }

    /** Disconnect intentionally (no reconnection). */
    disconnect(): void {
        this.intentionalClose = true;
        this.cleanup();
        this.setState('disconnected');
    }

    /** Store session data for re-join after reconnect. */
    setSessionData(data: Partial<typeof this.sessionData>): void {
        this.sessionData = { ...this.sessionData, ...data };
    }

    /** Get current connection state. */
    getState(): ConnectionState {
        return this.state;
    }

    /** Get the underlying WebSocket. */
    getWebSocket(): WebSocket | null {
        return this.ws;
    }

    /** Send a JSON-RPC message. */
    send(message: any): boolean {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    /** Get number of reconnection attempts. */
    getAttemptCount(): number {
        return this.attemptCount;
    }

    // ── Private Methods ──────────────────────────────────

    private createConnection(): void {
        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                this.attemptCount = 0;

                if (this.state === 'reconnecting') {
                    // Reconnected — notify and re-join
                    this.setState('connected');
                    this.callbacks.onReconnected(this.ws!);
                } else {
                    this.setState('connected');
                }

                this.startPingPong();
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);

                // Handle pong
                if (data.method === 'pong' || data.type === 'pong') {
                    this.handlePong();
                    return;
                }

                this.callbacks.onMessage(data);
            };

            this.ws.onclose = (event) => {
                this.stopPingPong();

                if (this.intentionalClose) {
                    this.setState('disconnected');
                    return;
                }

                // Abnormal close — attempt reconnection
                console.warn(`WebSocket closed: code=${event.code} reason=${event.reason}`);
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                // onclose will fire after onerror
            };
        } catch (err) {
            console.error('Failed to create WebSocket:', err);
            this.attemptReconnect();
        }
    }

    private attemptReconnect(): void {
        if (this.intentionalClose) return;

        if (this.attemptCount >= this.config.maxAttempts) {
            this.setState('failed');
            this.callbacks.onMaxRetriesReached();
            return;
        }

        this.setState('reconnecting');
        this.attemptCount++;

        // Calculate delay with exponential backoff + jitter
        const delay = Math.min(
            this.config.baseDelay * Math.pow(this.config.backoffMultiplier, this.attemptCount - 1),
            this.config.maxDelay
        );
        const jitter = delay * 0.2 * Math.random(); // ±20% jitter
        const totalDelay = delay + jitter;

        console.log(`Reconnecting in ${Math.round(totalDelay)}ms (attempt ${this.attemptCount}/${this.config.maxAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.createConnection();
        }, totalDelay);
    }

    private startPingPong(): void {
        this.stopPingPong();

        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

                // Set pong timeout
                this.pongTimer = setTimeout(() => {
                    console.warn('Pong timeout — connection may be dead');
                    this.ws?.close(4000, 'Pong timeout');
                }, this.config.pongTimeout);
            }
        }, this.config.pingInterval);
    }

    private handlePong(): void {
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
        }
    }

    private stopPingPong(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
        }
    }

    private setState(newState: ConnectionState): void {
        if (this.state !== newState) {
            this.state = newState;
            this.callbacks.onStateChange(newState);
        }
    }

    private cleanup(): void {
        this.stopPingPong();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Intentional disconnect');
            }
            this.ws = null;
        }
    }
}
