import { getToken, clearSession, subscribeSession } from './session';
/**
 * WebSocket + JSON-RPC 2.0 signaling client.
 */

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || (typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws` : 'ws://localhost:3000/ws');

type RpcCallback = (result: any, error?: any) => void;

export class SignalingClient {
    private ws: WebSocket | null = null;
    private unsubscribeSession?: () => void;
    private pendingRequests: Map<number, RpcCallback> = new Map();
    private nextId = 1;
    private eventHandlers: Map<string, Set<(params: any) => void>> = new Map();

    async connect(meetingCode: string): Promise<void> {
        const token = getToken();
        let ticket: string | undefined;
        if (token) {
            const endpoint = new URL(SIGNALING_URL);
            endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
            endpoint.pathname = '/api/signaling-ticket';
            endpoint.search = '';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ meetingCode }),
                cache: 'no-store',
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || 'Could not authenticate with the meeting service.');
            }
            const result = await response.json() as { ticket?: string };
            if (!result.ticket || getToken() !== token) throw new Error('Your session changed. Reconnect to the meeting.');
            ticket = result.ticket;
        }
        return new Promise((resolve, reject) => {
            this.unsubscribeSession?.();
            const socket = new WebSocket(SIGNALING_URL);
            this.ws = socket;
            // Events from a socket that was already replaced or closed by disconnect() (for example
            // React StrictMode mounting the meeting twice in development) must not tear down the
            // current connection.
            const current = () => this.ws === socket;

            socket.onopen = () => {
                if (!current()) return;
                // The bearer was exchanged over HTTPS for a short-lived, single-use ticket.
                // Put that ticket in the first WSS frame instead of any URL or query string.
                socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', id: 0, params: ticket ? { ticket } : { guest: true } }));
            };

            socket.onmessage = (event) => {
                if (!current()) return;
                try {
                    const data = JSON.parse(event.data);
                    if (data.id === 0) {
                        if (data.result?.authenticated === true) {
                            console.log('[Signaling] Authenticated');
                            resolve();
                        } else {
                            reject(new Error(data.error?.message || 'Meeting authentication failed.'));
                            socket.close(4003, 'Authentication failed');
                        }
                        return;
                    }
                    this.handleMessage(data);
                } catch (err) {
                    console.error('[Signaling] Parse error:', err);
                }
            };

            socket.onclose = (event) => {
                if (!current()) { reject(new Error('Connection replaced')); return; }
                this.ws = null;
                this.unsubscribeSession?.(); this.unsubscribeSession = undefined;
                reject(new Error(event.code === 4003 ? 'Session expired' : 'Connection closed'));
                console.log(`[Signaling] Disconnected: ${event.code}`);
                this.emit('disconnected', { code: event.code });
                if (event.code === 4003) { clearSession(token); this.emit('reconnectFailed', {}); return; }
            };

            if (token) this.unsubscribeSession = subscribeSession(() => {
                if (current() && getToken() !== token) socket.close(4003, 'Account changed');
            });

            socket.onerror = (err) => {
                if (!current()) return;
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

            // joinRoom verifies the account, loads the meeting and prepares media on the server: allow it longer.
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, method === 'joinRoom' ? 30000 : 15000);
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
        this.unsubscribeSession?.(); this.unsubscribeSession = undefined;
        const socket = this.ws;
        this.ws = null;
        // Fail pending requests now instead of leaving callers waiting on a closed socket.
        for (const callback of this.pendingRequests.values()) callback(undefined, { message: 'Disconnected' });
        this.pendingRequests.clear();
        if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'Client closing');
    }
}

// Singleton instance
export const signaling = new SignalingClient();
