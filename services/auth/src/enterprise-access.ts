import { Router, type Request, type Response } from 'express';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Pool } from 'pg';
import { isPlatformAdmin } from './platform-admins.js';
import { sessionErrorStatus } from './sessions.js';

// Server-managed explicit user IDs prevent self-registration into an approved tenant
// from granting download access. Never accept entitlement from browser parameters.
const termBody = z.object({
    workspaceUrl: z.string().max(2048).url().refine(value => {
        const url = URL.canParse(value) ? new URL(value) : null;
        return !!url && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    }),
    expiresAt: z.string().datetime({ offset: true }),
});
const activationBody = z.object({
    platform: z.enum(['win32', 'darwin', 'linux']),
    architecture: z.enum(['x64', 'arm64']),
    appVersion: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.+-]+$/),
});
const approvalBody = z.object({ status: z.enum(['enterprise_approved', 'enterprise_rejected']) });

async function sendApprovalEmail(email: string, status: 'enterprise_approved' | 'enterprise_rejected') {
    const apiKey = process.env.QSVC_EMAIL_API_KEY;
    const from = process.env.QSVC_EMAIL_FROM;
    if (!apiKey || !from) return false;
    const approved = status === 'enterprise_approved';
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to: [email],
            subject: approved ? 'Your QS-VC Enterprise access is approved' : 'Your QS-VC Enterprise request update',
            text: approved
                ? 'Your QS-VC Enterprise access has been approved. Sign in to continue.'
                : 'Your QS-VC Enterprise access request was not approved. Contact your organisation administrator for details.',
        }),
        signal: AbortSignal.timeout(8000),
    });
    return response.ok;
}

