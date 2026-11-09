import { Router, type Request, type Response } from 'express';
import { Resolver } from 'node:dns/promises';
import type { JwtPayload } from 'jsonwebtoken';
import type { Pool } from 'pg';
import { z } from 'zod';
import { isPlatformAdmin } from './platform-admins.js';
import { sessionErrorStatus } from './sessions.js';
import { authCallback, configureProvider, exchangeBrokerCode, issuer, oidcClient, providerBody, ssoEnabled } from './sso-keycloak.js';
import { brokerAlias, consume, discover, emailDomain, inTenant, isProof, proofHash, provision, randomProof, remember, trustedClaims, type Account, type Connection } from './sso-store.js';
import { digilockerRouter } from './sso-digilocker.js';
import { bindBrowser, readBinding, webReturn, loopback } from './sso-browser.js';

const emailSchema = z.string().trim().email().max(255).transform(value => value.toLowerCase());
const domainSchema = z.string().trim().toLowerCase().max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const proof = z.string().refine(isProof);
const uuid = z.uuid();
const exactEmail = z.object({ email: emailSchema });
const verifierBody = z.object({ code: proof, verifier: proof });
type Verify = (token: string) => Promise<JwtPayload>;
type Issue = (user: Account) => Promise<object>;
type Launch = { email: string; connectionId: string; challenge?: string; desktop?: string; test?: boolean; linkUser?: string };
type OidcFlow = Launch & { nonce: string; verifier: string };
type Exchange = { tenant: string; user: string };

