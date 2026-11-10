import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { billingRouter, processMandateCancellations } from './billing';
import { getEntitlements } from '../../../shared/entitlements.cjs';
import { getPlanPrice } from '../../../shared/payment-pricing.mjs';

const user = {
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002',
    email: 'member@example.test',
    role: 'user',
};
const cashfreeSubscriptionId = '00000000-0000-4000-8000-000000000003';
const cashfreeWebhookSecret = 'cashfree_webhook_test_secret';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function route(router: ReturnType<typeof billingRouter>, path: string) {
    const layer = router.stack.find(item => item.route?.path === path);
    if (!layer?.route) throw new Error(`Missing route ${path}`);
    return layer.route.stack[0].handle;
}

function makeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; },
        set() { return this; },
    };
    return res;
}

function makeRequest(body: unknown, headers: Record<string, string> = {}, query: Record<string, string> = {}, rawBody?: Buffer) {
    return {
        headers: { authorization: 'Bearer valid-token', ...headers },
        body,
        query,
        rawBody,
        get(name: string) {
            const key = name.toLowerCase();
            return Object.entries(this.headers).find(([header]) => header.toLowerCase() === key)?.[1];
        },
    };
}

function makePool(options: { account?: Record<string, unknown>; openSubscription?: Record<string, unknown> } = {}) {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('SELECT u.email, u.phone_number, u.role')) return { rows: [{
                email: user.email, phone_number: '+919876543210', role: 'user', subscription_plan: null,
                trial_started_at: null, trial_ends_at: null, subscription_expires_at: null,
                enterprise_status: null, tenant_plan: 'free', ...options.account,
            }], rowCount: 1 };
            if (sql.includes('SELECT id, provider, plan, status, current_period_end, provider_subscription_id')) {
                return { rows: options.openSubscription ? [options.openSubscription] : [], rowCount: options.openSubscription ? 1 : 0 };
            }
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    return { pool, queries, client };
}

function makeRouter(pool: ReturnType<typeof makePool>['pool']) {
    return billingRouter(pool as never, async () => user, { warn: vi.fn(), error: vi.fn() });
}

function enableRazorpay() {
    vi.stubEnv('PAYMENTS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_TERMS_CONFIRMED', 'true');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_public');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'razorpay_test_secret');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'razorpay_test_webhook_secret');
    vi.stubEnv('RAZORPAY_PLAN_STARTER', 'plan_starter_test');
    vi.stubEnv('RAZORPAY_PLAN_PRO', 'plan_pro_test');
}

function enableCashfree() {
    vi.stubEnv('PAYMENTS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_TERMS_CONFIRMED', 'true');
    vi.stubEnv('CASHFREE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('CASHFREE_API_VERSION', '2026-01-01');
    vi.stubEnv('CASHFREE_CLIENT_ID', 'cashfree_test_client');
    vi.stubEnv('CASHFREE_CLIENT_SECRET', 'cashfree_test_secret');
    vi.stubEnv('CASHFREE_WEBHOOK_SECRET', cashfreeWebhookSecret);
    vi.stubEnv('AUTH_PUBLIC_URL', 'http://localhost:4002');
}

function enablePayPal() {
    vi.stubEnv('PAYMENTS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_TERMS_CONFIRMED', 'true');
    vi.stubEnv('PAYPAL_CLIENT_ID', 'paypal_test_client');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'paypal_test_secret');
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'paypal_test_webhook');
    vi.stubEnv('PAYPAL_PLAN_STARTER', 'paypal_starter_test');
    vi.stubEnv('PAYPAL_PLAN_PRO', 'paypal_pro_test');
    vi.stubEnv('PAYPAL_STARTER_BASE_AMOUNT', '10.00');
    vi.stubEnv('PAYPAL_PRO_BASE_AMOUNT', '20.00');
    vi.stubEnv('PAYPAL_CURRENCY', 'USD');
}

