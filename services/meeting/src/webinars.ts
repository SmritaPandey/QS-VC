import { Router, type Request, type Response, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Pool, PoolClient } from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthPayload } from './auth.js';

const mediaUrl = z.string().trim().max(2048).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use an HTTPS URL without credentials.');
export const webinarBody = z.object({
    meetingId: z.string().uuid(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000),
    registrationLimit: z.number().int().min(1).max(30000), published: z.boolean(),
    customFields: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), label: z.string().trim().min(1).max(100),
        type: z.enum(['text', 'email', 'tel', 'select']), required: z.boolean(), options: z.array(z.string().trim().min(1).max(100)).max(10).optional() })).max(8)
        .refine(fields => new Set(fields.map(field => field.id)).size === fields.length && fields.every(field => field.type !== 'select' || !!field.options?.length)),
    branding: z.object({ logoUrl: mediaUrl, backgroundUrl: mediaUrl, introVideoUrl: mediaUrl, accent: z.string().regex(/^#[a-f0-9]{6}$/i) }),
    speakers: z.array(z.object({ name: z.string().trim().min(1).max(100), role: z.enum(['speaker', 'moderator']), userId: z.string().uuid().optional() })).max(20),
});
const registrationBody = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(255),
    answers: z.record(z.string().max(31), z.string().trim().max(1000)).refine(answers => Object.keys(answers).length <= 8), consent: z.literal(true), website: z.literal('').optional() });
const idSchema = z.string().uuid();
type Webinar = z.infer<typeof webinarBody>;
export function validWebinarAnswers(fields: Webinar['customFields'], answers: Record<string, string>) {
    if (Object.keys(answers).some(key => !fields.some(field => field.id === key))) return false;
    return fields.every(field => {
        const value = answers[field.id]?.trim() || '';
        if (!value) return !field.required;
        if (field.type === 'email') return z.string().email().safeParse(value).success;
        return field.type !== 'select' || !!field.options?.includes(value);
    });
}
async function transaction<T>(pool: Pool, tenantId: string, run: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        const result = await run(client); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}
const projection = `w.id, w.public_id AS "publicId", w.meeting_id AS "meetingId", w.title, w.description,
    w.registration_limit AS "registrationLimit", w.published, w.custom_fields AS "customFields", w.branding, w.speakers,
    m.meeting_code AS "meetingCode", m.scheduled_start AS "scheduledStart", m.scheduled_end AS "scheduledEnd"`;
