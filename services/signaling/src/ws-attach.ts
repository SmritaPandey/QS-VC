import jwt from 'jsonwebtoken';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleRpcMessage, handlePeerDisconnect } from './rpc/handler.js';
import { logger } from './logger.js';
import { consumeWebSocketTicket } from './ws-tickets.js';

const AUTH_URL = (process.env.AUTH_INTERNAL_URL || 'http://localhost:4002').replace(/\/$/, '');

export class InvalidAuthentication extends Error {}

/** Matches only the high-frequency caption notifications (method appears first in the client's JSON). */
const STREAMING_METHODS = /^\{"jsonrpc":"2\.0","method":"(asrAudio|captionInterim)"/;
const STREAMING_RECHECK_MS = 15_000;

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
    const ipCounts = new Map<string, { active: number; windowStart: number; upgrades: number }>();
    const connections = new WeakMap<WebSocket, string>();
    const maxConnectionsPerIp = Math.max(1, Number(process.env.WS_MAX_CONNECTIONS_PER_IP) || 100);
    const maxUpgradesPerIp = Math.max(1, Number(process.env.WS_MAX_UPGRADES_PER_IP) || 150);
    const maxConnections = Math.max(1, Number(process.env.WS_MAX_CONNECTIONS) || 5000);
    const ipWindowMs = 10 * 60 * 1000;

    wss.on('connection', (ws: WebSocket, req) => {
        const forwarded = req.headers['x-forwarded-for'];
        const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let limits = ipCounts.get(ip);
        if (!limits || now - limits.windowStart >= ipWindowMs) {
            limits = { active: 0, windowStart: now, upgrades: 0 };
            ipCounts.set(ip, limits);
        }
        limits.upgrades++;
        if (wss.clients.size > maxConnections || limits.upgrades > maxUpgradesPerIp || limits.active >= maxConnectionsPerIp) {
            logger.warn({ ip, active: limits.active, upgrades: limits.upgrades }, 'Rejecting signaling socket over connection limits');
            ws.close(1013, 'Signaling connection limit reached');
            return;
        }
        limits.active++;
        connections.set(ws, ip);
        ws.once('close', () => {
            const connectionIp = connections.get(ws);
            if (!connectionIp) return;
            const record = ipCounts.get(connectionIp);
            if (record) record.active = Math.max(0, record.active - 1);
            connections.delete(ws);
        });

        let authUser: AuthPayload | null = null;
        let token: string | undefined;
        let expectedMeetingCode: string | undefined;
        let authenticated = false;
        let authenticating = false;
        try {
            const parsedUrl = new URL(req.url || '/', 'http://signaling.local');
            // Never accept a long-lived bearer in the upgrade URL. Browser clients authenticate in
            // their first encrypted WebSocket frame with a 30-second, single-use ticket instead.
            if (parsedUrl.searchParams.has('token') || req.headers.authorization) throw new Error('Legacy URL credentials are not accepted');
        } catch {
            logger.warn({ ip }, 'Rejected signaling URL credentials');
            ws.close(4003, 'Use a short-lived signaling ticket');
            return;
        }

        const connectionState: {
            peerId?: string;
            roomId?: string;
            displayName?: string;
            authUser?: AuthPayload | null;
            expectedMeetingCode?: string;
        } = { authUser, expectedMeetingCode };

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

        let verifiedAt = 0;
        ws.on('message', async (data) => {
            try {
                if (!authenticated) {
                    if (authenticating) { ws.close(4003, 'Authentication already in progress'); return; }
                    let authMessage: any;
                    try { authMessage = JSON.parse(data.toString()); } catch { ws.close(4003, 'Authentication required'); return; }
                    if (authMessage?.jsonrpc !== '2.0' || authMessage?.method !== 'authenticate' || !Number.isInteger(authMessage?.id)) {
                        ws.close(4003, 'Authenticate before sending signaling requests');
                        return;
                    }
                    authenticating = true;
                    try {
                        const params = authMessage.params || {};
                        if (typeof params.ticket === 'string') {
                            const redeemed = await consumeWebSocketTicket(params.ticket);
                            if (!redeemed) throw new InvalidAuthentication('Invalid or expired signaling ticket');
                            authUser = await verifySession(redeemed.token);
                            if (authUser.sub !== redeemed.userId) throw new InvalidAuthentication('Ticket identity mismatch');
                            token = redeemed.token;
                            expectedMeetingCode = redeemed.meetingCode;
                            connectionState.authUser = authUser;
                            connectionState.expectedMeetingCode = expectedMeetingCode;
                            logger.info({ ip, userId: authUser.sub }, 'Authenticated signaling socket');
                        } else if (params.guest === true && !requireTerm) {
                            logger.info({ ip }, 'Guest signaling socket authenticated');
                        } else {
                            throw new InvalidAuthentication('A valid session ticket is required');
                        }
                        authenticated = true;
                        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ jsonrpc: '2.0', id: authMessage.id, result: { authenticated: true } }));
                    } catch (error) {
                        if (error instanceof InvalidAuthentication) ws.close(4003, error.message);
                        else {
                            logger.error({ ip, error }, 'Signaling ticket verification failed');
                            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ jsonrpc: '2.0', id: authMessage.id, error: { code: -32050, message: 'Authentication temporarily unavailable. Please retry.' } }));
                            ws.close(1011, 'Authentication temporarily unavailable');
                        }
                    }
                    return;
                }
                // Live caption audio/interim text arrive several times a second; re-use a session
                // check made in the last few seconds for those only, so the auth service is not hit per chunk.
                const streaming = STREAMING_METHODS.test(data.toString('utf8', 0, 64));
                if (token && !(streaming && authUser && Date.now() - verifiedAt < STREAMING_RECHECK_MS)) {
                    try {
                        authUser = await verifySession(token);
                        verifiedAt = Date.now();
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
