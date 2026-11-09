import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { billingRouter, processMandateCancellations } from './billing';

const user = {
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002',
    email: 'member@example.test',
    role: 'user',
};
const cashfreeSubscriptionId = '00000000-0000-4000-8000-000000000003';
const cashfreeWebhookSecret = 'cashfree_webhook_test_secret';

afterEach(() => {
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

it('creates a server-priced recurring Razorpay subscription after validating the configured monthly plan', async () => {
    enableRazorpay();
    const { pool, queries } = makePool();
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
        calls.push({ url, body });
        if (url.endsWith('/plans/plan_starter_test')) {
            return new Response(JSON.stringify({ id: 'plan_starter_test', period: 'monthly', interval: 1,
                item: { currency: 'INR', amount: 58882 } }), { status: 200 });
        }
        if (url.endsWith('/subscriptions')) {
            return new Response(JSON.stringify({ id: 'sub_test123', plan_id: 'plan_starter_test', status: 'created' }), { status: 200 });
        }
        throw new Error(`Unexpected mocked provider request: ${url}`);
    }));

    const res = makeResponse();
    await route(makeRouter(pool), '/checkout')(
        makeRequest({ provider: 'razorpay', plan: 'Starter', trial: false, mandateConsent: true, amount: 1, currency: 'USD' }) as unknown as Request,
        res as unknown as Response,
        vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ provider: 'razorpay', subscription_id: 'sub_test123', keyId: 'rzp_test_public',
        email: user.email, plan: 'Starter', amount: 58882, currency: 'INR', recurring: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/plans/plan_starter_test');
    expect(calls[1].body).toMatchObject({ plan_id: 'plan_starter_test', total_count: 100, customer_notify: 1,
        notes: { plan: 'starter', trial_days: '0' } });
    expect(calls[1].body?.expire_by).toEqual(expect.any(Number));
    expect(calls[1].body).not.toHaveProperty('amount');
    expect(queries.find(query => query.sql.includes('INSERT INTO public.payment_subscriptions'))?.values).toEqual(
        expect.arrayContaining(['starter', 499, 18, 89.82, 588.82]),
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
    expect(staleUpdate?.sql).toContain("AND (provider <> 'paypal' OR status = 'creating')");
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
        plan_details: { plan_type: 'PERIODIC', plan_amount: 588.82, plan_max_amount: 588.82,
            plan_max_cycles: 100, plan_intervals: 1, plan_currency: 'INR', plan_interval_type: 'MONTH' },
        authorization_details: { payment_methods: ['upi', 'card'] },
        subscription_tags: { qsvc_checkout_id: sentBody?.subscription_id, plan: 'starter', trial_days: '7' },
    });
    expect(sentBody?.subscription_first_charge_time).toBe(res.body && typeof res.body === 'object'
        ? (res.body as Record<string, unknown>).trialEndsAt : undefined);
    const scheduledAt = Date.parse(String(sentBody?.subscription_first_charge_time));
    expect(scheduledAt).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(scheduledAt).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 31 * 60 * 1000);
    const insert = queries.find(query => query.sql.includes('INSERT INTO public.payment_subscriptions'));
    expect(insert?.values).toEqual(expect.arrayContaining(['starter', 'INR', '499.00', 18, '89.82', '588.82']));
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

it.each([true, false])('handles signed Cashfree trial authorization and retries (eligible: %s)', async eligible => {
    enableCashfree();
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    let webhookInsertCount = 0;
    const context = {
        id: cashfreeSubscriptionId, tenant_id: user.tenantId, user_id: user.sub, plan: 'starter',
        provider_plan_id: 'cashfree_plan_test', status: 'pending', current_period_end: null,
        currency: 'INR', base_amount: '499.00', tax_percent: '18', tax_amount: '89.82', total_amount: '588.82',
        trial_checkout: true, trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
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
            plan_intervals: 1, plan_max_cycles: 100, plan_amount: 588.82 },
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
    expect(queries.filter(query => query.sql.includes("CASE WHEN status = 'cancelled' THEN status ELSE 'active' END"))).toHaveLength(needsReview ? 0 : 1);
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
