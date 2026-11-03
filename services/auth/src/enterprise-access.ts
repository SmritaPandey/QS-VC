import { Router } from 'express';
import { stat } from 'node:fs/promises';
import path from 'node:path';

// Server-managed explicit user IDs prevent self-registration into an approved tenant
// from granting download access. Never accept entitlement from browser parameters.
export function enterpriseRouter(verify: (token: string) => Promise<Record<string, any>>) {
    const router = Router();
    router.use(async (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const header = req.headers.authorization;
            if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Sign in to check enterprise access.' }); return; }
            const user = await verify(header.slice(7));
            const grants = JSON.parse(process.env.ENTERPRISE_ACCESS_JSON || '[]');
            let grant = Array.isArray(grants) ? grants.find(g => g.tenantId === user.tenantId && Array.isArray(g.userIds) && g.userIds.includes(user.sub)) : undefined;
            // Platform admins (role from the server-signed session) may use the intranet without a
            // per-user grant. They get QSVC_ADMIN_WORKSPACE_URL, or the first configured workspace.
            if (!grant && user.role === 'admin') {
                const workspaceUrl = process.env.QSVC_ADMIN_WORKSPACE_URL || (Array.isArray(grants) ? grants[0]?.workspaceUrl : undefined);
                if (workspaceUrl) grant = { workspaceUrl };
            }
            if (!grant) { res.status(403).json({ error: 'Your account has not been approved for enterprise access.' }); return; }
            const url = new URL(grant.workspaceUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid workspace configuration');
            res.locals.workspaceUrl = url.href;
            next();
        } catch { res.status(503).json({ error: 'Enterprise access could not be verified. Contact your administrator.' }); }
    });
    async function installer() {
        const file = process.env.ENTERPRISE_WINDOWS_INSTALLER;
        if (!file || !path.isAbsolute(file) || !file.toLowerCase().endsWith('.exe')) return null;
        try { return (await stat(file)).isFile() ? file : null; } catch { return null; }
    }
    router.get('/', async (_req, res) => res.json({ workspaceUrl: res.locals.workspaceUrl, windowsAvailable: !!(await installer()) }));
    router.get('/windows', async (_req, res) => {
        const file = await installer();
        if (!file) { res.status(503).json({ error: 'The Windows installer is not available yet.' }); return; }
        res.download(file, 'QS-VC-Windows-Setup.exe', error => { if (error && !res.headersSent) res.status(503).json({ error: 'Download unavailable. Please retry.' }); });
    });
    return router;
}
