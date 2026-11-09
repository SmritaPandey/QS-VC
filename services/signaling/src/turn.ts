import jwt from 'jsonwebtoken';
import { serviceSecret } from '../../../shared/service-secrets.cjs';

export async function admittedPeerIceServers(peerId: string, meeting: string) {
    const token = jwt.sign({ meeting }, serviceSecret('TURN_ACCESS_SECRET'), {
        algorithm: 'HS256', issuer: 'qsvc-signaling', audience: 'qsvc-turn', subject: peerId, expiresIn: 30,
    });
    const base = (process.env.AUTH_INTERNAL_URL || 'http://localhost:4002').replace(/\/$/, '');
    const response = await fetch(`${base}/api/auth/turn-credentials`, {
        headers: { 'x-qsvc-turn-access': token }, signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Meeting relay is temporarily unavailable.');
    return response.json() as Promise<{ iceServers: { urls: string[]; username?: string; credential?: string }[]; ttl: number }>;
}