it('publishes independent mixed provider modes without credentials and blocks unconfigured PayPal', async () => {
    enableRazorpay();
    enableCashfree();
    vi.stubEnv('CASHFREE_ENVIRONMENT', 'production');
    vi.stubEnv('PAYPAL_CLIENT_ID', undefined);
    vi.stubEnv('PAYPAL_CLIENT_SECRET', undefined);
    vi.stubEnv('PAYPAL_ENVIRONMENT', undefined);
    const { pool } = makePool();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = makeResponse();

    route(makeRouter(pool), '/options')(makeRequest(null, {}, { plan: 'Starter' }) as unknown as Request,
        res as unknown as Response, vi.fn());

    expect(res.body).toMatchObject({ paymentsEnabled: true, providers: {
        cashfree: { mode: 'live', enabled: true, trialEnabled: true },
        razorpay: { mode: 'test', enabled: true, trialEnabled: true },
        paypal: { mode: 'test', enabled: false, trialEnabled: false },
    } });
    const publicJson = JSON.stringify(res.body);
    for (const value of ['rzp_test_public', 'razorpay_test_secret', 'razorpay_test_webhook_secret',
        'cashfree_test_client', 'cashfree_test_secret', cashfreeWebhookSecret, 'plan_starter_test']) {
        expect(publicJson).not.toContain(value);
    }
    expect(publicJson).not.toMatch(/keyId|clientId|secret|webhook|planId/i);
    const checkout = makeResponse();
    await route(makeRouter(pool), '/checkout')(makeRequest({ provider: 'paypal', plan: 'Starter', trial: false, mandateConsent: true }) as unknown as Request,
        checkout as unknown as Response, vi.fn());
    expect(checkout.statusCode).toBe(503);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

it.each([
    ['razorpay', 'RAZORPAY_KEY_ID', 'rzp_live_example', 'live'],
    ['razorpay', 'RAZORPAY_KEY_ID', 'rzp_test_example', 'test'],
    ['razorpay', 'RAZORPAY_KEY_ID', 'example_key', 'unknown'],
    ['razorpay', 'RAZORPAY_KEY_ID', undefined, 'unknown'],
    ['cashfree', 'CASHFREE_ENVIRONMENT', 'production', 'live'],
    ['cashfree', 'CASHFREE_ENVIRONMENT', 'sandbox', 'test'],
    ['cashfree', 'CASHFREE_ENVIRONMENT', 'live', 'test'],
    ['cashfree', 'CASHFREE_ENVIRONMENT', undefined, 'test'],
    ['paypal', 'PAYPAL_ENVIRONMENT', 'live', 'live'],
    ['paypal', 'PAYPAL_ENVIRONMENT', 'sandbox', 'test'],
    ['paypal', 'PAYPAL_ENVIRONMENT', 'production', 'test'],
    ['paypal', 'PAYPAL_ENVIRONMENT', undefined, 'test'],
] as const)('labels %s mode from %s=%s as %s', (provider, env, value, mode) => {
    vi.stubEnv(env, value);
    const { pool } = makePool();
    const res = makeResponse();
    route(makeRouter(pool), '/options')(makeRequest(null, {}, { plan: 'Starter' }) as unknown as Request,
        res as unknown as Response, vi.fn());
    expect(res.body).toMatchObject({ providers: { [provider]: { mode } } });
});

it.each(['PAYMENTS_ENABLED', 'PAYMENT_TERMS_CONFIRMED'])('blocks every provider checkout when %s is false', async flag => {
    enableRazorpay();
    enableCashfree();
    enablePayPal();
    vi.stubEnv('CASHFREE_ENVIRONMENT', 'production');
    vi.stubEnv(flag, 'false');
    const { pool } = makePool();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const router = makeRouter(pool);
    const options = makeResponse();
    route(router, '/options')(makeRequest(null, {}, { plan: 'Starter' }) as unknown as Request,
        options as unknown as Response, vi.fn());
    expect(options.body).toMatchObject({ paymentsEnabled: false, providers: {
        cashfree: { mode: 'live', enabled: false, trialEnabled: false },
        razorpay: { mode: 'test', enabled: false, trialEnabled: false },
        paypal: { enabled: false, trialEnabled: false },
    } });
    for (const provider of ['cashfree', 'razorpay', 'paypal']) {
        for (const trial of [false, true]) {
            const res = makeResponse();
            await route(router, '/checkout')(makeRequest({ provider, plan: 'Starter', trial, mandateConsent: true }) as unknown as Request,
                res as unknown as Response, vi.fn());
            expect(res.statusCode).toBe(503);
        }
    }
    expect(pool.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

it('disables only annual Razorpay checkout when its annual plan is missing', async () => {
    enableRazorpay();
    enableCashfree();
    vi.stubEnv('RAZORPAY_PLAN_STARTER_ANNUAL', undefined);
    const { pool } = makePool();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const router = makeRouter(pool);
    for (const billing of ['monthly', 'annual']) {
        const res = makeResponse();
        route(router, '/options')(makeRequest(null, {}, { plan: 'Starter', billing }) as unknown as Request,
            res as unknown as Response, vi.fn());
        expect(res.body).toMatchObject({ providers: {
            razorpay: { mode: 'test', enabled: billing === 'monthly', trialEnabled: billing === 'monthly' },
            cashfree: { enabled: true, trialEnabled: true },
        } });
    }
    const res = makeResponse();
    await route(router, '/checkout')(makeRequest({ provider: 'razorpay', plan: 'Starter', billing: 'annual', trial: false, mandateConsent: true }) as unknown as Request,
        res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

it.each([
    ['Starter', 'monthly', 30900, 100],
    ['Business', 'annual', 161500, 12],
] as const)('creates a server-priced Razorpay subscription for %s %s', async (name, billing, baseMinor, cycles) => {
    enableRazorpay();
    const plan = name.toLowerCase();
    const planId = `plan_${plan}_test`;
    const totalMinor = baseMinor + Math.round(baseMinor * 18 / 100);
    vi.stubEnv(`RAZORPAY_PLAN_${name.toUpperCase()}${billing === 'annual' ? '_ANNUAL' : ''}`, planId);
    const { pool, queries } = makePool();
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
        calls.push({ url, body });
        if (url.endsWith(`/plans/${planId}`)) {
            return new Response(JSON.stringify({ id: planId, period: 'monthly', interval: 1,
                item: { currency: 'INR', amount: totalMinor } }), { status: 200 });
        }
        if (url.endsWith('/subscriptions')) {
            return new Response(JSON.stringify({ id: 'sub_test123', plan_id: planId, status: 'created' }), { status: 200 });
        }
        throw new Error(`Unexpected mocked provider request: ${url}`);
    }));

    const res = makeResponse();
    await route(makeRouter(pool), '/checkout')(
        makeRequest({ provider: 'razorpay', plan: name, billing, trial: false, mandateConsent: true, amount: 1, currency: 'USD' }) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ provider: 'razorpay', subscription_id: 'sub_test123', keyId: 'rzp_test_public',
        email: user.email, plan: name, amount: totalMinor, currency: 'INR', recurring: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain(`/plans/${planId}`);
    expect(calls[1].body).toMatchObject({ plan_id: planId, total_count: cycles, customer_notify: 1,
        notes: { plan, trial_days: '0' } });
    expect(calls[1].body?.expire_by).toEqual(expect.any(Number));
    expect(calls[1].body).not.toHaveProperty('amount');
    expect(queries.find(query => query.sql.includes('INSERT INTO public.payment_subscriptions'))?.values).toEqual(
        expect.arrayContaining([plan, baseMinor / 100, 18, (totalMinor - baseMinor) / 100, totalMinor / 100, 14, billing]),
    );
    expect(JSON.stringify(res.body)).not.toContain('razorpay_test_secret');
});

it('rejects checkout without explicit recurring mandate consent before database or provider access', async () => {
    enableRazorpay();
    const { pool } = makePool();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = makeResponse();

    await route(makeRouter(pool), '/checkout')(
        makeRequest({ provider: 'razorpay', plan: 'Starter', trial: false }) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

it('preserves and resumes a stale pending PayPal checkout instead of expiring or replacing it', async () => {
    enablePayPal();
    const approvalUrl = 'https://www.sandbox.paypal.com/checkoutnow?token=I-EXISTING';
    const existing = {
        id: cashfreeSubscriptionId, provider: 'paypal', plan: 'starter', status: 'pending', current_period_end: null,
        provider_subscription_id: 'I-EXISTING', provider_order_id: null, provider_session_id: null,
        billing_mode: 'subscription', approval_url: approvalUrl, trial_checkout: false, trial_ends_at: null,
        billing_period: 'monthly', trial_days: 14, total_amount: '11.80', provider_plan_id: 'paypal_starter_test',
    };
    const { pool, queries } = makePool({ openSubscription: existing });
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method || 'GET' });
        if (url.endsWith('/v1/oauth2/token')) {
            return new Response(JSON.stringify({ access_token: 'paypal_access_test', expires_in: 3600 }), { status: 200 });
        }
        if (url.endsWith('/v1/billing/plans/paypal_starter_test')) return new Response(JSON.stringify({
            id: 'paypal_starter_test', status: 'ACTIVE', billing_cycles: [{ tenure_type: 'REGULAR',
                frequency: { interval_unit: 'MONTH', interval_count: 1 }, total_cycles: 0,
                pricing_scheme: { fixed_price: { value: '10.00', currency_code: 'USD' } } }],
            payment_preferences: { setup_fee: { value: '0.00', currency_code: 'USD' } },
            taxes: { percentage: '18', inclusive: false },
        }), { status: 200 });
        throw new Error(`Unexpected mocked provider request: ${url}`);
    }));
    const res = makeResponse();

    await route(makeRouter(pool), '/checkout')(
        makeRequest({ provider: 'paypal', plan: 'Starter', trial: false, mandateConsent: true }) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ provider: 'paypal', approvalUrl, subscriptionId: 'I-EXISTING', recurring: true });
    const staleUpdate = queries.find(query => query.sql.includes("SET status = 'failed'") && query.sql.includes('checkout_expires_at <= NOW()'));
    expect(staleUpdate?.sql).toContain("AND (status = 'creating' OR (provider <> 'paypal' AND replaces_subscription_id IS NULL))");
    expect(queries.some(query => query.sql.includes('INSERT INTO public.payment_subscriptions'))).toBe(false);
    expect(calls.some(call => call.url.includes('/v1/billing/subscriptions') && call.method === 'POST')).toBe(false);
});

it('activates a Razorpay trial only when the verified subscription schedules the first charge after the reserved trial', async () => {
    enableRazorpay();
    const reservedTrialEnd = new Date(Math.ceil((Date.now() + 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000) / 1000) * 1000);
    const context = {
        id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan: 'starter',
        provider_plan_id: 'plan_starter_test', status: 'pending', current_period_end: null,
        currency: 'INR', base_amount: '499.00', tax_percent: '18', tax_amount: '89.82', total_amount: '588.82',
        trial_checkout: true, trial_ends_at: reservedTrialEnd,
    };
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO public.payment_webhook_events')) return { rows: [{ event_id: values[1] }], rowCount: 1 };
            if (sql.includes('qsvc_payment_subscription_context')) return { rows: [context], rowCount: 1 };
            if (sql.includes('SELECT subscription_plan, trial_started_at, trial_ends_at')) return { rows: [], rowCount: 0 };
            if (sql.includes('UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW()')) return { rows: [{ id: user.sub }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/subscriptions/sub_razorpay_trial')) return new Response(JSON.stringify({
            id: 'sub_razorpay_trial', plan_id: 'plan_starter_test', status: 'authenticated',
            start_at: reservedTrialEnd.getTime() / 1000, notes: { qsvc_checkout_id: context.id },
        }), { status: 200 });
        if (url.endsWith('/plans/plan_starter_test')) return new Response(JSON.stringify({
            id: 'plan_starter_test', period: 'monthly', interval: 1, item: { currency: 'INR', amount: 58882 },
        }), { status: 200 });
        throw new Error(`Unexpected mocked provider request: ${url}`);
    }));

    const rawBody = Buffer.from(JSON.stringify({ event: 'subscription.authenticated', payload: {
        subscription: { entity: { id: 'sub_razorpay_trial', plan_id: 'plan_starter_test' } },
    } }));
    const signature = crypto.createHmac('sha256', 'razorpay_test_webhook_secret').update(rawBody).digest('hex');
    const res = makeResponse();

    await route(makeRouter(pool), '/webhooks/razorpay')(
        makeRequest({}, { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'razorpay_trial_event' }, {}, rawBody) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(queries.find(query => query.sql.includes('UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW()'))?.values)
        .toEqual(['starter_trial', reservedTrialEnd, user.sub, user.tenantId]);
    expect(queries.some(query => query.sql.includes("UPDATE public.payment_subscriptions SET status = 'active'"))).toBe(true);
    expect(queries.some(query => query.sql.includes("SET result = 'processed'"))).toBe(true);
});