export function ssoRouter(pool: Pool, verify: Verify, issue: Issue, logError: (action: string) => void) {
    const router = Router();
    router.use((_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        next();
    });
    router.use('/digilocker', digilockerRouter(pool, verify));
    router.post('/discover', async (req, res) => {
        const input = exactEmail.safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Enter a valid email address.' });
        if (isPlatformAdmin(input.data.email)) return res.json({ available: false, required: false });
        try {
            const connection = await discover(pool, emailDomain(input.data.email));
            return res.json({ available: ssoEnabled() && !!connection?.provider, required: !!connection?.enforce_sso });
        } catch { return res.status(503).json({ error: 'Sign-in discovery is temporarily unavailable.' }); }
    });

    router.get('/availability', async (req, res) => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
        if (!ssoEnabled()) return res.json({ admin: false, link: false });
        try {
            const user = await verify(header.slice(7));
            if (typeof user.email !== 'string' || typeof user.tenantId !== 'string') return res.sendStatus(401);
            const tenant = await pool.query("SELECT 1 FROM tenants WHERE id = $1 AND is_active AND plan = 'enterprise'", [user.tenantId]);
            const enterprise = !!tenant.rows.length;
            const connection = enterprise && !isPlatformAdmin(user.email) ? await discover(pool, emailDomain(user.email)) : undefined;
            return res.json({ admin: enterprise && user.role === 'admin', link: !!connection?.provider && connection.tenant_id === user.tenantId });
        } catch (error) { return res.sendStatus(sessionErrorStatus(error)); }
    });
    router.use((_req, res, next) => { if (!ssoEnabled()) return res.sendStatus(404); next(); });
    router.post('/start', async (req, res) => {
        const input = z.object({ email: emailSchema, challenge: proof,
            desktop: z.object({ port: z.number().int(), path: proof }).optional() }).safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Invalid sign-in request.' });
        try {
            const { email, challenge, desktop } = input.data;
            const connection = await discover(pool, emailDomain(email));
            if (!connection?.provider || isPlatformAdmin(email)) return res.status(404).json({ error: 'Organisation sign-in is unavailable.' });
            const launch = await remember(pool, 'launch', { email, challenge, connectionId: connection.id,
                desktop: desktop ? loopback(desktop.port, desktop.path).href : undefined } satisfies Launch);
            return res.json({ url: launchUrl(launch) });
        } catch { return res.status(503).json({ error: 'Organisation sign-in is temporarily unavailable.' }); }
    });

    function launchUrl(key: string) {
        const url = authCallback('start');
        url.searchParams.set('launch', key);
        return url.href;
    }

    router.get('/start', async (req, res) => {
        try {
            if (!isProof(req.query.launch)) return res.sendStatus(400);
            const flow = await consume<Launch>(pool, 'launch', req.query.launch);
            if (!flow) return res.status(400).send('This sign-in request expired. Return to QS-VC and try again.');
            const connection = await discover(pool, emailDomain(flow.email));
            if (!connection?.provider || connection.id !== flow.connectionId) return res.sendStatus(403);
            const { oidc, config } = await oidcClient();
            const state = oidc.randomState();
            const nonce = oidc.randomNonce();
            const verifier = oidc.randomPKCECodeVerifier();
            const callback = authCallback();
            const binding = bindBrowser(res, state, callback);
            await remember(pool, 'oidc', { ...flow, nonce, verifier, binding }, state);
            const url = oidc.buildAuthorizationUrl(config, {
                redirect_uri: callback.href, scope: 'openid email profile', state, nonce, prompt: 'login',
                code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
                kc_idp_hint: brokerAlias(connection.id), login_hint: flow.email,
            });
            return res.redirect(303, url.href);
        } catch { logError('start'); return res.status(503).send('Organisation sign-in is temporarily unavailable.'); }
    });

    router.get('/callback', async (req, res) => {
        let destination: URL | undefined;
        try {
            const state = req.query.state;
            if (!isProof(state)) return res.status(400).send('Invalid sign-in response.');
            const callback = authCallback();
            const binding = readBinding(req, res, state, callback);
            const flow = binding ? await consume<OidcFlow>(pool, 'oidc', state, binding) : undefined;
            if (!flow) return res.status(400).send('Invalid or expired sign-in. Return to QS-VC and try again.');
            destination = flow.desktop ? new URL(flow.desktop) : webReturn();
            const connection = await discover(pool, emailDomain(flow.email));
            if (!connection?.provider || connection.id !== flow.connectionId) throw new Error('Connection changed.');
            callback.search = new URL(req.originalUrl, callback.origin).search;
            const claims = trustedClaims(connection, await exchangeBrokerCode(callback, state, flow.nonce, flow.verifier), flow.email);
            if (flow.test) {
                if (flow.linkUser) await provision(pool, connection, claims, flow.linkUser);
                await inTenant(pool, connection.tenant_id, db =>
                    db.query('UPDATE sso_connections SET tested_at = now() WHERE id = $1 AND provider = $2', [connection.id, connection.provider]));
                destination.hash = 'test=success';
            } else {
                const account = await provision(pool, connection, claims);
                const code = await remember(pool, 'exchange', { tenant: account.tenant_id, user: account.id, binding: flow.challenge });
                if (flow.desktop) destination.searchParams.set('code', code);
                else destination.hash = new URLSearchParams({ code }).toString();
            }
            return res.redirect(303, destination.href);
        } catch {
            logError('callback');
            if (!destination) return res.status(400).send('Organisation sign-in could not be verified.');
            if (destination.protocol === 'http:' && destination.hostname === '127.0.0.1' && destination.pathname.startsWith('/sso/')) {
                destination.searchParams.set('error', 'sso_failed');
            } else destination.hash = 'error=sso_failed';
            return res.redirect(303, destination.href);
        }
    });

    router.post('/exchange', async (req, res) => {
        const input = verifierBody.safeParse(req.body);
        if (!input.success) return res.sendStatus(400);
        try {
            const flow = await consume<Exchange>(pool, 'exchange', input.data.code, proofHash(input.data.verifier));
            if (!flow) return res.status(401).json({ error: 'This sign-in request is invalid or expired.' });
            const { rows } = await pool.query<Account>(
                `SELECT u.* FROM users u JOIN tenants t ON t.id = u.tenant_id
                 WHERE u.id = $1 AND u.tenant_id = $2 AND u.is_active AND t.is_active AND t.plan = 'enterprise'`,
                [flow.user, flow.tenant],
            );
            if (!rows[0]) return res.sendStatus(401);
            return res.json(await issue(rows[0]));
        } catch (error) {
            return sessionErrorStatus(error) === 401 ? res.status(403).json({ error: 'Your enterprise access term is missing or expired.' })
                : res.status(503).json({ error: 'Organisation sign-in is temporarily unavailable.' });
        }
    });

    const authenticated = (handle: (req: Request, res: Response, account: Required<Pick<JwtPayload, 'sub'>> & { tenantId: string; email: string }) => Promise<unknown>, admin = true) =>
        async (req: Request, res: Response) => {
            const header = req.headers.authorization;
            if (!header?.startsWith('Bearer ')) return res.sendStatus(401);
            try {
                const account = await verify(header.slice(7));
                if (typeof account.sub !== 'string' || typeof account.email !== 'string' || typeof account.tenantId !== 'string'
                    || (admin && account.role !== 'admin')) return res.sendStatus(403);
                const result = await pool.query("SELECT 1 FROM tenants WHERE id = $1 AND is_active AND plan = 'enterprise'", [account.tenantId]);
                if (!result.rows.length) return res.status(403).json({ error: 'An Enterprise organisation is required.' });
                return await handle(req, res, { sub: account.sub, tenantId: account.tenantId, email: account.email.toLowerCase() });
            } catch (error) {
                if (sessionErrorStatus(error) === 401) return res.sendStatus(401);
                if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'This domain is already registered or verified.' });
                logError('management');
                return res.status(503).json({ error: 'SSO settings could not be updated. Check the organisation configuration and try again.' });
            }
        };

    router.post('/link', authenticated(async (_req, res, account) => {
        const connection = await discover(pool, emailDomain(account.email));
        if (!connection?.provider || connection.tenant_id !== account.tenantId || isPlatformAdmin(account.email)) return res.sendStatus(404);
        const key = await remember(pool, 'launch', { email: account.email, connectionId: connection.id, test: true, linkUser: account.sub } satisfies Launch);
        return res.json({ url: launchUrl(key) });
    }, false));

    function view(connection: Connection) {
        const realm = issuer();
        const broker = `${realm.href}/broker/${brokerAlias(connection.id)}/endpoint`;
        return { id: connection.id, domain: connection.domain, provider: connection.provider, verified: !!connection.verified_at,
            tested: !!connection.tested_at, enforced: connection.enforce_sso,
            txtName: `_qsvc-sso.${connection.domain}`, txtValue: `qsvc-sso=${connection.dns_token}`,
            metadataUrl: `${broker}/descriptor`, redirectUrl: broker };
    }

    router.get('/connections', authenticated(async (_req, res, { tenantId }) => {
        const result = await inTenant(pool, tenantId, db => db.query<Connection>('SELECT * FROM sso_connections ORDER BY domain'));
        return res.json({ connections: result.rows.map(view) });
    }));
    router.post('/connections', authenticated(async (req, res, { tenantId }) => {
        const input = z.object({ domain: domainSchema }).safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Enter a valid organisation domain.' });
        const result = await inTenant(pool, tenantId, db => db.query<Connection>(
            'INSERT INTO sso_connections(tenant_id, domain, dns_token) VALUES ($1,$2,$3) RETURNING *', [tenantId, input.data.domain, randomProof()]));
        return res.status(201).json(view(result.rows[0]));
    }));
    router.post('/connections/:id/verify', authenticated(async (req, res, { tenantId }) => {
        const id = uuid.safeParse(req.params.id);
        if (!id.success) return res.sendStatus(400);
        const result = await inTenant(pool, tenantId, db => db.query<Connection>('SELECT * FROM sso_connections WHERE id = $1', [id.data]));
        const connection = result.rows[0];
        if (!connection) return res.sendStatus(404);
        const records = await new Resolver({ timeout: 3000, tries: 2 }).resolveTxt(`_qsvc-sso.${connection.domain}`).catch(() => []);
        if (!records.some(record => record.join('') === `qsvc-sso=${connection.dns_token}`)) {
            return res.status(400).json({ error: 'The DNS TXT record is not visible yet.' });
        }
        const updated = await inTenant(pool, tenantId, db => db.query<Connection>(
            'UPDATE sso_connections SET verified_at = COALESCE(verified_at, now()) WHERE id = $1 RETURNING *', [id.data]));
        return res.json(view(updated.rows[0]));
    }));
    router.put('/connections/:id/provider', authenticated(async (req, res, { tenantId }) => {
        const id = uuid.safeParse(req.params.id);
        const input = providerBody.safeParse(req.body);
        if (!id.success || !input.success) return res.status(400).json({ error: 'Check the identity provider fields and approved HTTPS hosts.' });
        const updated = await inTenant(pool, tenantId, async db => {
            const result = await db.query<Connection>('SELECT * FROM sso_connections WHERE id = $1 FOR UPDATE', [id.data]);
            const connection = result.rows[0];
            if (!connection?.verified_at || connection.provider) return undefined;
            await db.query("SET LOCAL idle_in_transaction_session_timeout = '35s'");
            await configureProvider(connection.id, input.data);
            return (await db.query<Connection>('UPDATE sso_connections SET provider = $2 WHERE id = $1 RETURNING *', [id.data, input.data.provider])).rows[0];
        });
        return updated ? res.json(view(updated)) : res.status(409).json({ error: 'Verify the domain first. Existing providers require an operator to replace them.' });
    }));
    router.post('/connections/:id/test', authenticated(async (req, res, account) => {
        const id = uuid.safeParse(req.params.id);
        const input = exactEmail.safeParse(req.body);
        if (!id.success || !input.success) return res.sendStatus(400);
        const result = await inTenant(pool, account.tenantId, db => db.query<Connection>('SELECT * FROM sso_connections WHERE id = $1', [id.data]));
        const connection = result.rows[0];
        const email = input.data.email;
        if (!connection?.provider || !connection.verified_at || emailDomain(email) !== connection.domain || isPlatformAdmin(email)) {
            return res.status(400).json({ error: 'Use an organisation account in the verified domain.' });
        }
        const launch = await remember(pool, 'launch', { email, connectionId: connection.id, test: true,
            linkUser: account.email === email ? account.sub : undefined } satisfies Launch);
        return res.json({ url: launchUrl(launch) });
    }));
    router.patch('/connections/:id/enforcement', authenticated(async (req, res, account) => {
        const id = uuid.safeParse(req.params.id);
        const input = z.object({ enforced: z.boolean() }).safeParse(req.body);
        if (!id.success || !input.success) return res.sendStatus(400);
        const result = await inTenant(pool, account.tenantId, db => db.query<Connection>(
            `UPDATE sso_connections c SET enforce_sso = $2 WHERE c.id = $1 AND
             (NOT $2 OR (c.verified_at IS NOT NULL AND c.provider IS NOT NULL AND c.tested_at IS NOT NULL
              AND ($3 OR c.domain <> $4 OR EXISTS (
                SELECT 1 FROM user_identities i WHERE i.connection_id = c.id AND i.user_id = $5
              )))) RETURNING c.*`,
            [id.data, input.data.enforced, isPlatformAdmin(account.email), emailDomain(account.email), account.sub]));
        return result.rows[0] ? res.json(view(result.rows[0])) : res.status(409).json({ error: 'Verify and test the connection. Link your account first if this domain includes your email.' });
    }));
    return router;
}