async function owner(client: PoolClient, id: string, user: AuthPayload, lock = false) {
    return (await client.query(`SELECT ${projection} FROM public.webinars w
        JOIN public.meetings m ON m.id = w.meeting_id AND m.tenant_id = w.tenant_id
        WHERE w.id = $1 AND w.tenant_id = $2 AND w.owner_id = $3 AND m.host_id = $3 ${lock ? 'FOR UPDATE OF w' : ''}`,
        [id, user.tenantId, user.sub])).rows[0];
}
export function webinarsRouter(pool: Pool, auth: RequestHandler, feature: RequestHandler) {
    const router = Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const publicLimit = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false });
    async function publicWebinar(publicId: unknown) {
        const parsed = idSchema.safeParse(publicId);
        if (!parsed.success) return null;
        return (await pool.query('SELECT * FROM public.qsvc_public_webinar($1)', [parsed.data])).rows[0] || null;
    }
    router.get('/public/:publicId', publicLimit, async (req, res) => {
        try {
            const ref = await publicWebinar(req.params.publicId); if (!ref) return res.sendStatus(404);
            const data = await transaction(pool, ref.tenant_id, async client => (await client.query(`SELECT ${projection}
                FROM public.webinars w JOIN public.meetings m ON m.id = w.meeting_id WHERE w.id = $1 AND w.published`, [ref.id])).rows[0]);
            if (!data) return res.sendStatus(404);
            return res.json(data);
        } catch { return res.status(503).json({ error: 'Webinar details are temporarily unavailable.' }); }
    });
    router.post('/public/:publicId/registrations', publicLimit, async (req, res) => {
        const parsed = registrationBody.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Check your registration fields and consent.' });
        try {
            const ref = await publicWebinar(req.params.publicId); if (!ref) return res.sendStatus(404);
            const receipt = randomBytes(32).toString('base64url'); const hash = createHash('sha256').update(receipt).digest('hex');
            const result = await transaction(pool, ref.tenant_id, async client => {
                const webinar = (await client.query(`SELECT custom_fields, registration_limit FROM public.webinars WHERE id = $1 AND published FOR UPDATE`, [ref.id])).rows[0];
                if (!webinar) return { status: 404 };
                if (!validWebinarAnswers(webinar.custom_fields, parsed.data.answers)) return { status: 400 };
                const count = (await client.query(`SELECT COUNT(*)::int AS count FROM public.webinar_registrations WHERE webinar_id = $1 AND status <> 'rejected'`, [ref.id])).rows[0].count;
                if (count >= webinar.registration_limit) return { status: 409 };
                const id = randomUUID();
                await client.query(`INSERT INTO public.webinar_registrations(id, webinar_id, tenant_id, name, email, answers, access_key_hash)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ref.id, ref.tenant_id, parsed.data.name, parsed.data.email.toLowerCase(), JSON.stringify(parsed.data.answers), hash]);
                return { status: 201, id };
            });
            if (result.status !== 201) return res.status(result.status).json({ error: result.status === 409 ? 'Registration is full.' : 'Check your registration fields.' });
            return res.status(201).json({ id: result.id, receipt, status: 'pending' });
        } catch (error) { return res.status((error as { code?: string }).code === '23505' ? 409 : 503).json({ error: 'Registration could not be saved. Check whether you already registered, or try later.' }); }
    });
    router.post('/public/:publicId/status', publicLimit, async (req, res) => {
        const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(req.body?.receipt);
        if (!token.success) return res.sendStatus(400);
        try {
            const ref = await publicWebinar(req.params.publicId); if (!ref) return res.sendStatus(404);
            const result = await transaction(pool, ref.tenant_id, async client => (await client.query(`SELECT r.status, m.meeting_code AS "meetingCode"
                FROM public.webinar_registrations r JOIN public.webinars w ON w.id = r.webinar_id JOIN public.meetings m ON m.id = w.meeting_id
                WHERE r.webinar_id = $1 AND r.access_key_hash = $2 AND w.published`, [ref.id, createHash('sha256').update(token.data).digest('hex')])).rows[0]);
            if (!result) return res.sendStatus(404);
            return res.json({ status: result.status, ...(result.status === 'approved' ? { meetingCode: result.meetingCode } : {}) });
        } catch { return res.status(503).json({ error: 'Registration status is temporarily unavailable.' }); }
    });
    router.use(auth, feature);
    router.get('/owned-meetings', async (req, res) => {
        const user = (req as unknown as { user: AuthPayload }).user;
        try { return res.json({ meetings: await transaction(pool, user.tenantId, async client => (await client.query(`SELECT id, title, meeting_code AS "meetingCode", scheduled_start AS "scheduledStart"
            FROM public.meetings WHERE tenant_id = $1 AND host_id = $2 AND settings->>'meetingKind' = 'webinar' AND status IN ('waiting', 'active') ORDER BY COALESCE(scheduled_start, created_at) DESC LIMIT 100`, [user.tenantId, user.sub])).rows) }); }
        catch { return res.sendStatus(503); }
    });
    router.get('/', async (req, res) => {
        const user = (req as unknown as { user: AuthPayload }).user;
        try { return res.json({ webinars: await transaction(pool, user.tenantId, async client => (await client.query(`SELECT ${projection} FROM public.webinars w
            JOIN public.meetings m ON m.id = w.meeting_id AND m.tenant_id = w.tenant_id WHERE w.tenant_id = $1 AND w.owner_id = $2 AND m.host_id = $2 ORDER BY w.created_at DESC LIMIT 100`, [user.tenantId, user.sub])).rows) }); }
        catch { return res.sendStatus(503); }
    });
    async function save(req: Request, res: Response) {
        const parsed = webinarBody.safeParse(req.body); const id = req.params.id ? idSchema.safeParse(req.params.id) : null;
        if (!parsed.success || id && !id.success) return res.status(400).json({ error: 'Check the webinar settings, fields and HTTPS media URLs.' });
        const user = (req as unknown as { user: AuthPayload }).user; const data = parsed.data;
        try {
            const result = await transaction(pool, user.tenantId, async client => {
                if (id?.success) {
                    const previous = await owner(client, id.data, user, true);
                    if (!previous) return null;
                    // Keep existing registrations attached to their original room.
                    if (previous.meetingId !== data.meetingId) throw new Error('MEETING_FIXED');
                    const registrations = (await client.query(`SELECT COUNT(*)::int AS count FROM public.webinar_registrations WHERE webinar_id = $1 AND status <> 'rejected'`, [id.data])).rows[0].count;
                    if (registrations > data.registrationLimit) throw new Error('CAPACITY');
                    await client.query(`UPDATE public.webinars SET title=$2, description=$3, registration_limit=$4, published=$5, custom_fields=$6, branding=$7, speakers=$8, updated_at=NOW() WHERE id=$1`,
                        [id.data, data.title, data.description, data.registrationLimit, data.published, JSON.stringify(data.customFields), JSON.stringify(data.branding), JSON.stringify(data.speakers)]);
                    return { id: id.data, publicId: previous.publicId };
                }
                // Registration must never change the live room's publishing policy.
                const meeting = (await client.query(`SELECT id FROM public.meetings
                    WHERE id = $1 AND tenant_id = $2 AND host_id = $3
                    AND settings->>'meetingKind' = 'webinar' AND status IN ('waiting', 'active') FOR UPDATE`,
                [data.meetingId, user.tenantId, user.sub])).rows[0];
                if (!meeting) return null;
                const webinarId = randomUUID(); const publicId = randomUUID();
                await client.query(`INSERT INTO public.webinars(id,public_id,tenant_id,meeting_id,owner_id,title,description,registration_limit,published,custom_fields,branding,speakers)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [webinarId,publicId,user.tenantId,data.meetingId,user.sub,data.title,data.description,data.registrationLimit,data.published,JSON.stringify(data.customFields),JSON.stringify(data.branding),JSON.stringify(data.speakers)]);
                return { id: webinarId, publicId };
            });
            if (!result) return res.sendStatus(404);
            return res.status(id ? 200 : 201).json(result);
        } catch (error) { return res.status(['CAPACITY','MEETING_FIXED'].includes((error as Error).message) ? 409 : 503).json({ error: 'Webinar settings could not be saved. Keep the linked meeting and allow room for existing registrations.' }); }
    }
    router.post('/', save); router.patch('/:id', save);
    router.get('/:id', async (req, res) => {
        const user = (req as unknown as { user: AuthPayload }).user; if (!idSchema.safeParse(req.params.id).success) return res.sendStatus(400);
        const limit = z.coerce.number().int().min(1).max(100).safeParse(req.query.limit ?? 100);
        const offset = z.coerce.number().int().min(0).max(100000).safeParse(req.query.offset ?? 0);
        if (!limit.success || !offset.success) return res.status(400).json({ error: 'Invalid registration page.' });
        try {
            const data = await transaction(pool, user.tenantId, async client => {
                const webinar = await owner(client, String(req.params.id), user); if (!webinar) return null;
                const registrations = (await client.query(`SELECT id,name,email,answers,status,created_at AS "createdAt" FROM public.webinar_registrations WHERE webinar_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [webinar.id, limit.data + 1, offset.data])).rows;
                return { ...webinar, registrations: registrations.slice(0, limit.data), registrationOffset: offset.data,
                    nextOffset: registrations.length > limit.data ? offset.data + limit.data : null };
            });
            return data ? res.json(data) : res.sendStatus(404);
        } catch { return res.sendStatus(503); }
    });
    router.patch('/:id/registrations/:registrationId', async (req, res) => {
        const user = (req as unknown as { user: AuthPayload }).user; const decision = z.enum(['approved','rejected']).safeParse(req.body?.status);
        if (!decision.success || !idSchema.safeParse(req.params.id).success || !idSchema.safeParse(req.params.registrationId).success) return res.sendStatus(400);
        try {
            const result = await transaction(pool, user.tenantId, async client => {
                const webinar = await owner(client, String(req.params.id), user, true); if (!webinar) return false;
                const registration = (await client.query(`SELECT * FROM public.webinar_registrations WHERE id=$1 AND webinar_id=$2 FOR UPDATE`, [req.params.registrationId, webinar.id])).rows[0];
                if (!registration) return false;
                if (decision.data === 'approved') {
                    const count = (await client.query(`SELECT COUNT(*)::int AS count FROM public.webinar_registrations WHERE webinar_id=$1 AND status <> 'rejected' AND id<>$2`, [webinar.id,registration.id])).rows[0].count;
                    if (count >= webinar.registrationLimit) throw new Error('CAPACITY');
                    const expires = new Date(new Date(webinar.scheduledEnd || webinar.scheduledStart).getTime() + 86_400_000);
                    await client.query(`INSERT INTO public.guest_access_tokens(id,meeting_id,tenant_id,token_hash,created_by,expires_at,max_uses,webinar_registration_id)
                        VALUES ($1,$2,$3,$4,$5,$6,1000,$7) ON CONFLICT(token_hash) DO UPDATE SET revoked_at=NULL, expires_at=EXCLUDED.expires_at`,
                        [randomUUID(),webinar.meetingId,user.tenantId,registration.access_key_hash,user.sub,expires,registration.id]);
                } else await client.query(`UPDATE public.guest_access_tokens SET revoked_at=NOW() WHERE webinar_registration_id=$1 AND tenant_id=$2`, [registration.id,user.tenantId]);
                await client.query(`UPDATE public.webinar_registrations SET status=$2,reviewed_at=NOW() WHERE id=$1`, [registration.id,decision.data]);
                return true;
            });
            return result ? res.json({ status: decision.data }) : res.sendStatus(404);
        } catch { return res.status(409).json({ error: 'Registration could not be updated. Check the registration limit and try again.' }); }
    });
    return router;
}