it('keeps direct trial-start disabled because a trial requires provider authorization', async () => {
    const { pool } = makePool();
    const res = makeResponse();

    await route(makeRouter(pool), '/trial/start')(
        makeRequest({ plan: 'Pro' }) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ code: 'TRIAL_REQUIRES_PAYMENT_AUTHORIZATION' });
    expect(pool.connect).not.toHaveBeenCalled();
});

it('creates a Cashfree trial subscription with GST, account email and normalized Indian mobile', async () => {
    enableCashfree();
    const { pool, queries } = makePool();
    let sentBody: Record<string, any> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return new Response(JSON.stringify({
            subscription_id: sentBody.subscription_id,
            subscription_session_id: 'cashfree_session_test',
            plan_details: { plan_id: 'cashfree_plan_test' },
        }), { status: 200 });
    }));
    const before = Date.now();
    const res = makeResponse();

    await route(makeRouter(pool), '/checkout')(
        makeRequest({ provider: 'cashfree', plan: 'Starter', trial: true, mandateConsent: true }) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ provider: 'cashfree', sessionId: 'cashfree_session_test', email: user.email,
        plan: 'Starter', recurring: true, mode: 'sandbox' });
    expect(sentBody).toMatchObject({
        customer_details: { customer_email: user.email, customer_phone: '9876543210' },
        plan_details: { plan_type: 'PERIODIC', plan_amount: 364.62, plan_max_amount: 364.62,
            plan_max_cycles: 100, plan_intervals: 1, plan_currency: 'INR', plan_interval_type: 'MONTH' },
        authorization_details: { payment_methods: ['upi', 'card'] },
        subscription_tags: { qsvc_checkout_id: sentBody?.subscription_id, plan: 'starter', trial_days: '14' },
    });
    expect(sentBody?.subscription_first_charge_time).toBe(res.body && typeof res.body === 'object'
        ? (res.body as Record<string, unknown>).trialEndsAt : undefined);
    const scheduledAt = Date.parse(String(sentBody?.subscription_first_charge_time));
    expect(scheduledAt).toBeGreaterThanOrEqual(before + 14 * 24 * 60 * 60 * 1000);
    expect(scheduledAt).toBeLessThanOrEqual(Date.now() + 14 * 24 * 60 * 60 * 1000 + 31 * 60 * 1000);
    const insert = queries.find(query => query.sql.includes('INSERT INTO public.payment_subscriptions'));
    expect(insert?.values).toEqual(expect.arrayContaining(['starter', 'INR', '309.00', 18, '55.62', '364.62']));
});

