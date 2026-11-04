import express from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload { sub: string; tenantId: string; role: string; displayName: string; }

export function meetingAuth(AUTH_URL: string, runWithTenant: (tenantId: string, next: express.NextFunction) => unknown) {
    return async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        try {
            const response = await fetch(`${AUTH_URL}/api/auth/verify`, {
                headers: { Authorization: authHeader, 'x-qsvc-service-token': jwt.sign({}, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-auth-verify', issuer: 'qsvc-internal', expiresIn: 30 }) }, signal: AbortSignal.timeout(5000),
            });
            if (response.status === 401) return res.status(401).json({ error: 'Invalid token' });
            if (!response.ok) throw new Error('Authentication unavailable');
            const verified = await response.json() as { valid: boolean; payload: AuthPayload };
            if (!verified.valid || !verified.payload?.sub || !verified.payload.tenantId) throw new Error('Invalid authentication response');
            const payload = verified.payload;
            (req as any).user = payload;
            runWithTenant(payload.tenantId, next);
        } catch {
            return res.status(503).json({ error: 'Authentication temporarily unavailable' });
        }
    };
}

