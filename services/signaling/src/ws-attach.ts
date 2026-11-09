import { serviceSecret } from '../../../shared/service-secrets.cjs';
import jwt from 'jsonwebtoken';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleRpcMessage, handlePeerDisconnect } from './rpc/handler.js';
import { logger } from './logger.js';
import { consumeWebSocketTicket } from './ws-tickets.js';
import { roomManager } from './room-manager.js';

const AUTH_URL = (process.env.AUTH_INTERNAL_URL || 'http://localhost:4002').replace(/\/$/, '');

export class InvalidAuthentication extends Error {}

const STREAMING_RECHECK_MS = 15_000;
const TRUSTED_CLIENT_IP_HEADER = (process.env.WS_TRUST_PROXY_HEADER || '').trim().toLowerCase();

export function resolveClientAddress(req: http.IncomingMessage, trustedHeader = TRUSTED_CLIENT_IP_HEADER): string {
    // Only read a forwarding header when the deployment explicitly configures
    // a trusted proxy to overwrite it. Otherwise use the TCP peer address.
    const header = trustedHeader.trim().toLowerCase();
    if (header) {
        const forwarded = req.headers[header];
        if (typeof forwarded === 'string' && forwarded.trim()) {
            return header === 'x-forwarded-for'
                ? forwarded.split(',')[0].trim()
                : forwarded.trim();
        }
    }
    return req.socket.remoteAddress || 'unknown';
}

export async function verifySession(token: string): Promise<AuthPayload> {
    const response = await fetch(`${AUTH_URL}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}`, 'x-qsvc-service-token': jwt.sign({}, serviceSecret('INTERNAL_AUTH_SECRET'), { audience: 'qsvc-auth-verify', issuer: 'qsvc-internal', expiresIn: 30 }) },
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
    plan?: 'guest' | 'starter_trial' | 'starter' | 'pro_trial' | 'pro' | 'enterprise';
    status?: 'trial_active' | 'trial_expired' | 'paid_active' | 'enterprise_pending' | 'enterprise_approved' | 'enterprise_rejected';
    privateConversationLimitMs?: number | null;
}