it('rejects a Cashfree webhook with an invalid signature before provider or database access', async () => {
    enableCashfree();
    const { pool } = makePool();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const rawBody = Buffer.from(JSON.stringify({ type: 'SUBSCRIPTION_AUTH_STATUS', data: {} }));
    const res = makeResponse();

    await route(makeRouter(pool), '/webhooks/cashfree')(
        makeRequest({}, { 'x-webhook-signature': 'invalid', 'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)) }, {}, rawBody) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
});

it('ignores a valid Cashfree authorization event for a failed checkout without activating its user', async () => {
    enableCashfree();
    const context = {
        id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan: 'starter',
        provider_plan_id: 'cashfree_plan_test', status: 'failed', current_period_end: null,
        currency: 'INR', base_amount: '499.00', tax_percent: '18', tax_amount: '89.82', total_amount: '588.82',
        trial_checkout: true, trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
    };
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO public.payment_webhook_events')) return { rows: [{ event_id: values[1] }], rowCount: 1 };
            if (sql.includes('qsvc_payment_subscription_context')) return { rows: [context], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const fetch = vi.fn(async () => new Response(JSON.stringify({
        subscription_id: cashfreeSubscriptionId,
        subscription_status: 'ACTIVE',
        subscription_first_charge_time: context.trial_ends_at.toISOString(),
        authorization_details: { authorization_status: 'ACTIVE' },
        plan_details: { plan_id: 'cashfree_plan_test', plan_currency: 'INR', plan_interval_type: 'MONTH',
            plan_intervals: 1, plan_max_cycles: 100, plan_amount: 588.82 },
        subscription_tags: { qsvc_checkout_id: cashfreeSubscriptionId },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const rawBody = Buffer.from(JSON.stringify({ type: 'SUBSCRIPTION_AUTH_STATUS', data: {
        subscription_id: cashfreeSubscriptionId, payment_status: 'SUCCESS',
        authorization_details: { authorization_status: 'ACTIVE' },
    } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', cashfreeWebhookSecret)
        .update(timestamp).update(rawBody).digest('base64');
    const res = makeResponse();

    await route(makeRouter(pool), '/webhooks/cashfree')(
        makeRequest({}, { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, {}, rawBody) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queries.some(query => query.sql.includes('UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW()'))).toBe(false);
    expect(queries.some(query => query.sql.includes("SET result = 'ignored'"))).toBe(true);
    expect(queries.some(query => query.sql.includes('INSERT INTO public.payment_mandate_cancellations'))).toBe(true);
});

it.each([
    { eligible: true, plan: 'starter', trialDays: 7, billing: 'monthly', amount: 588.82, base: '499.00', tax: '89.82', cycles: 100 },
    { eligible: false, plan: 'starter', trialDays: 7, billing: 'monthly', amount: 588.82, base: '499.00', tax: '89.82', cycles: 100 },
    { eligible: true, plan: 'business', trialDays: 14, billing: 'annual', amount: 1905.70, base: '1615.00', tax: '290.70', cycles: 12 },
])('handles $plan $billing Cashfree trial authorization and retries (eligible: $eligible)', async ({ eligible, plan, trialDays, billing, amount, base, tax, cycles }) => {
    enableCashfree();
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    let webhookInsertCount = 0;
    const context = {
        id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan,
        provider_plan_id: 'cashfree_plan_test', status: 'pending', current_period_end: null,
        currency: 'INR', base_amount: base, tax_percent: '18', tax_amount: tax, total_amount: amount.toFixed(2),
        trial_days: trialDays, billing_period: billing,
        trial_checkout: true, trial_ends_at: new Date(Math.floor(Date.now() / 1000) * 1000 + trialDays * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
    };
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO public.payment_webhook_events')) {
                webhookInsertCount += 1;
                return { rows: webhookInsertCount === 1 ? [{ event_id: values[1] }] : [], rowCount: webhookInsertCount === 1 ? 1 : 0 };
            }
            if (sql.includes('qsvc_payment_subscription_context')) return { rows: [context], rowCount: 1 };
            if (sql.includes('SELECT subscription_plan, trial_started_at, trial_ends_at')) return { rows: [], rowCount: 0 };
            if (sql.includes('UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW()')) return { rows: eligible ? [{ id: user.sub }] : [], rowCount: eligible ? 1 : 0 };
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const providerFirstChargeTime = new Date(context.trial_ends_at.getTime() + 5.5 * 60 * 60 * 1000)
        .toISOString().slice(0, 19);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        subscription_id: 'cashfree_sub_provider',
        subscription_status: 'ACTIVE',
        subscription_first_charge_time: providerFirstChargeTime,
        authorization_details: { authorization_status: 'ACTIVE' },
        plan_details: { plan_id: 'cashfree_plan_test', plan_currency: 'INR', plan_interval_type: 'MONTH',
            plan_intervals: 1, plan_max_cycles: cycles, plan_amount: amount },
        subscription_tags: { qsvc_checkout_id: cashfreeSubscriptionId },
    }), { status: 200 })));

    const rawBody = Buffer.from(JSON.stringify({ type: 'SUBSCRIPTION_AUTH_STATUS', data: {
        subscription_id: 'cashfree_sub_provider', payment_status: 'SUCCESS',
        authorization_details: { authorization_status: 'ACTIVE' },
    } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', cashfreeWebhookSecret)
        .update(timestamp).update(rawBody).digest('base64');
    const webhook = route(makeRouter(pool), '/webhooks/cashfree');

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = makeResponse();
        await webhook(
            makeRequest({}, { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, {}, rawBody) as unknown as Request,
            res as unknown as Response,
            vi.fn(),
        );
        expect(res.statusCode).toBe(200);
    }

    expect(webhookInsertCount).toBe(2);
    expect(queries.find(query => query.sql.includes('UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW()'))?.values)
        .toEqual(expect.arrayContaining([`${plan}_trial`, context.trial_ends_at]));
    expect(queries.filter(query => query.sql.includes('UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW()'))).toHaveLength(1);
    expect(queries.some(query => query.sql.includes("UPDATE public.payment_subscriptions SET status = 'active'"))).toBe(eligible);
    expect(queries.some(query => query.sql.includes('INSERT INTO public.payment_mandate_cancellations'))).toBe(!eligible);
});

it.each(['cancelled', 'failed', 'expired', 'overlap', 'missing-period'])('records one Cashfree capture even for a %s subscription', async scenario => {
    enableCashfree();
    const needsReview = ['overlap', 'missing-period'].includes(scenario);
    const status = needsReview ? 'failed' : scenario;
    const context = {
        id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan: 'starter',
        provider_plan_id: 'cashfree_plan_test', status, current_period_end: null,
        currency: 'INR', base_amount: '499.00', tax_percent: '18', tax_amount: '89.82', total_amount: '588.82',
        trial_checkout: false, trial_ends_at: null,
    };
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const captured = new Set<unknown>();
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('qsvc_payment_subscription_context')) return { rows: [context], rowCount: 1 };
            if (sql.includes('AND id <> $3') && scenario === 'overlap') return { rows: [{ id: 'other-subscription' }], rowCount: 1 };
            if (sql.includes('INSERT INTO public.payment_captures')) {
                if (captured.has(values[2])) return { rows: [], rowCount: 0 };
                captured.add(values[2]);
            }
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        subscription_id: 'cashfree_sub_provider',
        subscription_status: 'ACTIVE',
        next_schedule_date: scenario === 'missing-period' ? undefined : new Date(Date.now() + 30 * 86_400_000).toISOString(),
        plan_details: { plan_id: 'cashfree_plan_test', plan_currency: 'INR', plan_interval_type: 'MONTH',
            plan_intervals: 1, plan_max_cycles: 100, plan_amount: 588.82 },
        subscription_tags: { qsvc_checkout_id: cashfreeSubscriptionId },
    }), { status: 200 })));
    const webhook = route(makeRouter(pool), '/webhooks/cashfree');
    const timestamp = String(Math.floor(Date.now() / 1000));
    for (const [index, paymentType] of ['AUTH', 'CHARGE', 'CHARGE'].entries()) {
        const rawBody = Buffer.from(JSON.stringify({
            type: 'SUBSCRIPTION_PAYMENT_SUCCESS', event_time: new Date(Date.now() + index * 1000).toISOString(),
            data: { subscription_id: 'cashfree_sub_provider', payment_id: 'same_charge', payment_type: paymentType,
                payment_status: 'SUCCESS', payment_currency: 'INR', payment_amount: 588.82 },
        }));
        const signature = crypto.createHmac('sha256', cashfreeWebhookSecret)
            .update(timestamp).update(rawBody).digest('base64');
        const res = makeResponse();
        await webhook(
            makeRequest({}, { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, {}, rawBody) as unknown as Request,
            res as unknown as Response,
            vi.fn(),
        );
        expect(res.statusCode).toBe(200);
        if (paymentType === 'AUTH') expect(captured.size).toBe(0);
    }
    const eventIds = queries.filter(query => query.sql.includes('INSERT INTO public.payment_webhook_events')).map(query => query.values[1]);
    expect(new Set(eventIds).size).toBe(3);
    const captures = queries.filter(query => query.sql.includes('INSERT INTO public.payment_captures'));
    expect(captures).toHaveLength(2);
    expect(captures[0].values).toEqual([context.id, 'cashfree', 'same_charge', 58882, 'INR']);
    expect(captured.size).toBe(1);
    expect(queries.filter(query => query.sql.includes('UPDATE public.users SET subscription_plan'))).toHaveLength(needsReview ? 0 : 1);
    expect(queries.filter(query => query.sql.includes("CASE WHEN status IN ('cancelled', 'expired') THEN status ELSE 'active' END"))).toHaveLength(needsReview ? 0 : 1);
    expect(queries.some(query => query.sql.includes('SET needs_review = true'))).toBe(needsReview);
});

it('does not activate a verified legacy order when its payment is already recorded', async () => {
    enableRazorpay();
    const paymentId = 'pay_test123';
    const orderId = 'order_test123';
    const checkout = {
        id: cashfreeSubscriptionId, plan: 'starter', status: 'pending', currency: 'INR',
        total_amount: '588.82', checkout_expires_at: new Date(Date.now() + 60_000),
    };
    const { pool, client } = makePool();
    client.query.mockImplementation(async (sql) => {
        if (sql.includes('provider_order_id = $3')) return { rows: [checkout], rowCount: 1 };
        if (sql.includes('SELECT id FROM public.users')) return { rows: [{ id: user.sub }], rowCount: 1 };
        if (sql.includes('INSERT INTO public.payment_captures')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        id: paymentId, order_id: orderId, amount: 58882, currency: 'INR', status: 'captured',
    }), { status: 200 })));
    const signature = crypto.createHmac('sha256', 'razorpay_test_secret').update(`${orderId}|${paymentId}`).digest('hex');
    const res = makeResponse();
    await route(makeRouter(pool), '/razorpay/verify-payment')(
        makeRequest({ paymentId, orderId, signature }) as unknown as Request, res as unknown as Response, vi.fn(),
    );
    expect(res.statusCode).toBe(409);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE public.users'))).toBe(false);
});

it.each(['success', 'failure', 'pending'])('confirms provider cancellation before completing the durable job (%s)', async scenario => {
    enableCashfree();
    const job = { subscription_id: cashfreeSubscriptionId, tenant_id: user.tenantId,
        provider: 'cashfree', provider_subscription_id: 'provider-subscription' };
    const { pool, queries } = makePool();
    Object.assign(pool, { query: vi.fn().mockResolvedValue({ rows: [job] }) });
    let cancelled = false;
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
        if (options.method === 'POST' && scenario === 'failure') throw new Error('Provider unavailable');
        if (options.method === 'POST' && scenario === 'success') cancelled = true;
        return new Response(JSON.stringify({ subscription_status: cancelled ? 'CANCELLED' : 'ACTIVE' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const logger = { error: vi.fn(), warn: vi.fn() };
    await processMandateCancellations(pool as never, logger);
    expect(fetch).toHaveBeenCalledTimes(scenario === 'failure' ? 2 : 3);
    expect(JSON.parse(String(fetch.mock.calls[1][1].body)).action).toBe('CANCEL');
    expect(queries.some(query => query.sql.includes('SET completed_at = NOW()'))).toBe(scenario === 'success');
    expect(logger.error).toHaveBeenCalledTimes(scenario === 'success' ? 0 : 1);
});

it.each([
    ['Basic', 'monthly', '57.00', '67.26'],
    ['Basic', 'annual', '47.50', '56.05'],
    ['Starter', 'monthly', '309.00', '364.62'],
    ['Starter', 'annual', '257.00', '303.26'],
    ['Pro', 'monthly', '959.20', '1131.86'],
    ['Pro', 'annual', '799.20', '943.06'],
    ['Business', 'monthly', '1938.00', '2286.84'],
    ['Business', 'annual', '1615.00', '1905.70'],
])('publishes the server quote and trial eligibility for %s %s', (plan, billing, baseAmount, totalAmount) => {
    enableCashfree();
    const { pool } = makePool();
    const res = makeResponse();
    route(makeRouter(pool), '/options')(makeRequest(null, {}, { plan, billing }) as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.body).toMatchObject({ billing, trialDays: 14, providers: {
        cashfree: { enabled: true, trialEnabled: true, baseAmount, totalAmount, maxBillingCycles: billing === 'annual' ? 12 : 100 },
    } });
});

it('rejects a stale quote and prevents Enterprise from opening online checkout', async () => {
    enableCashfree();
    const { pool } = makePool();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const checkout = route(makeRouter(pool), '/checkout');
    for (const [plan, expected] of [['Basic', 409], ['Enterprise', 400]] as const) {
        const res = makeResponse();
        await checkout(makeRequest({ provider: 'cashfree', plan, billing: 'annual', trial: true, mandateConsent: true,
            quote: { currency: 'INR', totalAmount: '134.52' } }) as unknown as Request, res as unknown as Response, vi.fn());
        expect(res.statusCode).toBe(expected);
    }
    expect(pool.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

it.each([14, 7])('validates the annual PayPal plan and its trial length (%s days)', async days => {
    enablePayPal();
    vi.stubEnv('PAYPAL_PLAN_BASIC_ANNUAL_TRIAL_14', 'P-ANNUAL-TRIAL');
    vi.stubEnv('PAYPAL_BASIC_ANNUAL_BASE_AMOUNT', '5.00');
    const { pool, queries } = makePool();
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'test', expires_in: 3600 });
        if (url.endsWith('/v1/billing/plans/P-ANNUAL-TRIAL')) return Response.json({
            id: 'P-ANNUAL-TRIAL', status: 'ACTIVE', taxes: { percentage: '18', inclusive: false },
            billing_cycles: [
                { tenure_type: 'TRIAL', frequency: { interval_unit: 'DAY', interval_count: days }, total_cycles: 1 },
                { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 }, total_cycles: 12,
                    pricing_scheme: { fixed_price: { value: '5.00', currency_code: 'USD' } } },
            ],
        });
        if (url.endsWith('/v1/billing/subscriptions')) {
            created = true;
            const body = JSON.parse(String(options?.body));
            expect(body.plan_id).toBe('P-ANNUAL-TRIAL');
            expect(new URL(body.application_context.return_url).searchParams.get('billing')).toBe('annual');
            return Response.json({ id: 'I-ANNUAL-TRIAL', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=I-ANNUAL-TRIAL' }] });
        }
        throw new Error('Unexpected provider request');
    }));
    const res = makeResponse();
    await route(makeRouter(pool), '/checkout')(makeRequest({ provider: 'paypal', plan: 'Basic', billing: 'annual', trial: true, mandateConsent: true }) as unknown as Request,
        res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(days === 14 ? 200 : 503);
    expect(created).toBe(days === 14);
    if (days === 14) {
        expect(queries.find(query => query.sql.includes('INSERT INTO public.payment_subscriptions'))?.values).toEqual(
            expect.arrayContaining(['basic', 'USD', '5.90', 14, 'annual']),
        );
    }
});


it.each((['basic', 'starter', 'pro', 'business'] as const).flatMap(plan =>
    (['monthly', 'annual'] as const).map(billing => ({ plan, billing })),
))('applies verified $plan $billing payment access and preserves the final paid month', async ({ plan, billing }) => {
    enableCashfree();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-31T10:00:00.000Z'));
    const price = getPlanPrice(plan, billing)!;
    const expectedEnd = new Date('2027-02-28T10:00:00.000Z');
    const account = {
        tenant_plan: 'free', subscription_plan: `${plan}_trial`,
        subscription_expires_at: null as Date | null, trial_started_at: '2027-01-01T10:00:00Z',
        trial_ends_at: '2027-01-15T10:00:00Z',
    };
    const context = {
        id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan,
        provider_plan_id: 'cashfree_plan_test', status: billing === 'annual' ? 'expired' : 'active',
        current_period_end: null, currency: 'INR', base_amount: String(price.baseAmountMinor / 100),
        tax_percent: '18', tax_amount: String(price.taxAmountMinor / 100), total_amount: String(price.totalAmountMinor / 100),
        trial_checkout: true, trial_ends_at: new Date(account.trial_ends_at), trial_days: 14, billing_period: billing,
    };
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const eventIds = new Set();
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('qsvc_payment_subscription_context')) return { rows: [context], rowCount: 1 };
            if (sql.includes('INSERT INTO public.payment_webhook_events')) {
                if (eventIds.has(values[1])) return { rows: [], rowCount: 0 };
                eventIds.add(values[1]);
            }
            if (sql.includes('UPDATE public.users SET subscription_plan')) {
                account.subscription_plan = String(values[0]);
                account.subscription_expires_at = values[2] as Date;
            }
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
        subscription_id: 'cashfree_sub_provider', subscription_status: billing === 'annual' ? 'COMPLETED' : 'ACTIVE',
        next_schedule_date: billing === 'monthly' ? expectedEnd.toISOString() : undefined,
        plan_details: { plan_id: 'cashfree_plan_test', plan_currency: 'INR', plan_interval_type: 'MONTH',
            plan_intervals: 1, plan_max_cycles: billing === 'annual' ? 12 : 100, plan_amount: price.totalAmountMinor / 100 },
        subscription_tags: { qsvc_checkout_id: context.id },
    })));
    const pool = { connect: vi.fn(async () => client) };
    const webhook = route(makeRouter(pool), '/webhooks/cashfree');
    const rawBody = Buffer.from(JSON.stringify({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS', event_time: new Date().toISOString(),
        data: { subscription_id: 'cashfree_sub_provider', payment_id: `paid_${plan}_${billing}`, payment_type: 'CHARGE',
            payment_status: 'SUCCESS', payment_currency: 'INR', payment_amount: price.totalAmountMinor / 100 },
    }));
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', cashfreeWebhookSecret).update(timestamp).update(rawBody).digest('base64');
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = makeResponse();
        await webhook(makeRequest({}, { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, {}, rawBody) as unknown as Request,
            res as unknown as Response, vi.fn());
        expect(res.statusCode).toBe(200);
    }
    expect(queries.filter(query => query.sql.includes('UPDATE public.users SET subscription_plan'))).toHaveLength(1);
    expect(account).toMatchObject({ subscription_plan: plan, subscription_expires_at: expectedEnd });
    const expectedFeatures = plan === 'basic' ? ['background_effects', 'ai_noise_suppression']
        : plan === 'starter' ? ['meeting_scheduling', 'ai_captions', 'background_effects', 'ai_noise_suppression']
            : ['meeting_scheduling', 'ai_captions', 'background_effects', 'ai_noise_suppression', 'cloud_recording'];
    expect(getEntitlements(account)).toMatchObject({ plan, status: 'paid_active', trialUsed: true, features: expectedFeatures });
    expect(getEntitlements(account, expectedEnd)).toMatchObject({ plan, status: 'paid_expired', features: [] });
    expect(queries.find(query => query.sql.includes('UPDATE public.users SET subscription_plan'))?.values)
        .toEqual([plan, user.sub, expectedEnd, user.tenantId, false]);
});

it('keeps a signed Razorpay browser confirmation pending until the provider webhook activates access', async () => {
    enableRazorpay();
    const { pool, client, queries } = makePool();
    client.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        return { rows: sql.includes('SELECT provider_subscription_id') ? [{ provider_subscription_id: 'sub_selected123' }] : [], rowCount: 1 };
    });
    vi.stubGlobal('fetch', vi.fn());
    const paymentId = 'pay_selected123';
    const subscriptionId = 'sub_selected123';
    const signature = crypto.createHmac('sha256', 'razorpay_test_secret').update(`${paymentId}|${subscriptionId}`).digest('hex');
    const res = makeResponse();
    await route(makeRouter(pool), '/razorpay/verify')(
        makeRequest({ paymentId, subscriptionId, signature }) as unknown as Request, res as unknown as Response, vi.fn(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ verified: true, activation: 'pending_webhook' });
    expect(queries.some(query => query.sql.includes('UPDATE public.users'))).toBe(false);
    expect(queries.some(query => query.sql.includes('INSERT INTO public.payment_captures'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
});

it('cancels a paid renewal without reducing the purchased plan or remaining access period', async () => {
    enableCashfree();
    const periodEnd = new Date(Date.now() + 15 * 86_400_000);
    const { pool, client, queries } = makePool();
    client.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.includes('AS uncharged_trial')) return { rows: [{
            id: cashfreeSubscriptionId, provider: 'cashfree', provider_subscription_id: 'selected-subscription',
            billing_mode: 'subscription', status: 'active', current_period_end: periodEnd, uncharged_trial: false,
        }], rowCount: 1 };
        if (sql.includes('RETURNING current_period_end')) return { rows: [{ currentPeriodEnd: periodEnd }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ subscription_status: 'CANCELLED' })));
    const res = makeResponse();
    await route(makeRouter(pool), '/cancel')(
        makeRequest({ subscriptionId: cashfreeSubscriptionId }) as unknown as Request, res as unknown as Response, vi.fn(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ cancelled: true, currentPeriodEnd: periodEnd });
    expect(queries.some(query => query.sql.includes('UPDATE public.users'))).toBe(false);
    const cancellation = queries.find(query => query.sql.includes("SET status = 'cancelled'"));
    expect(cancellation?.sql).not.toMatch(/current_period_end\s*=/);
    expect(cancellation?.values).toEqual([cashfreeSubscriptionId, user.tenantId, user.sub]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/subscriptions/selected-subscription/manage'),
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"action":"CANCEL"') }));
});

