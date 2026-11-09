import { randomInt } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import type { JwtPayload } from 'jsonwebtoken';
import type { Pool } from 'pg';
import { z } from 'zod';
import { phoneNumberSchema } from './registration.js';
import { isPlatformAdmin } from './platform-admins.js';
import { sessionErrorStatus } from './sessions.js';
import { bindBrowser, loopback, readBinding, webReturn } from './sso-browser.js';
import { authCallback } from './sso-keycloak.js';
import { consume, inTenant, isProof, proofHash, remember, type Account } from './sso-store.js';
import { enabledProviders, exchangePersonalCode, personalClient, personalEmail, personalProvider, type PersonalProvider } from './personal-oidc.js';
import { assertAvailableEmail, attachIdentity, checkPersonalEmail, findPersonalAccount, PersonalSignInError } from './personal-store.js';

const proof = z.string().refine(isProof);
const exchange = z.object({ code: proof, verifier: proof });
const signup = exchange.extend({
    email: personalEmail, displayName: z.string().trim().min(1).max(100)
        .transform(value => value.replace(/<[^>]*>/g, '').trim()).pipe(z.string().min(1)),
    phoneNumber: phoneNumberSchema,
});
type Link = { user: string; tenant: string; session: string };
type Launch = { provider: PersonalProvider; challenge: string; desktop?: string; link?: Link };
type Flow = Launch & { nonce: string; verifier: string };
type Identity = Awaited<ReturnType<typeof exchangePersonalCode>>;
type Result = Launch & { identity: Identity };
type PendingEmail = { identity: Identity; profile: Pick<z.infer<typeof signup>, 'email' | 'displayName' | 'phoneNumber'> };

async function sendCode(email: string, code: string) {
    const from = process.env.QSVC_EMAIL_FROM;
    const key = process.env.QSVC_EMAIL_API_KEY;
    if (!from || !key) throw new PersonalSignInError('Email verification is temporarily unavailable.');
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Verify your QS-VC email',
            text: `Your QS-VC verification code is ${code}. It expires in five minutes.` }),
    });
    if (!response.ok) throw new PersonalSignInError('We could not send your verification email. Start sign-in again to retry.');
}

