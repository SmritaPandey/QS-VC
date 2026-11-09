import { Router } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import type { Pool } from 'pg';
import { z } from 'zod';
import { authCallback, secureUrl } from './sso-keycloak.js';
import { bindBrowser, readBinding, webReturn } from './sso-browser.js';
import { consume, inTenant, isProof, proofHash, randomProof, remember } from './sso-store.js';
import { sessionErrorStatus } from './sessions.js';

const enabled = () => process.env.QSVC_DIGILOCKER_ENABLED === 'true';
const callback = () => authCallback('digilocker/callback');
const endpoint = (key: 'AUTHORIZE' | 'TOKEN' | 'USER') => secureUrl(process.env[`QSVC_DIGILOCKER_${key}_URL`] || '');
const credential = (key: 'ID' | 'SECRET') => {
    const value = process.env[`QSVC_DIGILOCKER_CLIENT_${key}`];
    if (!value) throw new Error('DigiLocker is not configured.');
    return value;
};
type Account = { user: string; tenant: string };
type Flow = Account & { challenge: string; verifier: string };
type Consent = Account & { id: string; consentAt: string };

export function digilockerRouter(pool: Pool, verify: (token: string) => Promise<JwtPayload>) {
    const router = Router();
    async function account(header: string | undefined): Promise<Account | undefined> {
        if (!header?.startsWith('Bearer ')) return;
        const payload = await verify(header.slice(7));
        if (typeof payload.sub === 'string' && typeof payload.tenantId === 'string') return { user: payload.sub, tenant: payload.tenantId };
    }
    router.get('/status', (_req, res) => res.json({ enabled: enabled() }));
    router.use((_req, res, next) => { if (!enabled()) return res.sendStatus(404); next(); });
    router.post('/start', async (req, res) => {
        try {
            const current = await account(req.headers.authorization);
            if (!current) return res.sendStatus(401);
            if (!isProof(req.body?.challenge)) return res.sendStatus(400);
            const key = await remember(pool, 'digilocker_launch', { ...current, challenge: req.body.challenge, verifier: randomProof() } satisfies Flow);
            const url = authCallback('digilocker/start');
            url.searchParams.set('digilocker_launch', key);
            return res.json({ url: url.href });
        } catch (error) { return res.sendStatus(sessionErrorStatus(error)); }
    });
    router.get('/start', async (req, res) => {
        try {
            if (!isProof(req.query.launch)) return res.sendStatus(400);
            const flow = await consume<Flow>(pool, 'digilocker_launch', req.query.launch);
            if (!flow?.user || !isProof(flow.verifier)) return res.sendStatus(400);
            const state = randomProof();
            const binding = bindBrowser(res, state, callback());
            await remember(pool, 'digilocker', { ...flow, binding }, state);
            const url = endpoint('AUTHORIZE');
            const params = { response_type: 'code', client_id: credential('ID'), redirect_uri: callback().href,
                state, code_challenge: proofHash(flow.verifier), code_challenge_method: 'S256' };
            for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
            if (process.env.QSVC_DIGILOCKER_SCOPE) url.searchParams.set('scope', process.env.QSVC_DIGILOCKER_SCOPE);
            return res.redirect(303, url.href);
        } catch { return res.status(503).send('DigiLocker is temporarily unavailable.'); }
    });
    router.get('/callback', async (req, res) => {
        try {
            const { state, code } = req.query;
            if (!isProof(state)) return res.sendStatus(400);
            const binding = readBinding(req, res, state, callback());
            const flow = binding ? await consume<Flow>(pool, 'digilocker', state, binding) : undefined;
            if (!flow) return res.sendStatus(400);
            const destination = webReturn();
            try {
                if (typeof code !== 'string' || !code || code.length > 2048) throw new Error('Missing consent.');
                const tokens = await fetch(endpoint('TOKEN'), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
                    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback().href,
                        client_id: credential('ID'), client_secret: credential('SECRET'), code_verifier: flow.verifier }) });
                if (!tokens.ok) throw new Error('Token exchange failed.');
                const { access_token } = z.object({ access_token: z.string().min(1) }).parse(await tokens.json());
                const details = await fetch(endpoint('USER'), { headers: { Authorization: `Bearer ${access_token}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
                if (!details.ok) throw new Error('Identity endpoint failed.');
                const { digilockerid: id } = z.object({ digilockerid: z.string().trim().min(1).max(255) }).parse(await details.json());
                const result = await remember(pool, 'digilocker_consent', {
                    tenant: flow.tenant, user: flow.user, id, consentAt: new Date().toISOString(), binding: flow.challenge,
                });
                destination.hash = new URLSearchParams({ digilocker: result }).toString();
            } catch { destination.hash = 'error=digilocker_failed'; }
            return res.redirect(303, destination.href);
        } catch { return res.sendStatus(503); }
    });
    router.post('/complete', async (req, res) => {
        try {
            const current = await account(req.headers.authorization);
            if (!current) return res.sendStatus(401);
            const { code, verifier } = req.body ?? {};
            if (!isProof(code) || !isProof(verifier)) return res.sendStatus(400);
            const consent = await consume<Consent>(pool, 'digilocker_consent', code, proofHash(verifier));
            if (!consent?.id || current.user !== consent.user || current.tenant !== consent.tenant) return res.sendStatus(403);
            await inTenant(pool, current.tenant, db => db.query(
                `INSERT INTO user_identities(tenant_id, user_id, provider, subject, consent_at)
                 VALUES($1,$2,'digilocker',$3,$4)
                 ON CONFLICT (tenant_id, user_id) WHERE provider = 'digilocker'
                 DO UPDATE SET subject = EXCLUDED.subject, consent_at = EXCLUDED.consent_at`,
                [current.tenant, current.user, consent.id, consent.consentAt]));
            return res.json({ connected: true });
        } catch (error) {
            return res.sendStatus((error as { code?: string }).code === '23505' ? 409 : sessionErrorStatus(error));
        }
    });
    return router;
}