it.each([
    ['Basic', 'monthly', '67.26', '134.52', 3],
    ['Basic', 'annual', '56.05', '112.10', 3],
    ['Pro', 'monthly', '1131.86', '1414.82', 1],
    ['Pro', 'annual', '943.06', '1178.82', 1],
] as const)('creates the agreed discounted %s %s mandate and stores the regular renewal snapshot', async (plan, billing, first, regular, cycles) => {
    enableCashfree();
    const { pool, queries } = makePool();
    let sent: any;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ subscription_id: sent.subscription_id, subscription_session_id: 'intro-session', plan_details: { plan_id: 'intro-plan' } });
    }));
    const res = makeResponse();
    await route(makeRouter(pool), '/checkout')(makeRequest({ provider: 'cashfree', plan, billing, trial: true, mandateConsent: true,
        quote: { currency: 'INR', totalAmount: first, promotion: { cycles, regularTotalAmount: regular } } }) as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(sent.plan_details).toMatchObject({ plan_amount: Number(first), plan_max_amount: Number(regular) });
    expect(sent.customer_details.customer_email).toBe(user.email);
    const snapshot = queries.find(query => query.sql.includes('SET intro_cycles = $1'));
    expect(snapshot?.values[0]).toBe(cycles);
    expect(snapshot?.values[3]).toBe(regular);
    expect(snapshot?.values[4]).toMatch(/^qs_[a-f0-9]{32}_r$/);
    expect(new Date(sent.subscription_first_charge_time).getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
});

