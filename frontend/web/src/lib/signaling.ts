import { getToken, clearSession } from './session';
/**
 * WebSocket + JSON-RPC 2.0 signaling client.
 */

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

type RpcCallback = (result: any, error?: any) => void;

export class SignalingClient {
    private ws: WebSocket | null = null;
    private pendingRequests: Map<number, RpcCallback> = new Map();
    private nextId = 1;
    private eventHandlers: Map<string, Set<(params: any) => void>> = new Map();

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL(SIGNALING_URL);
            const token = getToken();
            if (token) url.searchParams.set('token', token);
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                console.log('[Signaling] Connected');
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (err) {
                    console.error('[Signaling] Parse error:', err);
                }
            };

            this.ws.onclose = (event) => {
                console.log(`[Signaling] Disconnected: ${event.code}`);
                this.emit('disconnected', { code: event.code });
                if (event.code === 4003) { clearSession(); this.emit('reconnectFailed', {}); return; }

            };

            this.ws.onerror = (err) => {
                console.error('[Signaling] Error:', err);
                reject(err);
            };
        });
    }

    private handleMessage(data: any): void {
        // Response to a request
        if (data.id !== undefined && (data.result !== undefined || data.error !== undefined)) {
            const callback = this.pendingRequests.get(data.id);
            if (callback) {
                this.pendingRequests.delete(data.id);
                callback(data.result, data.error);
            }
            return;
        }

        // Notification (server → client)
        if (data.method) {
            this.emit(data.method, data.params);
        }
    }

    /**
     * Send a JSON-RPC 2.0 request and await the response.
     */
    async request(method: string, params: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const id = this.nextId++;
            const message = { jsonrpc: '2.0', method, id, params };

            this.pendingRequests.set(id, (result, error) => {
                if (error) reject(new Error(error.message));
                else resolve(result);
            });

            this.ws.send(JSON.stringify(message));

            // Timeout after 15 seconds (joinRoom needs extra time for SFU probing)
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, 15000);
        });
    }

    /**
     * Send a JSON-RPC 2.0 notification (no response expected).
     */
    notify(method: string, params: any = {}): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }

    /**
     * Subscribe to server notifications.
     */
    on(event: string, handler: (params: any) => void): () => void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(handler);

        // Return unsubscribe function
        return () => {
            this.eventHandlers.get(event)?.delete(handler);
        };
    }

    private emit(event: string, params: any): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(params);
                } catch (err) {
                    console.error(`[Signaling] Handler error for ${event}:`, err);
                }
            }
        }
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close(1000, 'Client closing');
            this.ws = null;
        }
    }
}

// Singleton instance
export const signaling = new SignalingClient();
