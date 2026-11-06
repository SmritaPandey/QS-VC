import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { isPlatformAdmin } from './platform-admins.js';
import { sessionErrorStatus } from './sessions.js';

const currencies = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'CAD', 'AUD'] as const;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const entryBody = z.object({
    type: z.enum(['revenue', 'expense']),
    category: z.string().trim().min(1).max(80),
    amount: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).refine(value => Number(value) > 0),
    currency: z.enum(currencies),
    occurredOn: dateOnly,
    description: z.string().trim().min(1).max(500),
});

type VerifyToken = (token: string) => Promise<Record<string, any>>;
type Database = Pick<Pool, 'query'>;

export function platformAdminAnalyticsRouter(verify: VerifyToken, db: Database) {
    const router = Router();
    const withPlatformAdmin = (handler: (req: Request, res: Response, admin: Record<string, any>) => Promise<unknown>) =>
        async (req: Request, res: Response) => {
            res.setHeader('Cache-Control', 'no-store');
            const authorization = req.headers.authorization;
            if (!authorization?.startsWith('Bearer ')) return res.sendStatus(401);
            try {
                const admin = await verify(authorization.slice(7));
                if (typeof admin.email !== 'string' || !isPlatformAdmin(admin.email)) return res.sendStatus(403);
                return await handler(req, res, admin);
            } catch (error) {
                const status = sessionErrorStatus(error);
                return res.status(status).json({ error: status === 401 ? 'Invalid session' : 'Analytics are temporarily unavailable.' });
            }
        };

    router.get('/access', withPlatformAdmin(async (_req, res) => res.json({ access: 'granted' })));

    router.get('/analytics', withPlatformAdmin(async (req, res) => {
        const quarters = z.string().regex(/^(?:[1-9]|1[0-2])$/).safeParse(req.query.quarters ?? '4');
        if (!quarters.success) return res.status(400).json({ error: 'Choose 1 to 12 calendar quarters.' });
        try {
            const result = await db.query('SELECT public.qsvc_platform_admin_analytics($1) AS analytics', [Number(quarters.data)]);
            return res.json(result.rows[0]?.analytics ?? {});
        } catch {
            return res.status(503).json({ error: 'Platform analytics are temporarily unavailable.' });
        }
    }));

    router.post('/financial-entries', withPlatformAdmin(async (req, res, admin) => {
        const entry = entryBody.safeParse(req.body);
        if (!entry.success) return res.status(400).json({ error: 'Check the financial entry fields and try again.' });
        if (typeof admin.sub !== 'string' || !z.string().uuid().safeParse(admin.sub).success) {
            return res.status(401).json({ error: 'Sign in again to record this entry.' });
        }
        try {
            const { data } = entry;
            const result = await db.query(
                'SELECT public.qsvc_add_platform_financial_entry($1, $2, $3, $4, $5, $6, $7) AS id',
                [admin.sub, data.type, data.category, data.amount, data.currency, data.occurredOn, data.description],
            );
            return res.status(201).json({ id: result.rows[0]?.id });
        } catch {
            return res.status(503).json({ error: 'The financial entry could not be saved.' });
        }
    }));

    return router;
}
