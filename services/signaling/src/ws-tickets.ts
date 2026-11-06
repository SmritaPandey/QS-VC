import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { config } from './config.js';

export interface WebSocketTicketPayload {
    token: string;
    userId: string;
    meetingCode: string;
}

const TICKET_TTL_SECONDS = 30;
const allowProcessLocalTickets = process.env.NODE_ENV !== 'production' || process.env.WS_TICKET_STORE === 'memory';
const redisOptions = { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null } as const;
const redis = config.redisUrl ? new Redis(config.redisUrl, redisOptions)
    : process.env.REDIS_PASSWORD ? new Redis({ host: config.redis.host, port: config.redis.port, password: process.env.REDIS_PASSWORD, ...redisOptions })
        : null;
const memoryTickets = new Map<string, { payload: WebSocketTicketPayload; expiresAt: number }>();

async function readyRedis(): Promise<Redis | null> {
    if (!redis) return null;
    if (redis.status === 'wait') await redis.connect();
    if (redis.status !== 'ready') throw new Error('Signaling ticket storage is unavailable');
    return redis;
}

/** Short-lived, single-use exchange. Production requires Redis so all replicas share consumption. */
export async function createWebSocketTicket(payload: WebSocketTicketPayload): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    const store = await readyRedis();
    if (store) {
        const saved = await store.set(`qsvc:ws-ticket:${ticket}`, JSON.stringify(payload), 'EX', TICKET_TTL_SECONDS, 'NX');
        if (saved !== 'OK') throw new Error('Could not create signaling ticket');
    } else if (!allowProcessLocalTickets) {
        throw new Error('Signaling ticket storage is not configured');
    } else {
        if (memoryTickets.size >= 10000) {
            const now = Date.now();
            for (const [key, record] of memoryTickets) if (record.expiresAt <= now) memoryTickets.delete(key);
        }
        if (memoryTickets.size >= 10000) throw new Error('Signaling ticket capacity reached');
        memoryTickets.set(ticket, { payload, expiresAt: Date.now() + TICKET_TTL_SECONDS * 1000 });
    }
    return ticket;
}

/** Atomic Redis GET+DEL means only one concurrent connection can redeem a ticket. */
export async function consumeWebSocketTicket(ticket: string): Promise<WebSocketTicketPayload | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
    const store = await readyRedis();
    let value: string | null;
    if (store) {
        value = await store.eval(
            "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
            1,
            `qsvc:ws-ticket:${ticket}`,
        ) as string | null;
    } else if (!allowProcessLocalTickets) {
        throw new Error('Signaling ticket storage is not configured');
    } else {
        const record = memoryTickets.get(ticket);
        memoryTickets.delete(ticket);
        value = record && record.expiresAt > Date.now() ? JSON.stringify(record.payload) : null;
    }
    if (!value) return null;
    try {
        const payload = JSON.parse(value) as WebSocketTicketPayload;
        if (typeof payload.token !== 'string' || typeof payload.userId !== 'string' || typeof payload.meetingCode !== 'string') return null;
        return payload;
    } catch { return null; }
}

