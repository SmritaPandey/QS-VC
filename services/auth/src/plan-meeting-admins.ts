import { Router } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import type { Pool } from 'pg';
import { z } from 'zod';
import { sessionErrorStatus } from './sessions.js';

const grantInput = z.object({
    email: z.string().trim().email().max(254),
    role: z.enum(['admin', 'co_admin']),
}).strict();

export function planMeetingAdmins(pool: Pool, verifyToken: (token: string) => Promise<JwtPayload>) {
    const router = Router();
    router.use(async (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
        try {
            const user = await verifyToken(header.slice(7));
            const owner = await pool.query('SELECT 1 FROM public.meeting_plan_owners WHERE id = $1 AND tenant_id = $2', [user.sub, user.tenantId]);
            if (!owner.rows.length) return res.status(403).json({ error: 'An active Business or approved Enterprise plan is required.' });
            res.locals.planOwner = user;
            next();
        } catch (error) {
            res.sendStatus(sessionErrorStatus(error));
        }
    });

    router.get('/', async (_req, res) => {
        const { sub, tenantId } = res.locals.planOwner;
        try {
            const result = await pool.query(
                `SELECT u.id, u.email, u.display_name AS "displayName", a.role
                 FROM public.plan_meeting_admins a JOIN public.users u ON u.id = a.delegate_id AND u.tenant_id = a.tenant_id
                 WHERE a.owner_id = $1 AND a.tenant_id = $2 ORDER BY lower(u.email)`,
                [sub, tenantId],
            );
            res.json({ admins: result.rows });
        } catch { res.sendStatus(503); }
    });

    router.put('/', async (req, res) => {
        const input = grantInput.safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Enter an account email and choose an admin role.' });
        const { sub, tenantId } = res.locals.planOwner;
        try {
            const result = await pool.query(
                `INSERT INTO public.plan_meeting_admins (tenant_id, owner_id, delegate_id, role)
                 SELECT owner.tenant_id, owner.id, u.id, $4
                 FROM public.meeting_plan_owners owner
                 JOIN public.users u ON u.tenant_id = owner.tenant_id AND u.is_active AND lower(u.email) = lower($3)
                 WHERE owner.id = $1 AND owner.tenant_id = $2 AND u.id <> owner.id
                 ON CONFLICT (tenant_id, owner_id, delegate_id) DO UPDATE SET role = EXCLUDED.role
                 RETURNING delegate_id`,
                [sub, tenantId, input.data.email, input.data.role],
            );
            if (!result.rows.length) return res.status(404).json({ error: 'Use the email of another active QS-VC account in your organisation.' });
            res.sendStatus(204);
        } catch { res.sendStatus(503); }
    });

    router.delete('/:id', async (req, res) => {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.sendStatus(400);
        const { sub, tenantId } = res.locals.planOwner;
        try {
            await pool.query('DELETE FROM public.plan_meeting_admins WHERE owner_id = $1 AND tenant_id = $2 AND delegate_id = $3', [sub, tenantId, id.data]);
            res.sendStatus(204);
        } catch { res.sendStatus(503); }
    });
    return router;
}