export function personalSignInRouter(pool: Pool, verify: (token: string) => Promise<JwtPayload>,
    issue: (account: Account) => Promise<{ token: string; user: object }>, personalTenantId: () => Promise<string | null>) {
    const router = Router();
    router.use((_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        next();
    });
    router.get('/providers', (_req, res) => res.json({ providers: enabledProviders() }));
    const attemptLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
        message: { error: 'Too many attempts. Wait a few minutes and try again.' } });
    router.use(['/signup', '/verify-email'], attemptLimiter);

    function personalRedirect() { return new URL('/sso/personal/complete', webReturn()); }
    function callback(provider: PersonalProvider) { return authCallback(`personal/callback/${provider}`); }
    async function personalAccount(req: Request, tenant: string) {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return undefined;
        const user = await verify(header.slice(7));
        if (user.tenantId !== tenant || user.role !== 'member' || typeof user.sub !== 'string'
            || typeof user.email !== 'string' || typeof user.sessionId !== 'string' || isPlatformAdmin(user.email)) return undefined;
        return { user: user.sub, tenant, session: user.sessionId, email: user.email };
    }
    function failure(error: unknown) {
        if (error instanceof PersonalSignInError) return { status: 409, error: error.message };
        const status = sessionErrorStatus(error);
        return { status, error: status === 401 ? 'Sign in again to continue.' : 'This sign-in option is temporarily unavailable.' };
    }

    router.get('/connections', async (req, res) => {
        try {
            const providers = enabledProviders();
            const tenant = providers.length && await personalTenantId();
            const user = tenant ? await personalAccount(req, tenant) : undefined;
            if (!user || !tenant) return res.json({ providers: [], connected: [] });
            const { rows } = await inTenant(pool, tenant, db => db.query<{ provider: PersonalProvider }>(
                'SELECT provider FROM user_identities WHERE tenant_id = $1 AND user_id = $2 AND provider = ANY($3::text[])',
                [tenant, user.user, providers]));
            return res.json({ providers, connected: rows.map(row => row.provider) });
        } catch (error) { const result = failure(error); return res.status(result.status).json({ error: result.error }); }
    });
    router.post('/start', async (req, res) => {
        const input = z.object({ provider: personalProvider, challenge: proof, link: z.boolean().optional(),
            desktop: z.object({ port: z.number().int(), path: proof }).optional() }).safeParse(req.body);
        if (!input.success || (input.data.link && input.data.desktop)) return res.status(400).json({ error: 'Invalid sign-in request.' });
        const { provider, challenge, link, desktop } = input.data;
        if (!enabledProviders().includes(provider)) return res.sendStatus(404);
        try {
            const tenant = link ? await personalTenantId() : null;
            const account = tenant ? await personalAccount(req, tenant) : undefined;
            if (link && !account) return res.status(403).json({ error: 'Sign in to your personal account to link a provider.' });
            if (account) await checkPersonalEmail(pool, account.email);
            const launch = await remember(pool, 'personal_launch', { provider, challenge,
                link: account && { user: account.user, tenant: account.tenant, session: account.session },
                desktop: desktop && loopback(desktop.port, desktop.path).href } satisfies Launch);
            const url = authCallback('personal/start');
            url.searchParams.set('launch', launch);
            return res.json({ url: url.href });
        } catch (error) { const result = failure(error); return res.status(result.status).json({ error: result.error }); }
    });
    router.get('/start', async (req, res) => {
        try {
            if (!isProof(req.query.launch)) return res.sendStatus(400);
            const flow = await consume<Launch>(pool, 'personal_launch', req.query.launch);
            if (!flow || !enabledProviders().includes(flow.provider)) return res.status(400).send('This sign-in request expired. Return to QS-VC and try again.');
            const { oidc, config } = await personalClient(flow.provider);
            const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
            const redirect = callback(flow.provider);
            const binding = bindBrowser(res, state, redirect);
            await remember(pool, 'personal_oidc', { ...flow, nonce, verifier, binding }, state);
            const url = oidc.buildAuthorizationUrl(config, {
                redirect_uri: redirect.href, scope: 'openid email profile', state, nonce, prompt: 'select_account',
                code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
            });
            return res.redirect(303, url.href);
        } catch { return res.status(503).send('This sign-in option is temporarily unavailable.'); }
    });
    router.get('/callback/:provider', async (req, res) => {
        const provider = personalProvider.safeParse(req.params.provider).data;
        const state = req.query.state;
        if (!provider || !isProof(state) || !enabledProviders().includes(provider)) return res.sendStatus(400);
        let destination: URL | undefined;
        let desktop = false;
        try {
            const redirect = callback(provider);
            const binding = readBinding(req, res, state, redirect);
            const flow = binding && await consume<Flow>(pool, 'personal_oidc', state, binding);
            if (!flow || flow.provider !== provider) return res.status(400).send('This sign-in request could not be verified.');
            desktop = !!flow.desktop;
            destination = flow.desktop ? new URL(flow.desktop) : personalRedirect();
            redirect.search = new URL(req.originalUrl, redirect.origin).search;
            const identity = await exchangePersonalCode(provider, redirect, state, flow.nonce, flow.verifier);
            const code = await remember(pool, 'personal_exchange', { ...flow, identity, binding: flow.challenge });
            if (desktop) destination.searchParams.set('code', code);
            else destination.hash = new URLSearchParams({ code }).toString();
            return res.redirect(303, destination.href);
        } catch {
            if (!destination) return res.status(400).send('This sign-in request could not be verified.');
            if (desktop) destination.searchParams.set('error', 'personal_failed');
            else destination.hash = 'error=personal_failed';
            return res.redirect(303, destination.href);
        }
    });
    router.post('/exchange', async (req, res) => {
        const input = exchange.safeParse(req.body);
        if (!input.success) return res.sendStatus(400);
        try {
            const binding = proofHash(input.data.verifier);
            const flow = await consume<Result>(pool, 'personal_exchange', input.data.code, binding);
            if (!flow || !enabledProviders().includes(flow.identity.provider)) return res.status(401).json({ error: 'This sign-in request expired. Start again.' });
            const tenant = await personalTenantId();
            if (!tenant) return res.sendStatus(503);
            if (flow.link) {
                const account = await personalAccount(req, tenant);
                if (!account || account.user !== flow.link.user || account.tenant !== flow.link.tenant || account.session !== flow.link.session) {
                    return res.status(403).json({ error: 'Use the same account and session that started linking.' });
                }
                await attachIdentity(pool, tenant, flow.identity, account);
                return res.json({ linked: true });
            }
            const account = await findPersonalAccount(pool, tenant, flow.identity);
            if (account) return res.json(await issue(account));
            if (flow.identity.verifiedEmail) await assertAvailableEmail(pool, flow.identity.verifiedEmail);
            const code = await remember(pool, 'personal_enrol', { identity: flow.identity, binding });
            return res.json({ enrol: { code, name: flow.identity.name, email: flow.identity.email, verifiedEmail: flow.identity.verifiedEmail } });
        } catch (error) { const result = failure(error); return res.status(result.status).json({ error: result.error }); }
    });
    router.post('/signup', async (req, res) => {
        const input = signup.safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Enter your name, email and mobile number with country code.' });
        try {
            const { code, verifier, ...profile } = input.data;
            const binding = proofHash(verifier);
            const flow = await consume<{ identity: Identity }>(pool, 'personal_enrol', code, binding);
            if (!flow || !enabledProviders().includes(flow.identity.provider)) return res.status(401).json({ error: 'This sign-in request expired. Start again.' });
            await assertAvailableEmail(pool, profile.email);
            if (flow.identity.verifiedEmail === profile.email) {
                const tenant = await personalTenantId();
                if (!tenant) return res.sendStatus(503);
                return res.status(201).json(await issue(await attachIdentity(pool, tenant, flow.identity, undefined, profile)));
            }
            const otp = String(randomInt(0, 100_000_000)).padStart(8, '0');
            await sendCode(profile.email, otp);
            const verification = await remember(pool, 'personal_email', { ...flow, profile, binding: proofHash(`${binding}:${otp}`) });
            return res.json({ verification, email: profile.email });
        } catch (error) { const result = failure(error); return res.status(result.status).json({ error: result.error }); }
    });
    router.post('/verify-email', async (req, res) => {
        const input = exchange.extend({ otp: z.string().trim().regex(/^\d{8}$/) }).safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Enter the eight-digit code from your email.' });
        try {
            const { code, verifier, otp } = input.data;
            const flow = await consume<PendingEmail>(pool, 'personal_email', code, proofHash(`${proofHash(verifier)}:${otp}`));
            if (!flow || !enabledProviders().includes(flow.identity.provider)) return res.status(400).json({ error: 'This code is incorrect or expired.' });
            const tenant = await personalTenantId();
            if (!tenant) return res.sendStatus(503);
            return res.status(201).json(await issue(await attachIdentity(pool, tenant, flow.identity, undefined, flow.profile)));
        } catch (error) { const result = failure(error); return res.status(result.status).json({ error: result.error }); }
    });
    return router;
}
