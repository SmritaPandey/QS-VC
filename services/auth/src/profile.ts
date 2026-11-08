import type { Request, Response } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import { sessionErrorStatus } from './sessions.js';
import { effectiveRole } from './platform-admins.js';

export function profileHandler(verifyToken: (token: string) => Promise<JwtPayload>, pool: { query: (sql: string, values: unknown[]) => Promise<{ rows: any[] }> }) {
    return async (req: Request, res: Response) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader?.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const payload = await verifyToken(authHeader.slice(7));
            const result = await pool.query(
                `SELECT id, tenant_id, email, display_name, phone_number, role, avatar_url, preferences, created_at
           FROM users WHERE id = $1`,
                [payload.sub]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const user = result.rows[0];
            res.json({
                id: user.id,
                email: user.email,
                displayName: user.display_name,
                phoneNumber: user.phone_number,
                role: typeof user.email === 'string' ? effectiveRole(user.email, user.role) : user.role,
                avatarUrl: user.avatar_url,
                preferences: Object.fromEntries(Object.entries(user.preferences || {}).filter(([key]) => key !== '_authSessionId')),
                tenantId: user.tenant_id,
                createdAt: user.created_at,
            });
        } catch (err) {
            const status = sessionErrorStatus(err);
            res.status(status).json({ error: status === 401 ? 'Invalid token' : 'Authentication temporarily unavailable' });
        }
    };
}