export function enterpriseRouter(
    verify: (token: string) => Promise<Record<string, any>>,
    db?: Pick<Pool, 'query'>,
    notify: typeof sendApprovalEmail = sendApprovalEmail,
) {
    const router = Router();
    const withAdmin = (handle: (req: Request, res: Response, adminId: string) => Promise<unknown>) =>
        async (req: Request, res: Response) => {
            res.setHeader('Cache-Control', 'no-store');
            const header = req.headers.authorization;
            if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
            try {
                const admin = await verify(header.slice(7));
                if (typeof admin.email !== 'string' || !isPlatformAdmin(admin.email)) return res.sendStatus(403);
                return await handle(req, res, admin.sub);
            } catch (error) {
                return res.sendStatus(sessionErrorStatus(error));
            }
        };
    if (db) router.get('/terms', withAdmin(async (req, res) => {
        if (req.query.email === undefined) return res.sendStatus(204);
        const email = z.string().trim().email().max(255).safeParse(req.query.email);
        if (!email.success) return res.sendStatus(400);
        const { rows } = await db.query(
            `SELECT u.id, u.email, u.display_name, t.workspace_url, t.expires_at
             FROM users u LEFT JOIN enterprise_access_terms t ON t.user_id = u.id
             WHERE lower(u.email) = lower($1) AND u.is_active
               AND EXISTS (SELECT 1 FROM tenants WHERE id = u.tenant_id AND is_active)
             LIMIT 2`,
            [email.data],
        );
        if (!rows.length) return res.sendStatus(404);
        if (rows.length !== 1) return res.sendStatus(409);
        return res.json(rows[0]);
    }));
    if (db) router.put('/terms/:userId', withAdmin(async (req, res, adminId) => {
        const term = termBody.safeParse(req.body);
        const id = z.string().uuid().safeParse(req.params.userId);
        if (!term.success || !id.success || Date.parse(term.data.expiresAt) <= Date.now()) {
            return res.status(400).json({ error: 'Provide a user ID, an HTTPS workspace and a future expiry with a time zone.' });
        }
        const result = await db.query(
            `INSERT INTO enterprise_access_terms (user_id, workspace_url, expires_at, approved_by)
             SELECT id, $2, $3, $4 FROM users WHERE id = $1 AND is_active
               AND EXISTS (SELECT 1 FROM tenants WHERE id = users.tenant_id AND is_active)
             ON CONFLICT (user_id) DO UPDATE SET workspace_url = EXCLUDED.workspace_url,
             expires_at = EXCLUDED.expires_at, approved_by = EXCLUDED.approved_by, updated_at = now()
             RETURNING user_id, workspace_url, expires_at`,
            [id.data, term.data.workspaceUrl, term.data.expiresAt, adminId],
        );
        if (!result.rows.length) return res.sendStatus(404);
        return res.json(result.rows[0]);
    }));
    if (db) {
        const withApprovalAdmin = (handle: (req: Request, res: Response, adminId: string, tenantId: string) => Promise<unknown>) =>
            async (req: Request, res: Response) => {
                res.setHeader('Cache-Control', 'no-store');
                const header = req.headers.authorization;
                if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
                try {
                    const admin = await verify(header.slice(7));
                    if (admin.role !== 'admin' || typeof admin.sub !== 'string' || typeof admin.tenantId !== 'string') return res.sendStatus(403);
                    return await handle(req, res, admin.sub, admin.tenantId);
                } catch (error) { return res.sendStatus(sessionErrorStatus(error)); }
            };
        router.post('/approval-request', async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            const header = req.headers.authorization;
            if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
            try {
                const user = await verify(header.slice(7));
                const { rows } = await db.query(
                    `UPDATE users SET subscription_plan = 'enterprise', enterprise_status = 'enterprise_pending',
                                      enterprise_reviewed_by = NULL, enterprise_reviewed_at = NULL, updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2 AND is_active
                       AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = users.tenant_id AND t.is_active)
                       AND enterprise_status IS DISTINCT FROM 'enterprise_approved'
                     RETURNING enterprise_status AS status`,
                    [user.sub, user.tenantId],
                );
                if (!rows.length) return res.status(409).json({ error: 'Approved Enterprise access cannot be requested again.' });
                return res.status(202).json(rows[0]);
            } catch (error) { return res.status(sessionErrorStatus(error)).json({ error: 'Enterprise request could not be submitted.' }); }
        });
        router.get('/approval-requests', withApprovalAdmin(async (_req, res, _adminId, tenantId) => {
            const { rows } = await db.query(
                `SELECT id AS "userId", email, display_name AS "displayName", created_at AS "requestedAt"
                 FROM users WHERE tenant_id = $1 AND subscription_plan = 'enterprise' AND enterprise_status = 'enterprise_pending'
                 ORDER BY created_at ASC`,
                [tenantId],
            );
            return res.json({ requests: rows });
        }));
        router.patch('/approval-requests/:userId', withApprovalAdmin(async (req, res, adminId, tenantId) => {
            const id = z.string().uuid().safeParse(req.params.userId);
            const decision = approvalBody.safeParse(req.body);
            if (!id.success || !decision.success) return res.status(400).json({ error: 'Provide a valid user ID and approval decision.' });
            const { rows } = await db.query(
                `UPDATE users SET enterprise_status = $2, enterprise_reviewed_by = $3,
                                  enterprise_reviewed_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND subscription_plan = 'enterprise' AND enterprise_status = 'enterprise_pending'
                   AND tenant_id = $4
                 RETURNING email, enterprise_status AS status`,
                [id.data, decision.data.status, adminId, tenantId],
            );
            if (!rows.length) return res.status(409).json({ error: 'Enterprise request is no longer pending.' });
            let notificationSent = false;
            try { notificationSent = await notify(rows[0].email, decision.data.status); } catch { /* Access decisions persist even if email is unavailable. */ }
            return res.json({ status: rows[0].status, notificationSent });
        }));
    }
    router.use(async (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const header = req.headers.authorization;
            if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Sign in to check enterprise access.' }); return; }
            const user = await verify(header.slice(7));
            const term = db && (await db.query(
                'SELECT workspace_url, expires_at, expires_at > now() AS active FROM enterprise_access_terms WHERE user_id = $1',
                [user.sub],
            )).rows[0];
            if (term && !term.active) {
                return res.status(403).json({ error: 'Your enterprise access term has expired.' });
            }
            if (term) res.locals.expiresAt = term.expires_at;
            const grants = JSON.parse(process.env.ENTERPRISE_ACCESS_JSON || '[]');
            let grant = term ? { workspaceUrl: term.workspace_url } : Array.isArray(grants) ? grants.find(g => g.tenantId === user.tenantId && Array.isArray(g.userIds) && g.userIds.includes(user.sub)) : undefined;
            // Platform admins (role from the server-signed session) may use the intranet without a
            // per-user grant. They get QSVC_ADMIN_WORKSPACE_URL, or the first configured workspace.
            const platformAdmin = typeof user.email === 'string' && isPlatformAdmin(user.email);
            if (!grant && platformAdmin) {
                // Until an isolated enterprise workspace is configured, platform
                // admins can use the shared online QS-VC app as a clearly marked test workspace.
                const workspaceUrl = process.env.QSVC_ADMIN_WORKSPACE_URL
                    || (Array.isArray(grants) ? grants[0]?.workspaceUrl : undefined)
                    || 'https://qsvcmeet.com/app';
                if (workspaceUrl) grant = { workspaceUrl };
            }
            if (!grant) { res.status(403).json({ error: 'Your account has not been approved for enterprise access.' }); return; }
            const url = new URL(grant.workspaceUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid workspace configuration');
            res.locals.workspaceUrl = url.href;
            res.locals.workspaceMode = platformAdmin && ['qsvcmeet.com', 'www.qsvcmeet.com'].includes(url.hostname.toLowerCase())
                ? 'online-demo'
                : 'organisation';
            next();
        } catch (error) {
            const status = sessionErrorStatus(error);
            res.status(status).json({ error: status === 401
                ? 'Sign in to check enterprise access.'
                : 'Enterprise access could not be verified. Try again.' });
        }
    });
    async function installer() {
        const configured = {
            windows: process.env.ENTERPRISE_WINDOWS_INSTALLER,
            macAppleSilicon: process.env.ENTERPRISE_MACOS_ARM64_INSTALLER,
            macIntel: process.env.ENTERPRISE_MACOS_X64_INSTALLER,
            linuxX64: process.env.ENTERPRISE_LINUX_X64_INSTALLER,
        };
        const extensions = { windows: '.zip', macAppleSilicon: '.zip', macIntel: '.zip', linuxX64: '.tar.gz' } as const;
        const available = async (platform: keyof typeof configured) => {
            const file = configured[platform];
            if (!file || !path.isAbsolute(file) || !file.toLowerCase().endsWith(extensions[platform])) return false;
            try { return (await stat(file)).isFile(); } catch { return false; }
        };
        return {
            windows: await available('windows'),
            macAppleSilicon: await available('macAppleSilicon'),
            macIntel: await available('macIntel'),
            linuxX64: await available('linuxX64'),
        };
    }
    if (db) router.post('/activation', async (req, res) => {
        const activation = activationBody.safeParse(req.body);
        if (!activation.success) return res.status(400).json({ error: 'Desktop activation details are invalid.' });
        try {
            await db.query(
                'SELECT public.qsvc_record_desktop_activation($1, $2, $3)',
                [activation.data.platform, activation.data.architecture, activation.data.appVersion],
            );
            return res.status(202).json({ recorded: true });
        } catch {
            return res.status(503).json({ error: 'Desktop activation could not be recorded.' });
        }
    });
    router.get('/', async (_req, res) => {
        const downloads = await installer();
        res.json({ workspaceUrl: res.locals.workspaceUrl, workspaceMode: res.locals.workspaceMode, downloads, windowsAvailable: downloads.windows, expiresAt: res.locals.expiresAt });
    });
    const downloadAsset = async (platform: 'windows' | 'macAppleSilicon' | 'macIntel' | 'linuxX64', res: Response) => {
        const availability = await installer();
        if (!availability[platform]) {
            res.status(503).json({ error: 'This installer is not available yet.' });
            return;
        }
        const file = {
            windows: process.env.ENTERPRISE_WINDOWS_INSTALLER!,
            macAppleSilicon: process.env.ENTERPRISE_MACOS_ARM64_INSTALLER!,
            macIntel: process.env.ENTERPRISE_MACOS_X64_INSTALLER!,
            linuxX64: process.env.ENTERPRISE_LINUX_X64_INSTALLER!,
        }[platform];
        const filename = {
            windows: 'QS-VC-Windows-x64.zip',
            macAppleSilicon: 'QS-VC-macOS-arm64.zip',
            macIntel: 'QS-VC-macOS-x64.zip',
            linuxX64: 'QS-VC-Linux-x64.tar.gz',
        }[platform];
        res.download(file, filename, async error => {
            if (error) {
                if (!res.headersSent) res.status(503).json({ error: 'Download unavailable. Please retry.' });
                return;
            }
            if (db) {
                const artifact = {
                    windows: 'windows',
                    macAppleSilicon: 'macos-arm64',
                    macIntel: 'macos-x64',
                    linuxX64: 'linux-x64',
                }[platform];
                try { await db.query('SELECT public.qsvc_record_installer_download($1)', [artifact]); }
                catch { console.error('QS-VC installer download completed but could not be counted.'); }
            }
        });
    };
    router.get('/windows', (_req, res) => downloadAsset('windows', res));
    router.get('/macos/arm64', (_req, res) => downloadAsset('macAppleSilicon', res));
    router.get('/macos/x64', (_req, res) => downloadAsset('macIntel', res));
    router.get('/linux/x64', (_req, res) => downloadAsset('linuxX64', res));
    router.get('/download/:platform', (req, res) => {
        const platform = req.params.platform;
        if (platform === 'windows') return downloadAsset('windows', res);
        if (platform === 'macos-arm64') return downloadAsset('macAppleSilicon', res);
        if (platform === 'macos-x64') return downloadAsset('macIntel', res);
        if (platform === 'linux-x64') return downloadAsset('linuxX64', res);
        return res.sendStatus(404);
    });
    return router;
}
