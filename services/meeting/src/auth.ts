import { serviceSecret } from '../../../shared/service-secrets.cjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { FEATURE_MIN_PLAN } from '../../../shared/entitlements.cjs';

export interface AuthPayload { sub: string; tenantId: string; role: string; displayName: string; }

export function requireFeature(AUTH_URL: string, feature: string) {
    return async function featureMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
        const requiredPlan = FEATURE_MIN_PLAN[feature];
        if (!requiredPlan) return res.status(500).json({ error: 'Feature access is not configured' });
        try {
            const authorization = req.headers.authorization;
            const response = await fetch(`${AUTH_URL}/api/auth/me/entitlements`, {
                headers: authorization ? { Authorization: authorization } : {},
                signal: AbortSignal.timeout(5000),
            });
            if (response.status === 401) return res.status(401).json({ error: 'Invalid session' });
            if (!response.ok) return res.status(503).json({ error: 'Entitlements temporarily unavailable' });
            const entitlements = await response.json() as { features?: unknown };
            if (!Array.isArray(entitlements.features) || !entitlements.features.includes(feature)) {
                return res.status(403).json({ code: 'UPGRADE_REQUIRED', requiredPlan, feature });
            }
            next();
        } catch {
            res.status(503).json({ error: 'Entitlements temporarily unavailable' });
        }
    };
}

export function meetingAuth(AUTH_URL: string, runWithTenant: (tenantId: string, next: express.NextFunction) => unknown) {
    return async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        try {
            const response = await fetch(`${AUTH_URL}/api/auth/verify`, {
                headers: { Authorization: authHeader, 'x-qsvc-service-token': jwt.sign({}, serviceSecret('INTERNAL_AUTH_SECRET'), { audience: 'qsvc-auth-verify', issuer: 'qsvc-internal', expiresIn: 30 }) }, signal: AbortSignal.timeout(5000),
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

