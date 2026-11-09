import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { serviceSecret } from '../../../shared/service-secrets.cjs';
import { sessionErrorStatus } from './sessions.js';

export function turnCredentials(verify: (token: string) => Promise<jwt.JwtPayload>) {
    return async (req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            let subject: string;
            const serviceToken = req.headers['x-qsvc-turn-access'];
            if (typeof serviceToken === 'string') {
                const access = jwt.verify(serviceToken, serviceSecret('TURN_ACCESS_SECRET'), {
                    algorithms: ['HS256'], audience: 'qsvc-turn', issuer: 'qsvc-signaling', maxAge: 30,
                });
                if (typeof access === 'string' || typeof access.sub !== 'string' || !access.sub || typeof access.meeting !== 'string') return res.sendStatus(401);
                subject = access.sub;
            } else {
                const header = req.headers.authorization;
                if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Join a meeting or sign in to use the relay.' });
                const account = await verify(header.slice(7));
                if (!account.sub) return res.sendStatus(401);
                subject = account.sub;
            }
            const secret = process.env.TURN_SECRET || (process.env.NODE_ENV === 'development' ? 'dev-turn-secret-change-in-production' : '');
            if (!['development', 'test'].includes(process.env.NODE_ENV || '')
                && (Buffer.byteLength(secret) < 32 || secret.startsWith('dev-') || secret === process.env.JWT_SECRET)) {
                return res.status(503).json({ error: 'Meeting relay is not configured securely.' });
            }
            const urls = (process.env.TURN_SERVERS || '').split(',').map(value => value.trim()).filter(value => /^turns?:/i.test(value));
            const stun = (process.env.STUN_SERVERS || '').split(',').map(value => value.trim()).filter(value => /^stuns?:/i.test(value));
            if (!secret || !urls.length) return res.status(503).json({ error: 'Meeting relay is not configured.' });
            const ttl = 3600;
            const username = `${Math.floor(Date.now() / 1000) + ttl}:${crypto.createHash('sha256').update(subject).digest('hex').slice(0, 24)}`;
            const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
            return res.json({ iceServers: [...(stun.length ? [{ urls: stun }] : []), { urls, username, credential }], ttl });
        } catch (error) {
            const status = sessionErrorStatus(error);
            return res.status(status).json({ error: status === 401 ? 'Invalid relay access.' : 'Meeting relay is temporarily unavailable.' });
        }
    };
}
