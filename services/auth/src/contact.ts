import { Router, type Request, type Response, type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

type Database = { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> };
const contactBody = z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255),
    organisation: z.string().trim().max(200).optional(),
    topic: z.enum(['demo', 'pricing', 'deployment', 'support']),
    message: z.string().trim().min(1).max(4000),
    website: z.string().max(200).optional().default(''),
});

export function contactHandler(db: Database) {
    return async (req: Request, res: Response) => {
        const parsed = contactBody.safeParse(req.body);
        if (!parsed.success || parsed.data.website) {
            return res.status(400).json({ error: 'Check your enquiry fields and try again.' });
        }
        const { name, email, organisation, topic, message } = parsed.data;
        const id = randomUUID();
        try {
            const result = await db.query(
                `INSERT INTO contact_enquiries (id, name, email, organisation, topic, message)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [id, name, email, organisation || null, topic, message]
            );
            if (result.rows.length !== 1) throw new Error('Enquiry was not saved');
            return res.status(201).json({ id });
        } catch {
            // No upstream exception or enquiry content belongs in public responses or logs.
            return res.status(503).json({ error: 'Your enquiry could not be saved. Please try again later.' });
        }
    };
}

export function contactRouter(db: Database) {
    const router = Router();
    router.post('/', rateLimit({
        windowMs: 60 * 60 * 1000, max: 5,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'Too many enquiries. Please try again later.' },
    }), contactHandler(db));
    return router;
}

// The shared JSON parser runs before this router. Catch its errors before the logger can serialize error.body.
export const contactRequestError: ErrorRequestHandler = (error, req, res, next) => {
    if (!/^\/api\/auth\/contact\/?$/i.test(req.path)) return next(error);
    if (error?.status === 413 || error?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Your enquiry is too large. Shorten it and try again.' });
    }
    if (error?.status === 400 || error?.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Check your enquiry fields and try again.' });
    }
    return res.status(503).json({ error: 'Your enquiry could not be saved. Please try again later.' });
};