it.each([
    ['intro', 67.26, true],
    ['regular', 134.52, true],
    ['late-intro', 67.26, true],
    ['after-transition-underpayment', 67.26, false],
] as const)('validates Cashfree price-phase receipts and idempotent access: %s', async (phase, amount, accepted) => {
    enableCashfree();
    const completed = new Date(Date.now() - 3600000);
    const context = { id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan: 'basic', provider_plan_id: phase === 'intro' ? 'intro-plan' : 'regular-plan',
        status: 'active', currency: 'INR', base_amount: phase === 'intro' ? '57' : '114', tax_amount: phase === 'intro' ? '10.26' : '20.52',
        total_amount: phase === 'intro' ? '67.26' : '134.52', tax_percent: '18', trial_checkout: false, trial_days: 14, billing_period: 'monthly',
        intro_cycles: 3, intro_total_amount: '67.26', regular_provider_plan_id: 'regular-plan', regular_total_amount: '134.52', price_transition_completed_at: phase === 'intro' ? null : completed };
    let captured = false;
    const queries: string[] = [];
    const client = { query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('qsvc_payment_subscription_context')) return { rows: [context], rowCount: 1 };
        if (sql.includes('INSERT INTO public.payment_captures')) { if (captured) return { rows: [], rowCount: 0 }; captured = true; }
        return { rows: [], rowCount: 1 };
    }), release: vi.fn() };
    const regularPhase = phase !== 'intro';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ subscription_id: 'provider-sub', subscription_status: 'ACTIVE',
        next_schedule_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        plan_details: { plan_id: regularPhase ? 'regular-plan' : 'intro-plan', plan_currency: 'INR', plan_amount: regularPhase ? 134.52 : 67.26,
            plan_interval_type: 'MONTH', plan_intervals: 1, plan_max_cycles: regularPhase ? 97 : 100 },
        subscription_tags: { qsvc_checkout_id: context.id } })));
    const eventTime = phase === 'late-intro' ? new Date(completed.getTime() - 60000) : new Date();
    const rawBody = Buffer.from(JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', event_time: eventTime.toISOString(),
        data: { subscription_id: 'provider-sub', payment_id: 'paid-phase', payment_type: 'CHARGE', payment_status: 'SUCCESS', payment_currency: 'INR', payment_amount: amount } }));
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', cashfreeWebhookSecret).update(timestamp).update(rawBody).digest('base64');
    const webhook = route(makeRouter({ connect: vi.fn(async () => client) } as never), '/webhooks/cashfree');
    for (let repeat = 0; repeat < 2; repeat++) {
        const res = makeResponse();
        await webhook(makeRequest({}, { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, {}, rawBody) as unknown as Request, res as unknown as Response, vi.fn());
        expect(res.statusCode).toBe(200);
    }
    expect(queries.filter(sql => sql.includes('UPDATE public.users SET subscription_plan'))).toHaveLength(accepted ? 1 : 0);
});