/** Attach JSON-RPC signaling WebSocket to an existing HTTP server. */
export function attachSignalingWebSocket(server: http.Server): WebSocketServer {
    const requireTerm = process.env.QSVC_ENTERPRISE_TERMS_REQUIRED === 'yes';
    if (process.env.NODE_ENV === 'production' && process.env.CORS_ORIGINS === '*') {
        throw new Error('Production signaling requires explicit WebSocket origins; CORS_ORIGINS=* is not allowed');
    }
    // Production: only the configured website origins. Development and the LAN launcher (no
    // CORS_ORIGINS set) accept any origin, so http://<lan-ip>:5173 can join intranet meetings.
    const developmentAnyOrigin = process.env.NODE_ENV !== 'production' && !process.env.CORS_ORIGINS;
    const configuredOrigins = developmentAnyOrigin ? [] : (process.env.CORS_ORIGINS || process.env.WEB_URL || 'https://qs-vc.vercel.app')
        .split(',').map(value => value.trim()).filter(value => value && value !== '*')
        .flatMap(value => { try { return [new URL(value).origin]; } catch { return []; } });
    const allowedOrigins = new Set(configuredOrigins);
    const wss = new WebSocketServer({
        server, path: '/ws', maxPayload: 64 * 1024,
        verifyClient: (info, done) => {
            if (info.origin && allowedOrigins.size && !allowedOrigins.has(info.origin)) return done(false, 403, 'Origin not allowed');
            done(true);
        },
    });
    const ipCounts = new Map<string, { active: number; windowStart: number; upgrades: number; joins: number }>();
    const connections = new WeakMap<WebSocket, string>();
    const maxConnectionsPerIp = Math.max(1, Number(process.env.WS_MAX_CONNECTIONS_PER_IP) || 100);
    const maxUpgradesPerIp = Math.max(1, Number(process.env.WS_MAX_UPGRADES_PER_IP) || 150);
    const maxConnections = Math.max(1, Number(process.env.WS_MAX_CONNECTIONS) || 5000);
    const maxJoinsPerIp = Math.max(1, Number(process.env.WS_MAX_JOINS_PER_IP) || 60);
    const maxTrackedIpRecords = Math.max(1000, Number(process.env.WS_MAX_TRACKED_IPS) || 20_000);
    const ipWindowMs = 10 * 60 * 1000;
    let nextFullIpSweepAt = 0;

    wss.on('connection', (ws: WebSocket, req) => {
        const ip = resolveClientAddress(req);
        const now = Date.now();
        let limits = ipCounts.get(ip);
        if (!limits) {
            if (ipCounts.size >= maxTrackedIpRecords) {
                if (now >= nextFullIpSweepAt) {
                    nextFullIpSweepAt = now + 1000;
                    for (const [candidateIp, record] of ipCounts) {
                        if (record.active === 0 && now - record.windowStart >= ipWindowMs) ipCounts.delete(candidateIp);
                    }
                }
                if (ipCounts.size >= maxTrackedIpRecords) {
                    ws.close(1013, 'Signaling is at connection capacity');
                    return;
                }
            }
            limits = { active: 0, windowStart: now, upgrades: 0, joins: 0 };
            ipCounts.set(ip, limits);
        } else if (now - limits.windowStart >= ipWindowMs) {
            limits.windowStart = now;
            limits.upgrades = 0;
            limits.joins = 0;
        }
        limits.upgrades++;
        if (wss.clients.size >= maxConnections || limits.upgrades > maxUpgradesPerIp || limits.active >= maxConnectionsPerIp) {
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
            joinAttempts?: number;
        } = { authUser, expectedMeetingCode, joinAttempts: 0 };

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
        let queuedMessages = 0;
        let messageWindowStart = now;
        let messagesInWindow = 0;
        let messageChain = Promise.resolve();
        ws.on('message', (data) => {
            const receivedAt = Date.now();
            if (receivedAt - messageWindowStart >= 1000) { messageWindowStart = receivedAt; messagesInWindow = 0; }
            if (++messagesInWindow > 100) { ws.close(1013, 'Signaling message rate limit reached'); return; }
            if (queuedMessages >= 64) { ws.close(1013, 'Signaling is busy; reconnect and retry'); return; }
            queuedMessages++;
            messageChain = messageChain.then(async () => {
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
                            verifiedAt = Date.now();
                            connectionState.authUser = authUser;
                            connectionState.expectedMeetingCode = expectedMeetingCode;
                            logger.info({ ip, userId: authUser.sub }, 'Authenticated signaling socket');
                        } else if (params.guest === true && !requireTerm) {
                            logger.info({ ip }, 'Guest signaling socket authenticated');
                        } else {
                            throw new InvalidAuthentication('A valid session ticket is required');
                        }
                        authenticated = true;
                        roomManager.sendPayload(ws, { jsonrpc: '2.0', id: authMessage.id, result: { authenticated: true } }, ip);
                    } catch (error) {
                        if (error instanceof InvalidAuthentication) ws.close(4003, error.message);
                        else {
                            logger.error({ ip, error }, 'Signaling ticket verification failed');
                            roomManager.sendPayload(ws, { jsonrpc: '2.0', id: authMessage.id, error: { code: -32050, message: 'Authentication temporarily unavailable. Please retry.' } }, ip);
                            ws.close(1011, 'Authentication temporarily unavailable');
                        }
                    }
                    return;
                }
                // Bound auth-service load under bursty traffic while keeping session revocation checks frequent.
                if (token && !(authUser && Date.now() - verifiedAt < STREAMING_RECHECK_MS)) {
                    try {
                        authUser = await verifySession(token);
                        verifiedAt = Date.now();
                        connectionState.authUser = authUser;
                    } catch (error) {
                        if (error instanceof InvalidAuthentication) ws.close(4003, 'Session expired or invalid');
                        else {
                            const request = JSON.parse(data.toString());
                            roomManager.sendPayload(ws, { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32050, message: 'Authentication temporarily unavailable. Please retry.' } }, ip);
                        }
                        return;
                    }
                }
                if (ws.readyState !== WebSocket.OPEN) return;
                const message = JSON.parse(data.toString());

                if (message.jsonrpc !== '2.0' || !message.method) {
                    roomManager.sendPayload(ws, {
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
                    }, ip);
                    return;
                }

                if (message.method === 'joinRoom') {
                    const record = ipCounts.get(ip);
                    if (record && record.joins >= maxJoinsPerIp) {
                        roomManager.sendPayload(ws, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32003, message: 'Too many meeting join attempts from this network. Try again later.' } }, ip);
                        return;
                    }
                    if (record) record.joins++;
                }

                const response = await handleRpcMessage(ws, message, connectionState);
                if (response && message.id !== undefined) {
                    roomManager.sendPayload(ws, response, connectionState.peerId || ip);
                }
            } catch (err: any) {
                logger.error(err, 'Failed to process WebSocket message');
                roomManager.sendPayload(ws, {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' },
                }, connectionState.peerId || ip);
              } finally { queuedMessages--; }
            });
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
    const ipCleanupInterval = setInterval(() => {
        const current = Date.now();
        for (const [ip, limits] of ipCounts) {
            if (current - limits.windowStart < ipWindowMs) continue;
            if (limits.active === 0) ipCounts.delete(ip);
            else { limits.windowStart = current; limits.upgrades = 0; limits.joins = 0; }
        }
    }, ipWindowMs);

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
        clearInterval(ipCleanupInterval);
    });

    return wss;
}
