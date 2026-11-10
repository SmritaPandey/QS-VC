import type { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { serviceSecret } from '../../../shared/service-secrets.cjs';

type MeetingDatabase = { query(sql: string, values: unknown[]): Promise<{ rows: unknown[] }> };

/** The authenticated signaling service supplies the organiser's verified session identity. */
export function endHostedMeeting(db: MeetingDatabase & { runWithTenant<T>(tenantId: string, action: () => T): T }) {
    return async (req: Request, res: Response) => {
        try {
            jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), serviceSecret('MEETING_POLICY_SECRET'), {
                algorithms: ['HS256'], audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', maxAge: 30,
            });
        } catch { return res.status(401).json({ error: 'Invalid service authentication' }); }
        const actor = z.object({ hostId: z.string().uuid(), tenantId: z.string().uuid(), action: z.enum(['end', 'cancel']).default('end') }).strict().safeParse(req.body);
        const code = z.string().regex(/^[A-Z0-9-]{4,32}$/).safeParse(req.params.code);
        if (!actor.success || !code.success) return res.status(400).json({ error: 'Invalid meeting or organiser identity' });
        try {
            const { hostId, tenantId, action } = actor.data;
            const result = await db.runWithTenant(tenantId, () => db.query(
                action === 'cancel'
                    ? `UPDATE meetings SET status = 'cancelled', updated_at = NOW()
                 WHERE meeting_code = $1 AND tenant_id = $2 AND host_id = $3
                   AND type = 'instant' AND scheduled_start IS NULL AND status IN ('waiting', 'cancelled')
                 RETURNING id`
                    : `UPDATE meetings SET status = 'ended', actual_end = COALESCE(actual_end, NOW()), updated_at = NOW()
                 WHERE meeting_code = $1 AND tenant_id = $2 AND host_id = $3 AND status IN ('active', 'ended')
                 RETURNING id`,
                [code.data, tenantId, hostId],
            ));
            if (!result.rows.length) return res.status(404).json({ error: 'Meeting not found, not owned by you or no longer editable' });
            return res.json({ updated: true });
        } catch {
            return res.status(503).json({ error: 'The meeting status could not be saved. Refresh its status or try again.' });
        }
    };
}