it.each([undefined, { cycles: 1, regularTotalAmount: '134.52' }, { cycles: 3, regularTotalAmount: '999.00' }])('rejects stale or missing future renewal terms before creating a mandate', async promotion => {
    enableCashfree();
    const { pool } = makePool();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = makeResponse();
    await route(makeRouter(pool), '/checkout')(makeRequest({ provider: 'cashfree', plan: 'Basic', billing: 'monthly', trial: true, mandateConsent: true,
        quote: { currency: 'INR', totalAmount: '67.26', promotion } }) as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
});

it('creates a full-price upgrade while the current Basic subscription remains active', async () => {
    enableCashfree();
    const { pool, queries } = makePool({
        account: { subscription_plan: 'basic' },
        openSubscription: { id: cashfreeSubscriptionId, plan: 'basic', status: 'active', provider: 'cashfree' },
    });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body));
        expect(payload.plan_details.plan_amount).toBe(1414.82);
        expect(payload.subscription_first_charge_time).toBeUndefined();
        return Response.json({ subscription_id: payload.subscription_id, subscription_session_id: 'new_session',
            plan_details: { plan_id: 'new_plan' } });
    });
    vi.stubGlobal('fetch', fetch);
    const checkout = route(makeRouter(pool), '/checkout');
    const input = { provider: 'cashfree', plan: 'Pro', trial: false, mandateConsent: true,
        upgradeFrom: cashfreeSubscriptionId, quote: { currency: 'INR', totalAmount: '1414.82' } };
    const res = makeResponse();
    await checkout(makeRequest(input) as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queries.find(q => q.sql.includes('INSERT INTO public.payment_subscriptions'))?.values.at(-1)).toBe(cashfreeSubscriptionId);
    expect(queries.some(q => q.sql.includes('superseded_by_subscription_id =') || q.sql.includes('UPDATE public.users'))).toBe(false);

    const wrong = makeResponse();
    await checkout(makeRequest({ ...input, upgradeFrom: user.sub }) as unknown as Request, wrong as unknown as Response, vi.fn());
    expect(wrong.statusCode).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
});

