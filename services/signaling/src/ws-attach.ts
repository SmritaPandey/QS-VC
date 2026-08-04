import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { handleRpcMessage, handlePeerDisconnect } from './rpc/handler.js';
import { logger } from './logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

interface AuthPayload {
    sub: string;
    email: string;
    displayName: string;
    role: string;
    tenantId: string;
}

/** Attach JSON-RPC signaling WebSocket to an existing HTTP server. */
export function attachSignalingWebSocket(server: http.Server): WebSocketServer {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws: WebSocket, req) => {
        let authUser: AuthPayload | null = null;
        try {
            const parsedUrl = url.parse(req.url || '', true);
            const token = (parsedUrl.query.token as string)
                || req.headers.authorization?.replace('Bearer ', '');

            if (token) {
                authUser = jwt.verify(token, JWT_SECRET) as AuthPayload;
                logger.info(`WebSocket authenticated: ${authUser.email} from ${req.socket.remoteAddress}`);
            } else {
                logger.info(`WebSocket connected (guest) from ${req.socket.remoteAddress}`);
            }
        } catch {
            logger.warn(`WebSocket auth failed from ${req.socket.remoteAddress} — allowing as guest`);
        }

        const connectionState: {
            peerId?: string;
            roomId?: string;
            displayName?: string;
            authUser?: AuthPayload | null;
        } = { authUser };

        (ws as any).isAlive = true;
        ws.on('pong', () => { (ws as any).isAlive = true; });

        ws.on('message', async (data) => {
            try {
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
