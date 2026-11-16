import { type Router, type Request, type Response, type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import { isPlatformAdmin } from './platform-admins.js';
import { sessionErrorStatus } from './sessions.js';
import { adminDeployment } from './admin-deployment.js';

type Database = Pick<Pool, 'query'>;
const leadBody = z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255),
    platform: z.enum(['linux-installer', 'linux-package', 'vmware-ova', 'hyperv-vhdx', 'kvm-qcow2', 'windows-server', 'windows', 'macos-arm64', 'macos-x64', 'linux-x64']),
    consent: z.literal(true),
});

export function saveDownloadLead(db: Database) {
    return async (req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        if (adminDeployment().mode !== 'hosted-online') return res.sendStatus(404);
        const parsed = leadBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Enter your name, organisation email and permission for sales to contact you.' });
        const { name, email, platform } = parsed.data;
        const id = randomUUID();
        try {
            const result = await db.query(
                `INSERT INTO download_leads (id, name, email, platform, consent)
                 VALUES ($1, $2, $3, $4, true) RETURNING id`,
                [id, name, email.toLowerCase(), platform],
            );
            if (result.rows.length !== 1) throw new Error('Lead was not saved');
            return res.status(201).json({ id });
        } catch {
            return res.status(503).json({ error: 'Your details could not be saved. Try again or skip to download.' });
        }
    };
}

export function listDownloadLeads(verify: (token: string) => Promise<Record<string, any>>, db: Database) {
    return async (req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
        try {
            const user = await verify(header.slice(7));
            if (typeof user.email !== 'string' || !isPlatformAdmin(user.email)) return res.sendStatus(403);
        } catch (error) { return res.sendStatus(sessionErrorStatus(error)); }
        if (adminDeployment().mode !== 'hosted-online') return res.sendStatus(404);
        const cursor = z.string().uuid().optional().safeParse(req.query.cursor);
        if (!cursor.success) return res.status(400).json({ error: 'Invalid page cursor.' });
        try {
            const { rows } = await db.query(
                `SELECT id, name, email, platform, created_at AS "createdAt"
                 FROM download_leads
                 WHERE ($1::uuid IS NULL OR (created_at, id) <
                     (SELECT created_at, id FROM download_leads WHERE id = $1::uuid))
                 ORDER BY created_at DESC, id DESC LIMIT 101`,
                [cursor.data ?? null],
            );
            const leads = rows.slice(0, 100);
            return res.json({ leads, nextCursor: rows.length > 100 ? leads[99].id : null });
        } catch {
            return res.status(503).json({ error: 'Download leads could not be loaded. Try again.' });
        }
    };
}

export function registerDownloadLeadRoutes(router: Router, verify: (token: string) => Promise<Record<string, any>>, db: Database) {
    router.post('/download-leads', rateLimit({
        windowMs: 60 * 60 * 1000, max: 5,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'Too many submissions. You can still skip to download.' },
    }), saveDownloadLead(db));
    router.get('/download-leads', listDownloadLeads(verify, db));
}

// Parser failures must not send submitted contact details to the shared error logger.
export const downloadLeadRequestError: ErrorRequestHandler = (error, req, res, next) => {
    if (!/^\/api\/auth\/enterprise\/download-leads\/?$/i.test(req.path)) return next(error);
    const status = error?.status === 413 ? 413 : error?.status === 400 ? 400 : 503;
    return res.status(status).json({ error: 'Your details could not be saved. Try again or skip to download.' });
};
