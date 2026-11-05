import jwt from 'jsonwebtoken';
import http from 'http';
import url from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { handleRpcMessage, handlePeerDisconnect } from './rpc/handler.js';
import { logger } from './logger.js';

const AUTH_URL = (process.env.AUTH_INTERNAL_URL || 'http://localhost:4002').replace(/\/$/, '');

export class InvalidAuthentication extends Error {}

export async function verifySession(token: string): Promise<AuthPayload> {
    const response = await fetch(`${AUTH_URL}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}`, 'x-qsvc-service-token': jwt.sign({}, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-auth-verify', issuer: 'qsvc-internal', expiresIn: 30 }) },
        signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401 || response.status === 403) throw new InvalidAuthentication('Invalid authentication');
    if (!response.ok) throw new Error('Authentication temporarily unavailable');
    const body = await response.json() as { valid?: boolean; payload?: AuthPayload };
    const payload = body.payload;
    if (!body.valid || !payload?.sub) throw new InvalidAuthentication('Invalid authentication');
    return payload;
}

interface AuthPayload {
    sub: string;
    email: string;
    displayName: string;
    role: string;
    tenantId: string;
    plan?: 'guest' | 'starter_trial' | 'starter' | 'pro' | 'enterprise';
    status?: 'trial_active' | 'trial_expired' | 'paid_active' | 'enterprise_pending' | 'enterprise_approved' | 'enterprise_rejected';
    privateConversationLimitMs?: number | null;
}

/** Attach JSON-RPC signaling WebSocket to an existing HTTP server. */
export function attachSignalingWebSocket(server: http.Server): WebSocketServer {
    const requireTerm = process.env.QSVC_ENTERPRISE_TERMS_REQUIRED === 'yes';
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

    wss.on('connection', (ws: WebSocket, req) => {
        let authUser: AuthPayload | null = null;
        let token: string | undefined;
        try {
            const parsedUrl = url.parse(req.url || '', true);
            token = (parsedUrl.query.token as string)
                || req.headers.authorization?.replace('Bearer ', '');

            if (requireTerm && !token) {
                ws.close(4003, 'Sign in to your organisation workspace');
                return;
            }
            if (token) {
                // Verify before every RPC below, including the initial join.
                logger.info(`Authenticated WebSocket session requested from ${req.socket.remoteAddress}`);
            } else {
                logger.info(`WebSocket connected (guest) from ${req.socket.remoteAddress}`);
            }
        } catch {
            logger.warn(`WebSocket auth failed from ${req.socket.remoteAddress}`);
            ws.close(4003, 'Invalid authentication');
            return;
        }

        const connectionState: {
            peerId?: string;
            roomId?: string;
            displayName?: string;
            authUser?: AuthPayload | null;
        } = { authUser };

        (ws as any).isAlive = true;
        let nextTermCheck = 0;
        ws.on('pong', async () => {
            (ws as any).isAlive = true;
            if (!requireTerm || !token || Date.now() < nextTermCheck) return;
            nextTermCheck = Date.now() + 25_000;
            try {
                await verifySession(token);
            } catch (error) {
                if (error instanceof InvalidAuthentication) ws.close(4003, 'Session expired or invalid');
                else ws.close(1011, 'Could not verify workspace access');
            }
        });

        ws.on('message', async (data) => {
            try {
                if (token) {
                    try {
                        authUser = await verifySession(token);
                        connectionState.authUser = authUser;
                    } catch (error) {
                        if (error instanceof InvalidAuthentication) ws.close(4003, 'Session expired or invalid');
                        else {
                            const request = JSON.parse(data.toString());
                            ws.send(JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32050, message: 'Authentication temporarily unavailable. Please retry.' } }));
                        }
                        return;
                    }
                }
                if (ws.readyState !== WebSocket.OPEN) return;
                const message = JSON.parse(data.toString());

                if (message.jsonrpc !== '2.0' || !message.method) {
                    ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
                    }));
                    return;
                }

                const response = await handleRpcMessage(ws, message, connectionState);
                if (response && message.id !== undefined) {
                    ws.send(JSON.stringify(response));
                }
            } catch (err: any) {
                logger.error(err, 'Failed to process WebSocket message');
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' },
                }));
            }
        });

        ws.on('close', async (code) => {
            logger.info(`WebSocket closed [peer:${connectionState.peerId}] code:${code}`);
            await handlePeerDisconnect(connectionState);
        });

        ws.on('error', (err) => {
            logger.error(err, `WebSocket error [peer:${connectionState.peerId}]`);
        });
    });

    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws: any) => {
            if (!ws.isAlive) {
                logger.warn('Terminating stale WebSocket connection');
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    return wss;
}