it('blocks test-mode checkout from replacing an existing subscription in production', async () => {
    enableRazorpay();
    vi.stubEnv('NODE_ENV', 'production');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = makeResponse();
    await route(makeRouter(makePool().pool), '/checkout')(makeRequest({
        provider: 'razorpay', plan: 'Starter', trial: false, mandateConsent: true,
        upgradeFrom: cashfreeSubscriptionId, quote: { currency: 'INR', totalAmount: '364.62' },
    }) as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
});

it('switches plans only on a verified capture and keeps late old-plan payments from downgrading access', async () => {
    enableCashfree();
    const previousId = '00000000-0000-4000-8000-000000000004';
    const nextId = cashfreeSubscriptionId;
    const periodEnd = new Date(Date.now() + 30 * 86400000);
    let previousSuperseded = false;
    let currentPlan = 'basic';
    const captures = new Set<unknown>();
    const queued = new Set<unknown>();
    const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
            if (sql.includes('qsvc_payment_subscription_context')) {
                const plan = values[1] === 'old' ? 'basic' : 'pro';
                const price = getPlanPrice(plan)!;
                return { rows: [{ id: plan === 'basic' ? previousId : nextId, tenant_id: user.tenantId, user_id: user.sub,
                    plan, provider_plan_id: plan, status: plan === 'basic' ? 'active' : 'pending', current_period_end: null,
                    currency: 'INR', base_amount: String(price.baseAmountMinor / 100), tax_amount: String(price.taxAmountMinor / 100),
                    total_amount: String(price.totalAmountMinor / 100), tax_percent: '18', trial_checkout: false,
                    trial_days: 14, billing_period: 'monthly' }], rowCount: 1 };
            }
            if (sql.includes('SELECT replaces_subscription_id')) return { rows: [values[0] === nextId
                ? { replaces_subscription_id: previousId }
                : { superseded_by_subscription_id: previousSuperseded ? nextId : null }], rowCount: 1 };
            if (sql.includes('SELECT id, plan, status, superseded_by_subscription_id')) {
                return { rows: [{ id: previousId, plan: 'basic', status: 'active', billing_mode: 'subscription' }], rowCount: 1 };
            }
            if (sql.includes('INSERT INTO public.payment_captures')) {
                if (captures.has(values[2])) return { rows: [], rowCount: 0 };
                captures.add(values[2]);
            }
            if (sql.includes('SET status = \'cancelled\', superseded_by_subscription_id')) previousSuperseded = true;
            if (sql.includes('INSERT INTO public.payment_mandate_cancellations')) queued.add(values[0]);
            if (sql.includes('UPDATE public.users SET subscription_plan')) {
                expect(previousSuperseded).toBe(true);
                expect(queued.has(previousId)).toBe(true);
                expect(values).toEqual(['pro', user.sub, periodEnd, user.tenantId, true]);
                currentPlan = String(values[0]);
            }
            return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const old = url.endsWith('/old');
        const plan = old ? 'basic' : 'pro';
        return Response.json({
            subscription_id: old ? 'old' : 'new', subscription_status: 'ACTIVE', next_schedule_date: periodEnd.toISOString(),
            plan_details: { plan_id: plan, plan_currency: 'INR', plan_interval_type: 'MONTH', plan_intervals: 1,
                plan_max_cycles: 100, plan_amount: getPlanPrice(plan)!.totalAmountMinor / 100 },
            subscription_tags: { qsvc_checkout_id: old ? previousId : nextId },
        });
    }));
    const webhook = route(makeRouter({ connect: vi.fn(async () => client) }), '/webhooks/cashfree');
    async function capture(subscription: string, amount: number, payment: string) {
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', data: {
            subscription_id: subscription, payment_id: payment, payment_type: 'CHARGE',
            payment_status: 'SUCCESS', payment_currency: 'INR', payment_amount: amount,
        } }));
        const timestamp = String(Date.now());
        const signature = crypto.createHmac('sha256', cashfreeWebhookSecret).update(timestamp).update(rawBody).digest('base64');
        const res = makeResponse();
        await webhook(makeRequest({}, { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, {}, rawBody) as unknown as Request,
            res as unknown as Response, vi.fn());
        expect(res.statusCode).toBe(200);
    }

    await capture('new', 1, 'wrong_amount');
    expect(currentPlan).toBe('basic');
    expect(queued.size).toBe(0);
    await capture('new', 1414.82, 'upgrade_capture');
    await capture('new', 1414.82, 'upgrade_capture');
    await capture('old', 134.52, 'old_renewal');
    expect(currentPlan).toBe('pro');
    expect([...captures]).toEqual(['upgrade_capture', 'old_renewal']);
    expect([...queued]).toEqual([previousId]);
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('UPDATE public.users SET subscription_plan'))).toHaveLength(1);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("review_reason = 'superseded_subscription'"))).toBe(true);
});
