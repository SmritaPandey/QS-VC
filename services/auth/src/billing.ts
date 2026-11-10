import express, { type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { JwtPayload } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { getEntitlements, PLAN_LEVEL } from '../../../shared/entitlements.cjs';
import { GST_PERCENT, PAID_PLAN_NAMES, TRIAL_DAYS, getPlanPrice, type BillingPeriod, type PaidPlanKey as PlanKey } from '../../../shared/payment-pricing.mjs';
import { effectiveRole } from './platform-admins.js';

type Provider = 'razorpay' | 'paypal' | 'cashfree';
type BillingUser = JwtPayload & { sub: string; tenantId: string; email: string; role: string };
type Logger = { warn: (object: unknown, message?: string) => void; error: (object: unknown, message?: string) => void };
type BillingContext = {
    id: string; tenant_id: string; user_id: string; plan: PlanKey; provider_plan_id: string;
    status: string; current_period_end: Date | null; currency: string; base_amount: string;
    tax_percent: string; tax_amount: string; total_amount: string; trial_checkout: boolean;
    trial_ends_at: Date | null; trial_days: number; billing_period: BillingPeriod;
};
type ProviderPlanSnapshot = {
    id: string; currency: string; intervalUnit: string; intervalCount: number;
    amount?: string | number; amountMinor?: number; totalCycles?: number; hasTrial?: boolean; trialDays?: number;
    taxPercent?: string | number | null; taxInclusive?: boolean | null;
    setupFee?: string | number | null;
};

const checkoutSchema = z.object({
    provider: z.enum(['razorpay', 'paypal', 'cashfree']),
    plan: z.enum(PAID_PLAN_NAMES),
    billing: z.enum(['monthly', 'annual']).default('monthly'),
    trial: z.boolean(),
    mandateConsent: z.literal(true),
    quote: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), totalAmount: z.string().regex(/^\d+(?:\.\d{1,6})?$/) }).optional(),
});
const razorpayVerifySchema = z.object({
    paymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
    subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
});
const razorpayOrderVerifySchema = z.object({
    paymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
    orderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
});
const cancelSchema = z.object({ subscriptionId: z.string().uuid() });
const PROVIDER_TIMEOUT_MS = 8000;
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const MAX_BILLING_CYCLES = 100;

async function enqueueMandateCancellation(client: PoolClient, context: BillingContext) {
    await client.query(`INSERT INTO public.payment_mandate_cancellations (subscription_id, tenant_id)
        VALUES ($1, $2) ON CONFLICT (subscription_id) DO NOTHING`, [context.id, context.tenant_id]);
}

export async function processMandateCancellations(pool: Pool, logger: Logger) {
    const jobs = await pool.query('SELECT * FROM public.qsvc_claim_mandate_cancellations()');
    for (const job of jobs.rows) {
        try {
            const id = encodeURIComponent(job.provider_subscription_id);
            if (job.provider === 'razorpay') {
                let current = await razorpayRequest(`/subscriptions/${id}`, 'GET');
                if (!['cancelled', 'completed', 'expired'].includes(current.status)) {
                    await razorpayRequest(`/subscriptions/${id}/cancel`, 'POST', { cancel_at_cycle_end: false });
                    current = await razorpayRequest(`/subscriptions/${id}`, 'GET');
                }
                if (!['cancelled', 'completed', 'expired'].includes(current.status)) throw new Error('Cancellation not yet confirmed');
            } else if (job.provider === 'paypal') {
                let current = await paypalRequest(`/v1/billing/subscriptions/${id}`, 'GET');
                if (!['CANCELLED', 'EXPIRED'].includes(current.status)) {
                    await paypalRequest(`/v1/billing/subscriptions/${id}/cancel`, 'POST', { reason: 'Trial authorization could not be applied.' });
                    current = await paypalRequest(`/v1/billing/subscriptions/${id}`, 'GET');
                }
                if (!['CANCELLED', 'EXPIRED'].includes(current.status)) throw new Error('Cancellation not yet confirmed');
            } else if (job.provider === 'cashfree') {
                let current = await cashfreeRequest(`/subscriptions/${id}`, 'GET');
                if (!['CANCELLED', 'CUSTOMER_CANCELLED', 'COMPLETED', 'EXPIRED'].includes(current.subscription_status)) {
                    await cashfreeRequest(`/subscriptions/${id}/manage`, 'POST', {
                        subscription_id: job.provider_subscription_id, action: 'CANCEL',
                    }, crypto.randomUUID());
                    current = await cashfreeRequest(`/subscriptions/${id}`, 'GET');
                }
                if (!['CANCELLED', 'CUSTOMER_CANCELLED', 'COMPLETED', 'EXPIRED'].includes(current.subscription_status)) throw new Error('Cancellation not yet confirmed');
            } else throw new Error('Unknown cancellation provider');
            await inTenant(pool, job.tenant_id, client => client.query(
                'UPDATE public.payment_mandate_cancellations SET completed_at = NOW() WHERE subscription_id = $1 AND tenant_id = $2',
                [job.subscription_id, job.tenant_id],
            ));
        } catch {
            logger.error({ subscriptionId: job.subscription_id, provider: job.provider }, 'Provider mandate cancellation pending; retry scheduled');
        }
    }
}

function planKey(plan: string): PlanKey | null {
    const key = plan.toLowerCase();
    return PAID_PLAN_NAMES.some(name => name.toLowerCase() === key) ? key as PlanKey : null;
}

function planName(plan: PlanKey) {
    return PAID_PLAN_NAMES.find(name => name.toLowerCase() === plan)!;
}

function billingCycles(provider: Provider, billing: BillingPeriod) {
    return billing === 'annual' ? 12 : provider === 'paypal' ? 0 : MAX_BILLING_CYCLES;
}

function paymentsEnabled() { return process.env.PAYMENTS_ENABLED === 'true' && process.env.PAYMENT_TERMS_CONFIRMED === 'true'; }
function providerMode(provider: Provider): 'live' | 'test' | 'unknown' {
    if (provider === 'razorpay') {
        const keyId = process.env.RAZORPAY_KEY_ID || '';
        return keyId.startsWith('rzp_live_') ? 'live' : keyId.startsWith('rzp_test_') ? 'test' : 'unknown';
    }
    return provider === 'cashfree'
        ? process.env.CASHFREE_ENVIRONMENT === 'production' ? 'live' : 'test'
        : process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'test';
}
function paypalBaseUrl() {
    return process.env.PAYPAL_ENVIRONMENT === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
}
function razorpayConfigured() { return paymentsEnabled() && Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET); }
function razorpaySubscriptionsConfigured(plan: PlanKey, billing: BillingPeriod) {
    return razorpayConfigured() && Boolean(process.env.RAZORPAY_WEBHOOK_SECRET && providerPlanId('razorpay', plan, billing));
}
function cashfreeConfigured() {
    const publicAuthUrlConfigured = process.env.NODE_ENV !== 'production'
        || Boolean(process.env.AUTH_PUBLIC_URL || process.env.VITE_AUTH_URL);
    return paymentsEnabled() && publicAuthUrlConfigured
        && Boolean(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
}
function paypalConfigured(plan: PlanKey, billing: BillingPeriod, trial = false) {
    return paymentsEnabled() && Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
        && process.env.PAYPAL_WEBHOOK_ID && providerPlanId('paypal', plan, billing, trial)
        && paypalConfiguredAmount(plan, billing) && process.env.PAYPAL_CURRENCY);
}
function cashfreeBaseUrl() {
    return process.env.CASHFREE_ENVIRONMENT === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
}

function cashfreeDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !value) return null;
    // Cashfree returns some IST timestamps without an explicit offset.
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value
        : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : `${value}+05:30`;
    const date = new Date(zoned);
    return Number.isNaN(date.getTime()) ? null : date;
}
function nextCalendarMonth(date: Date) {
    const next = new Date(date);
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, daysInMonth));
    return next;
}

function providerPlanId(provider: 'razorpay' | 'paypal', plan: PlanKey, billing: BillingPeriod, trial = false): string {
    const term = billing === 'annual' ? '_ANNUAL' : '';
    // New trial plans must explicitly be configured for 14 days. Legacy subscriptions
    // are still verified against the provider plan and terms stored on their row.
    const trialSuffix = provider === 'paypal' && trial ? '_TRIAL_14' : '';
    return process.env[`${provider.toUpperCase()}_PLAN_${plan.toUpperCase()}${term}${trialSuffix}`] || '';
}

function currencyDigits(currency: string): number {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
    catch { throw new Error('Unsupported payment currency configuration'); }
}

function decimalToMinor(value: string, currency: string): number {
    if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid configured amount');
    const digits = currencyDigits(currency);
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) throw new Error('Configured amount has too many decimal places');
    const minor = BigInt(whole) * (10n ** BigInt(digits)) + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Configured amount is too large');
    return Number(minor);
}

function minorToDecimal(amount: number, currency: string): string {
    const digits = currencyDigits(currency);
    const divisor = 10 ** digits;
    return (amount / divisor).toFixed(digits);
}

function paypalConfiguredAmount(plan: PlanKey, billing: BillingPeriod): string {
    const term = billing === 'annual' ? '_ANNUAL' : '';
    return process.env[`PAYPAL_${plan.toUpperCase()}${term}_BASE_AMOUNT`] || '';
}

function publicOptions(plan: PlanKey, billing: BillingPeriod) {
    const price = getPlanPrice(plan, billing);
    if (!price) return null;
    const razorpay = {
        mode: providerMode('razorpay'),
        enabled: razorpaySubscriptionsConfigured(plan, billing),
        trialEnabled: razorpaySubscriptionsConfigured(plan, billing),
        maxBillingCycles: billingCycles('razorpay', billing),
        currency: price.currency,
        baseAmount: minorToDecimal(price.baseAmountMinor, price.currency),
        taxAmount: minorToDecimal(price.taxAmountMinor, price.currency),
        totalAmount: minorToDecimal(price.totalAmountMinor, price.currency),
        taxPercent: GST_PERCENT,
    };
    let paypal = { mode: providerMode('paypal'), enabled: paypalConfigured(plan, billing), trialEnabled: paypalConfigured(plan, billing, true), maxBillingCycles: billingCycles('paypal', billing) || null, currency: (process.env.PAYPAL_CURRENCY || '').toUpperCase(), baseAmount: '', taxAmount: '', totalAmount: '', taxPercent: GST_PERCENT };
    if (paypal.enabled || paypal.trialEnabled) {
        try {
            const baseMinor = decimalToMinor(paypalConfiguredAmount(plan, billing), paypal.currency);
            if (baseMinor <= 0 || (paypal.currency === price.currency && baseMinor !== price.baseAmountMinor)) throw new Error('Invalid PayPal rate');
            const taxMinor = Math.round(baseMinor * GST_PERCENT / 100);
            paypal = {
                ...paypal,
                baseAmount: minorToDecimal(baseMinor, paypal.currency),
                taxAmount: minorToDecimal(taxMinor, paypal.currency),
                totalAmount: minorToDecimal(baseMinor + taxMinor, paypal.currency),
            };
        } catch {
            paypal = { ...paypal, enabled: false, trialEnabled: false };
        }
    }
    const cashfree = {
        mode: providerMode('cashfree'),
        enabled: cashfreeConfigured() && price.currency === 'INR',
        trialEnabled: cashfreeConfigured() && price.currency === 'INR',
        maxBillingCycles: billingCycles('cashfree', billing),
        currency: price.currency,
        baseAmount: minorToDecimal(price.baseAmountMinor, price.currency),
        taxAmount: minorToDecimal(price.taxAmountMinor, price.currency),
        totalAmount: minorToDecimal(price.totalAmountMinor, price.currency),
        taxPercent: GST_PERCENT,
        paymentMethods: ['UPI AutoPay (BHIM and other UPI apps)', 'Credit/debit card'],
    };
    return { paymentsEnabled: paymentsEnabled(), taxPercent: GST_PERCENT, trialDays: TRIAL_DAYS, billing, providers: { razorpay, paypal, cashfree } };
}

async function inTenant<T>(pool: Pool, tenantId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function readJson(response: globalThis.Response): Promise<Record<string, any>> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('Payment provider request failed');
    return body as Record<string, any>;
}

async function razorpayRequest(path: string, method: string, body?: unknown) {
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: { Authorization: `Basic ${credentials}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return readJson(response);
}

let paypalToken: { value: string; expiresAt: number } | null = null;
async function getPayPalToken(): Promise<string> {
    if (paypalToken && paypalToken.expiresAt > Date.now() + 30_000) return paypalToken.value;
    const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const result = await readJson(response);
    if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number') throw new Error('Payment provider authorization failed');
    paypalToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
    return result.access_token;
}

async function paypalRequest(path: string, method: string, body?: unknown, requestId?: string) {
    const token = await getPayPalToken();
    const response = await fetch(`${paypalBaseUrl()}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return readJson(response);
}

async function cashfreeRequest(path: string, method: string, body?: unknown, idempotencyKey?: string) {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Cashfree credentials are not configured');
    const response = await fetch(`${cashfreeBaseUrl()}${path}`, {
        method,
        headers: {
            'x-api-version': process.env.CASHFREE_API_VERSION || '2026-01-01',
            'x-client-id': clientId,
            'x-client-secret': clientSecret,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return readJson(response);
}

async function validateRazorpayPlan(plan: PlanKey, billing: BillingPeriod) {
    const expected = getPlanPrice(plan, billing)!;
    const configuredId = providerPlanId('razorpay', plan, billing);
    const details = await razorpayRequest(`/plans/${encodeURIComponent(configuredId)}`, 'GET');
    if (details.id !== configuredId || details.period !== 'monthly' || Number(details.interval) !== 1
        || details.item?.currency !== expected.currency || Number(details.item?.amount) !== expected.totalAmountMinor) {
        throw new Error('The Razorpay plan must be monthly and match the configured price, including 18% GST.');
    }
    return { id: configuredId, currency: expected.currency, baseAmount: expected.baseAmountMinor / 100,
        taxAmount: expected.taxAmountMinor / 100, totalAmount: expected.totalAmountMinor / 100 };
}

async function validatePayPalPlan(plan: PlanKey, billing: BillingPeriod, trial: boolean) {
    const configuredId = providerPlanId('paypal', plan, billing, trial);
    const expectedCurrency = String(process.env.PAYPAL_CURRENCY || '').toUpperCase();
    const expectedBaseMinor = decimalToMinor(paypalConfiguredAmount(plan, billing), expectedCurrency);
    const details = await paypalRequest(`/v1/billing/plans/${encodeURIComponent(configuredId)}`, 'GET');
    const cycles = Array.isArray(details.billing_cycles) ? details.billing_cycles : [];
    const cycle = cycles.find((item: any) => item.tenure_type === 'REGULAR');
    const trialCycle = cycles.find((item: any) => item.tenure_type === 'TRIAL');
    const actualAmount = cycle?.pricing_scheme?.fixed_price;
    const actualCurrency = String(actualAmount?.currency_code || '').toUpperCase();
    if (details.id !== configuredId || details.status !== 'ACTIVE'
        || !Array.isArray(details.billing_cycles) || details.billing_cycles.length !== (trial ? 2 : 1)
        || Boolean(trialCycle) !== trial
        || (trial && (trialCycle?.frequency?.interval_unit !== 'DAY'
            || Number(trialCycle?.frequency?.interval_count) !== TRIAL_DAYS
            || Number(trialCycle?.total_cycles) !== 1
            || Number(trialCycle?.pricing_scheme?.fixed_price?.value || 0) !== 0))
        || Number(details.payment_preferences?.setup_fee?.value || 0) !== 0
        || cycle?.frequency?.interval_unit !== 'MONTH' || Number(cycle?.frequency?.interval_count) !== 1
        || Number(cycle?.total_cycles) !== billingCycles('paypal', billing)
        || actualCurrency !== expectedCurrency || typeof actualAmount?.value !== 'string'
        || expectedBaseMinor <= 0
        || (expectedCurrency === 'INR' && expectedBaseMinor !== getPlanPrice(plan, billing)!.baseAmountMinor)
        || decimalToMinor(actualAmount.value, actualCurrency) !== expectedBaseMinor
        || String(details.taxes?.percentage) !== String(GST_PERCENT) || details.taxes?.inclusive !== false) {
        throw new Error('The PayPal plan must be active, monthly, match its configured amount, and add 18% GST.');
    }
    const taxMinor = Math.round(expectedBaseMinor * GST_PERCENT / 100);
    return {
        id: configuredId, currency: expectedCurrency,
        baseAmount: minorToDecimal(expectedBaseMinor, expectedCurrency),
        taxAmount: minorToDecimal(taxMinor, expectedCurrency),
        totalAmount: minorToDecimal(expectedBaseMinor + taxMinor, expectedCurrency),
    };
}

function makeReturnUrl(result: 'return' | 'cancel', plan: PlanKey, provider: Provider, checkoutId?: string, trial = false, billing: BillingPeriod = 'monthly') {
    const origin = process.env.PAYMENT_RETURN_URL || process.env.WEB_URL
        || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
    const base = new URL(origin);
    if (base.username || base.password || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) {
        throw new Error('Payment return URL must be an HTTPS URL without credentials in production.');
    }
    const url = new URL('/payment', base.origin);
    url.searchParams.set('plan', planName(plan));
    url.searchParams.set('billing', billing);
    url.searchParams.set('provider', provider);
    url.searchParams.set('result', result);
    if (checkoutId) url.searchParams.set('checkoutId', checkoutId);
    if (trial) url.searchParams.set('trial', '1');
    return url.toString();
}

function makeCashfreeReturnUrl(checkoutId: string, plan: PlanKey, trial: boolean, billing: BillingPeriod) {
    const apiOrigin = process.env.AUTH_PUBLIC_URL || process.env.VITE_AUTH_URL || 'http://localhost:4002';
    const base = new URL(apiOrigin);
    if (base.username || base.password || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) {
        throw new Error('Cashfree return URL must be an HTTPS URL without credentials in production.');
    }
    const url = new URL('/api/auth/billing/cashfree/return', base.origin);
    url.searchParams.set('checkoutId', checkoutId);
    url.searchParams.set('plan', planName(plan));
    url.searchParams.set('billing', billing);
    if (trial) url.searchParams.set('trial', '1');
    return url.toString();
}

function safeCompareHex(actual: string, expected: Buffer): boolean {
    if (!/^[a-f0-9]+$/i.test(actual)) return false;
    const supplied = Buffer.from(actual, 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function safeCompareBase64(actual: string, expected: Buffer): boolean {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(actual)) return false;
    const supplied = Buffer.from(actual, 'base64');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function razorpayWebhookValid(rawBody: Buffer, signature: string | undefined) {
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature) || !process.env.RAZORPAY_WEBHOOK_SECRET) return false;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest();
    return safeCompareHex(signature, expected);
}

async function paypalWebhookValid(req: Request, event: Record<string, any>): Promise<boolean> {
    if (!process.env.PAYPAL_WEBHOOK_ID || typeof event.id !== 'string') return false;
    const headers = {
        auth_algo: req.get('paypal-auth-algo'),
        cert_url: req.get('paypal-cert-url'),
        transmission_id: req.get('paypal-transmission-id'),
        transmission_sig: req.get('paypal-transmission-sig'),
        transmission_time: req.get('paypal-transmission-time'),
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
    };
    if (Object.values(headers).some(value => value == null || value === '')) return false;
    const result = await paypalRequest('/v1/notifications/verify-webhook-signature', 'POST', headers);
    return result.verification_status === 'SUCCESS';
}

function cashfreeWebhookValid(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined): boolean {
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET;
    if (!secret || !signature || !timestamp || !/^\d{10,13}$/.test(timestamp)) return false;
    // Cashfree may retry a valid webhook after an outage. The signed timestamp
    // authenticates the exact body; applyWebhook deduplicates its event hash.
    const expected = crypto.createHmac('sha256', secret).update(timestamp).update(rawBody).digest();
    return safeCompareBase64(signature, expected);
}

async function recordCapture(
    client: PoolClient,
    subscriptionId: string,
    provider: Provider,
    paymentId: string,
    amountMinor: number,
    currency: string,
) {
    const inserted = await client.query(
        `INSERT INTO public.payment_captures (subscription_id, provider, provider_payment_id, amount_minor, currency)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider, provider_payment_id) DO NOTHING`,
        [subscriptionId, provider, paymentId, amountMinor, currency],
    );
    return inserted.rowCount === 1;
}

async function applyWebhook(
    pool: Pool,
    provider: Provider,
    eventId: string,
    eventType: string,
    rawBody: Buffer,
    subscriptionId: string | null,
    paid: boolean,
    periodEnd: Date | null,
    paymentId: string | null,
    verifiedPlan: ProviderPlanSnapshot | null,
    verifiedCheckoutId: string | null,
    trialAuthorized = false,
    verifiedPaidAmountMinor: number | null = null,
    verifiedPaidCurrency: string | null = null,
    verifiedTrialEndsAt: Date | null = null,
) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO public.payment_webhook_events (provider, event_id, event_type, payload_sha256)
             VALUES ($1, $2, $3, $4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING event_id`,
            [provider, eventId, eventType.slice(0, 128), crypto.createHash('sha256').update(rawBody).digest('hex')],
        );
        if (inserted.rowCount !== 1) { await client.query('COMMIT'); return 'duplicate' as const; }

        const mapped = subscriptionId ? await client.query<BillingContext>(
            'SELECT * FROM public.qsvc_payment_subscription_context($1, $2)', [provider, subscriptionId],
        ) : { rows: [], rowCount: 0 };
        if (!mapped.rows.length) {
            await client.query("UPDATE public.payment_webhook_events SET result = 'ignored', processed_at = NOW() WHERE provider = $1 AND event_id = $2", [provider, eventId]);
            await client.query('COMMIT');
            return 'ignored' as const;
        }
        const context = mapped.rows[0];
        const trialDays = context.trial_days ?? 7;
        const expectedCycles = billingCycles(provider, context.billing_period ?? 'monthly');
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [context.tenant_id]);
        if (!paid && (context.status === 'failed' || (context.status === 'expired' && !context.current_period_end))) {
            if (trialAuthorized) await enqueueMandateCancellation(client, context);
            await client.query("UPDATE public.payment_webhook_events SET result = 'ignored', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2", [provider, eventId, context.tenant_id]);
            await client.query('COMMIT');
            return 'ignored' as const;
        }

        const storedCurrency = String(context.currency).toUpperCase();
        const storedAmountsValid = Number(context.tax_percent) === GST_PERCENT
            && decimalToMinor(context.base_amount, storedCurrency) + decimalToMinor(context.tax_amount, storedCurrency)
                === decimalToMinor(context.total_amount, storedCurrency);
        const providerPlanValid = Boolean(verifiedPlan)
            && verifiedPlan!.id === context.provider_plan_id
            && verifiedCheckoutId === context.id
            && verifiedPlan!.currency.toUpperCase() === storedCurrency
            && verifiedPlan!.intervalCount === 1
            && (provider === 'razorpay'
                ? verifiedPlan!.intervalUnit === 'monthly'
                    && verifiedPlan!.amountMinor === decimalToMinor(context.total_amount, storedCurrency)
                    && (trialDays === 7 || verifiedPlan!.totalCycles === expectedCycles)
                : provider === 'paypal' ? verifiedPlan!.intervalUnit === 'MONTH'
                    && verifiedPlan!.totalCycles === expectedCycles
                    && verifiedPlan!.hasTrial === context.trial_checkout
                    && (!context.trial_checkout || verifiedPlan!.trialDays === trialDays)
                    && Number(verifiedPlan!.taxPercent) === GST_PERCENT
                    && verifiedPlan!.taxInclusive === false
                    && Number(verifiedPlan!.setupFee || 0) === 0
                    && decimalToMinor(String(verifiedPlan!.amount), storedCurrency) === decimalToMinor(context.base_amount, storedCurrency)
                    : verifiedPlan!.intervalUnit === 'MONTH'
                        && verifiedPlan!.totalCycles === expectedCycles
                        && decimalToMinor(String(verifiedPlan!.amount), storedCurrency) === decimalToMinor(context.total_amount, storedCurrency));

        const paidAmountValid = paid && Boolean(paymentId?.trim()) && paymentId!.length <= 255
            && verifiedPaidAmountMinor !== null && verifiedPaidAmountMinor > 0 && verifiedPaidCurrency?.toUpperCase() === storedCurrency
            && verifiedPaidAmountMinor === decimalToMinor(context.total_amount, storedCurrency);
        if ((paid || trialAuthorized) && (!storedAmountsValid || !providerPlanValid || (paid && !paidAmountValid))) {
            await client.query("UPDATE public.payment_webhook_events SET result = 'ignored', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2", [provider, eventId, context.tenant_id]);
            await client.query('COMMIT');
            return 'ignored' as const;
        }

        const trialEndsAt = verifiedTrialEndsAt || context.trial_ends_at;
        if (trialAuthorized && context.trial_checkout && provider !== 'paypal'
            && (!verifiedTrialEndsAt || !context.trial_ends_at
                || verifiedTrialEndsAt.getTime() < context.trial_ends_at.getTime() - 1000)) {
            throw new Error('Provider trial charge date does not match the reserved free period');
        }
        if (trialAuthorized && !paid && context.trial_checkout && trialEndsAt
            && trialEndsAt.getTime() > Date.now()
            && trialEndsAt.getTime() <= Date.now() + (trialDays + 1) * 24 * 60 * 60 * 1000) {
            const trialPlan = `${context.plan}_trial`;
            const priorTrial = await client.query(
                `SELECT subscription_plan, trial_started_at, trial_ends_at FROM public.users
                 WHERE id = $1 AND tenant_id = $2 AND is_active FOR UPDATE`, [context.user_id, context.tenant_id],
            );
            const existingTrial = priorTrial.rows[0];
            const alreadyApplied = existingTrial?.subscription_plan === trialPlan
                && existingTrial?.trial_started_at && existingTrial?.trial_ends_at
                && new Date(existingTrial.trial_ends_at).getTime() === trialEndsAt.getTime();
            const userTrial = alreadyApplied ? { rowCount: 1 } : await client.query(
                `UPDATE public.users SET subscription_plan = $1, trial_started_at = NOW(),
                    trial_ends_at = $2, updated_at = NOW()
                 WHERE id = $3 AND tenant_id = $4 AND is_active
                   AND subscription_plan IS NULL AND trial_started_at IS NULL
                   AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = $4 AND t.is_active AND lower(t.plan) = 'free')
                 RETURNING id`,
                [trialPlan, trialEndsAt, context.user_id, context.tenant_id],
            );
            if (userTrial.rowCount === 1) {
                await client.query(
                    `UPDATE public.payment_subscriptions SET status = 'active', current_period_end = $3,
                        last_provider_payment_id = COALESCE($4, last_provider_payment_id), updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2 AND status IN ('creating', 'pending')`,
                    [context.id, context.tenant_id, trialEndsAt, paymentId],
                );
                await client.query(
                    "UPDATE public.payment_webhook_events SET result = 'processed', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2",
                    [provider, eventId, context.tenant_id],
                );
                await client.query('COMMIT');
                return 'processed' as const;
            }
            await client.query(
                `UPDATE public.payment_subscriptions SET status = 'failed', updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2 AND status IN ('creating', 'pending')`, [context.id, context.tenant_id],
            );
            await enqueueMandateCancellation(client, context);
            await client.query(
                "UPDATE public.payment_webhook_events SET result = 'ignored', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2",
                [provider, eventId, context.tenant_id],
            );
            await client.query('COMMIT');
            return 'ignored' as const;
        }

        if (paid) {
            if (!await recordCapture(client, context.id, provider, paymentId!, verifiedPaidAmountMinor!, storedCurrency)) {
                await client.query(
                    "UPDATE public.payment_webhook_events SET result = 'ignored', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2",
                    [provider, eventId, context.tenant_id],
                );
                await client.query('COMMIT');
                return 'duplicate' as const;
            }
            await client.query('SELECT id FROM public.users WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [context.user_id, context.tenant_id]);
            const otherSubscription = await client.query(
                `SELECT id FROM public.payment_subscriptions WHERE user_id = $1 AND tenant_id = $2 AND id <> $3
                 AND status IN ('creating', 'pending', 'active', 'past_due') LIMIT 1`, [context.user_id, context.tenant_id, context.id],
            );
            if (!periodEnd || periodEnd.getTime() <= Date.now() || otherSubscription.rows.length) {
                await client.query(`UPDATE public.payment_captures SET needs_review = true, review_reason = $3
                    WHERE provider = $1 AND provider_payment_id = $2`,
                    [provider, paymentId, otherSubscription.rows.length ? 'overlapping_subscription' : 'missing_current_period']);
                await client.query("UPDATE public.payment_webhook_events SET result = 'processed', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2", [provider, eventId, context.tenant_id]);
                await client.query('COMMIT');
                return 'processed' as const;
            }
            await client.query(
                `UPDATE public.payment_subscriptions SET status = CASE WHEN status IN ('cancelled', 'expired') THEN status ELSE 'active' END,
                    current_period_end = GREATEST(COALESCE(current_period_end, $3), $3),
                    last_provider_payment_id = COALESCE($4, last_provider_payment_id), updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
                [context.id, context.tenant_id, periodEnd, paymentId],
            );
            await client.query(
                `UPDATE public.users SET subscription_plan = $1, subscription_expires_at =
                    GREATEST(COALESCE(subscription_expires_at, $3), $3), updated_at = NOW()
                 WHERE id = $2 AND tenant_id = $4 AND is_active`,
                [context.plan, context.user_id, periodEnd, context.tenant_id],
            );
            await client.query(
                "UPDATE public.payment_webhook_events SET result = 'processed', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2",
                [provider, eventId, context.tenant_id],
            );
        } else {
            const nextStatus = eventType.endsWith('.cancelled') || eventType.endsWith('.CANCELLED')
                || eventType.endsWith('.CUSTOMER_CANCELLED')
                ? 'cancelled'
                : eventType.endsWith('.expired') || eventType.endsWith('.EXPIRED') || eventType.endsWith('.LINK_EXPIRED') || eventType.endsWith('.COMPLETED') ? 'expired'
                    : eventType.endsWith('.halted') || eventType.endsWith('.SUSPENDED') || eventType.endsWith('.PAYMENT.FAILED')
                        || eventType.endsWith('_PAYMENT_FAILED') || eventType.endsWith('.ON_HOLD') || eventType.endsWith('.CARD_EXPIRED') ? 'past_due'
                        : eventType.endsWith('_AUTH_FAILED') ? 'failed' : null;
            if (nextStatus) {
                await client.query(
                    `UPDATE public.payment_subscriptions SET status = $1, updated_at = NOW()
                     WHERE id = $2 AND tenant_id = $3 AND status <> 'expired'`,
                    [nextStatus, context.id, context.tenant_id],
                );
                if (nextStatus === 'failed') await enqueueMandateCancellation(client, context);
            }
            await client.query(
                "UPDATE public.payment_webhook_events SET result = 'processed', tenant_id = $3, processed_at = NOW() WHERE provider = $1 AND event_id = $2",
                [provider, eventId, context.tenant_id],
            );
        }
        await client.query('COMMIT');
        return 'processed' as const;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

export function billingRouter(pool: Pool, verifyToken: (token: string) => Promise<JwtPayload>, logger: Logger) {
    const router = express.Router();
    // Payment providers retry webhooks, so allow bursts while retaining a firm per-IP ceiling.
    router.use('/webhooks', rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
    const requireUser = async (req: Request, res: Response): Promise<BillingUser | null> => {
        const authorization = req.get('authorization');
        if (!authorization?.startsWith('Bearer ')) { res.status(401).json({ error: 'Sign in to manage a plan.' }); return null; }
        try {
            const user = await verifyToken(authorization.slice(7)) as BillingUser;
            if (!user.sub || !user.tenantId || !user.email) { res.status(401).json({ error: 'Sign in to manage a plan.' }); return null; }
            return user;
        } catch {
            res.status(401).json({ error: 'Your session has expired. Sign in again.' });
            return null;
        }
    };

    router.post('/trial/start', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        return res.status(410).json({
            code: 'TRIAL_REQUIRES_PAYMENT_AUTHORIZATION',
            error: 'Choose a plan and authorize a recurring payment method to start the 14-day trial. No plan fee is taken until the trial ends.',
        });
    });

    router.get('/options', (req, res) => {
        res.set('Cache-Control', 'no-store');
        const key = typeof req.query.plan === 'string' ? planKey(req.query.plan) : null;
        const billing = z.enum(['monthly', 'annual']).default('monthly').safeParse(req.query.billing);
        if (!key || !billing.success) return res.status(400).json({ error: 'Choose a paid plan and billing period.' });
        const options = publicOptions(key, billing.data);
        res.json(options);
    });

    router.get('/status', async (req, res) => {
        const user = await requireUser(req, res);
        if (!user) return;
        try {
            await inTenant(pool, user.tenantId, client => client.query(
                `UPDATE public.payment_subscriptions SET status = 'expired', updated_at = NOW()
                 WHERE tenant_id = $1 AND user_id = $2
                   AND (status = 'cancelled' OR (billing_mode = 'one_time' AND status = 'active'))
                   AND current_period_end IS NOT NULL AND current_period_end <= NOW()`, [user.tenantId, user.sub],
            ));
            const latest = await inTenant(pool, user.tenantId, client => client.query(
                `SELECT id, provider, plan, status, billing_mode AS "billingMode", current_period_end AS "currentPeriodEnd", currency,
                        base_amount AS "baseAmount", tax_amount AS "taxAmount", total_amount AS "totalAmount"
                 FROM public.payment_subscriptions WHERE tenant_id = $1 AND user_id = $2
                 ORDER BY created_at DESC LIMIT 1`, [user.tenantId, user.sub],
            ));
            res.set('Cache-Control', 'no-store').json(latest.rows[0] || null);
        } catch {
            res.status(503).json({ error: 'Payment status is temporarily unavailable.' });
        }
    });

    const checkoutHandler = async (req: Request, res: Response) => {
        const user = await requireUser(req, res);
        if (!user) return;
        const parsed = checkoutSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Choose a plan and payment channel, then accept the recurring payment terms.' });
        const plan = planKey(parsed.data.plan)!;
        const provider = parsed.data.provider;
        const { trial, billing } = parsed.data;
        const cycles = billingCycles(provider, billing);
        const option = publicOptions(plan, billing)?.providers[provider];
        const providerReady = option && (trial ? option.trialEnabled : option.enabled);
        if (!option || !providerReady) {
            const label = provider === 'cashfree' ? 'Cashfree UPI AutoPay' : provider === 'razorpay' ? 'Razorpay Subscriptions' : 'PayPal Subscriptions';
            return res.status(503).json({ error: `${label} is not configured for this billing option yet.` });
        }
        const quote = parsed.data.quote;
        if (quote && (quote.currency !== option.currency || Number(quote.totalAmount) !== Number(option.totalAmount))) {
            return res.status(409).json({ error: 'The payment price changed. Refresh checkout and confirm the new total.' });
        }
        let providerPlan: { id: string; currency: string; baseAmount: number | string; taxAmount: number | string; totalAmount: number | string };
        try {
            if (provider === 'razorpay') {
                providerPlan = await validateRazorpayPlan(plan, billing);
            } else if (provider === 'paypal') {
                providerPlan = await validatePayPalPlan(plan, billing, trial);
            } else {
                const price = getPlanPrice(plan, billing)!;
                providerPlan = { id: 'cashfree_periodic_monthly', currency: price.currency,
                    baseAmount: minorToDecimal(price.baseAmountMinor, price.currency),
                    taxAmount: minorToDecimal(price.taxAmountMinor, price.currency),
                    totalAmount: minorToDecimal(price.totalAmountMinor, price.currency) };
            }
        } catch (error) {
            logger.warn({ provider, plan, error: error instanceof Error ? error.message : 'plan validation error' }, 'Payment plan validation failed');
            return res.status(503).json({ error: 'This payment plan is not ready. Please contact support.' });
        }

        const subscriptionId = crypto.randomUUID();
        const checkoutExpiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
        // Reserve the authorization window so delayed approval still grants at least fourteen days.
        let trialEndsAt = trial ? new Date(checkoutExpiresAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000) : null;
        try {
            const attempt = await inTenant(pool, user.tenantId, async client => {
                const account = await client.query(
                    `SELECT u.email, u.phone_number, u.role, u.subscription_plan, u.trial_started_at, u.trial_ends_at, u.subscription_expires_at,
                            u.enterprise_status, t.plan AS tenant_plan
                     FROM public.users u JOIN public.tenants t ON t.id = u.tenant_id
                     WHERE u.id = $1 AND u.tenant_id = $2 AND u.is_active AND t.is_active FOR UPDATE OF u`, [user.sub, user.tenantId],
                );
                if (!account.rows.length) throw new Error('ACCOUNT_UNAVAILABLE');
                const row = account.rows[0];
                const role = effectiveRole(row.email, row.role);
                if (role === 'admin') throw new Error('ADMIN_ACCESS');
                if (provider === 'cashfree' && !/^\+91[6-9]\d{9}$/.test(String(row.phone_number || ''))) throw new Error('PHONE_REQUIRED');
                const current = getEntitlements({ ...row, role });
                if (current.status === 'paid_active' && PLAN_LEVEL[current.plan] >= PLAN_LEVEL[plan]) throw new Error('ALREADY_ENTITLED');
                if (trial && (row.trial_started_at || row.subscription_plan || String(row.tenant_plan).toLowerCase() !== 'free')) {
                    throw new Error('TRIAL_ALREADY_USED');
                }
                await client.query(
                    `UPDATE public.payment_subscriptions SET status = 'expired', updated_at = NOW()
                     WHERE tenant_id = $1 AND user_id = $2
                       AND (status = 'cancelled' OR (billing_mode = 'one_time' AND status = 'active'))
                       AND current_period_end IS NOT NULL AND current_period_end <= NOW()`, [user.tenantId, user.sub],
                );
                // PayPal approval links have no matching local expiry; reserve their slot until cancelled.
                await client.query(
                    `UPDATE public.payment_subscriptions SET status = 'failed', updated_at = NOW()
                     WHERE tenant_id = $1 AND user_id = $2 AND status IN ('creating', 'pending') AND checkout_expires_at <= NOW()
                       AND (provider <> 'paypal' OR status = 'creating')`,
                    [user.tenantId, user.sub],
                );
                const existingSubscription = await client.query(
                    `SELECT id, provider, plan, status, current_period_end, provider_subscription_id, provider_order_id,
                            provider_session_id, billing_mode, approval_url, trial_checkout, trial_ends_at, trial_days, billing_period, provider_plan_id, total_amount
                     FROM public.payment_subscriptions
                     WHERE tenant_id = $1 AND user_id = $2
                       AND (status IN ('creating', 'pending', 'active', 'past_due') OR (status = 'cancelled' AND current_period_end > NOW()))
                     ORDER BY created_at DESC LIMIT 1`, [user.tenantId, user.sub],
                );
                if (existingSubscription.rows.length) {
                    const existingRow = existingSubscription.rows[0];
                    const existingProviderReference = existingRow.provider_subscription_id;
                    if (existingRow.status === 'pending' && existingRow.provider === provider && existingRow.plan === plan
                        && existingRow.billing_period === billing && existingRow.trial_days === TRIAL_DAYS
                        && Number(existingRow.total_amount) === Number(providerPlan.totalAmount)
                        && (provider === 'cashfree' || existingRow.provider_plan_id === providerPlan.id)
                        && Boolean(existingRow.trial_checkout) === trial && existingProviderReference) {
                        trialEndsAt = existingRow.trial_ends_at;
                        return {
                            id: existingRow.id, email: row.email, phone: row.phone_number, reuse: true,
                            providerSubscriptionId: existingRow.provider_subscription_id,
                            providerSessionId: existingRow.provider_session_id,
                            approvalUrl: existingRow.approval_url,
                        };
                    }
                    throw new Error('EXISTING_SUBSCRIPTION');
                }
                await client.query(
                    `INSERT INTO public.payment_subscriptions
                        (id, tenant_id, user_id, provider, plan, provider_plan_id, billing_mode, currency,
                         base_amount, tax_percent, tax_amount, total_amount, status, checkout_expires_at,
                         trial_checkout, trial_ends_at, provider_subscription_id, trial_days, billing_period)
                     VALUES ($1, $2, $3, $4, $5, $6, 'subscription', $7, $8, $9, $10, $11, 'creating', $12, $13, $14, $15, $16, $17)`,
                    [subscriptionId, user.tenantId, user.sub, provider, plan, providerPlan.id,
                        providerPlan.currency, providerPlan.baseAmount, GST_PERCENT, providerPlan.taxAmount, providerPlan.totalAmount,
                        checkoutExpiresAt, trial, trialEndsAt,
                        provider === 'cashfree' ? subscriptionId : null, TRIAL_DAYS, billing],
                );
                return { id: subscriptionId, email: row.email, phone: row.phone_number, reuse: false, providerSubscriptionId: null, providerSessionId: null, approvalUrl: null };
            });

            if (provider === 'razorpay') {
                if (attempt.reuse) {
                    const price = getPlanPrice(plan, billing)!;
                    return res.json({ provider, subscription_id: attempt.providerSubscriptionId, keyId: process.env.RAZORPAY_KEY_ID,
                        email: attempt.email, plan: parsed.data.plan, amount: price.totalAmountMinor, currency: price.currency,
                        recurring: true, trialEndsAt: trialEndsAt?.toISOString() || null });
                }
                const price = getPlanPrice(plan, billing)!;
                const created = await razorpayRequest('/subscriptions', 'POST', {
                    plan_id: providerPlan.id,
                    total_count: cycles,
                    expire_by: Math.floor(checkoutExpiresAt.getTime() / 1000),
                    customer_notify: 1,
                    ...(trialEndsAt ? { start_at: Math.floor(trialEndsAt.getTime() / 1000) } : {}),
                    notes: { qsvc_checkout_id: attempt.id, plan, trial_days: trial ? String(TRIAL_DAYS) : '0' },
                });
                if (typeof created.id !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(created.id)
                    || created.plan_id !== providerPlan.id || !['created', 'authenticated', 'active'].includes(String(created.status))) {
                    throw new Error('Payment provider returned an invalid subscription');
                }
                await inTenant(pool, user.tenantId, client => client.query(
                    `UPDATE public.payment_subscriptions SET provider_subscription_id = $1, status = 'pending', updated_at = NOW()
                     WHERE id = $2 AND tenant_id = $3 AND user_id = $4 AND status = 'creating'`,
                    [created.id, attempt.id, user.tenantId, user.sub],
                ));
                return res.json({ provider, subscription_id: created.id, keyId: process.env.RAZORPAY_KEY_ID,
                    email: attempt.email, plan: parsed.data.plan, amount: price.totalAmountMinor, currency: price.currency,
                    recurring: true, trialEndsAt: trialEndsAt?.toISOString() || null });
            }

            if (provider === 'paypal') {
                if (attempt.reuse && typeof attempt.approvalUrl === 'string') return res.json({ provider, approvalUrl: attempt.approvalUrl, subscriptionId: attempt.providerSubscriptionId, email: attempt.email, plan: parsed.data.plan, recurring: true, trialEndsAt: trialEndsAt?.toISOString() || null });
                const created = await paypalRequest('/v1/billing/subscriptions', 'POST', {
                    plan_id: providerPlan.id,
                    custom_id: attempt.id,
                    subscriber: { email_address: attempt.email },
                    application_context: {
                        brand_name: 'QS-VC',
                        locale: 'en-US',
                        shipping_preference: 'NO_SHIPPING',
                        user_action: 'SUBSCRIBE_NOW',
                        payment_method: { payer_selected: 'PAYPAL', payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED' },
                        return_url: makeReturnUrl('return', plan, provider, attempt.id, trial, billing),
                        cancel_url: makeReturnUrl('cancel', plan, provider, attempt.id, trial, billing),
                    },
                }, attempt.id);
                const approval = Array.isArray(created.links) ? created.links.find((link: any) => link.rel === 'approve')?.href : null;
                if (typeof created.id !== 'string' || typeof approval !== 'string') throw new Error('Payment provider did not return an approval link');
                const approvalUrl = new URL(approval);
                if (approvalUrl.protocol !== 'https:' || !['www.paypal.com', 'www.sandbox.paypal.com'].includes(approvalUrl.hostname)) throw new Error('Unexpected payment approval URL');
                await inTenant(pool, user.tenantId, client => client.query(
                        `UPDATE public.payment_subscriptions SET provider_subscription_id = $1, approval_url = $2, status = 'pending', updated_at = NOW()
                         WHERE id = $3 AND tenant_id = $4 AND user_id = $5 AND status = 'creating'`,
                        [created.id, approvalUrl.toString(), attempt.id, user.tenantId, user.sub],
                ));
                return res.json({ provider, approvalUrl: approvalUrl.toString(), subscriptionId: created.id, email: attempt.email,
                    plan: parsed.data.plan, recurring: true, trialEndsAt: trialEndsAt?.toISOString() || null });
            }

            if (attempt.reuse && typeof attempt.providerSessionId === 'string') {
                return res.json({ provider, subscription_id: attempt.providerSubscriptionId, sessionId: attempt.providerSessionId,
                    mode: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox', email: attempt.email,
                    plan: parsed.data.plan, recurring: true, trialEndsAt: trialEndsAt?.toISOString() || null });
            }
            const price = getPlanPrice(plan, billing)!;
            const created = await cashfreeRequest('/subscriptions', 'POST', {
                subscription_id: attempt.id,
                customer_details: { customer_email: attempt.email, customer_phone: String(attempt.phone || '').replace(/^\+91/, '') },
                plan_details: {
                    plan_name: `QS-VC ${parsed.data.plan} ${billing}`, plan_type: 'PERIODIC',
                    plan_amount: Number(providerPlan.totalAmount), plan_max_amount: Number(providerPlan.totalAmount),
                    plan_max_cycles: cycles, plan_intervals: 1, plan_currency: price.currency,
                    plan_interval_type: 'MONTH', plan_note: billing === 'annual' ? 'Up to 12 monthly payments; cancel future renewals anytime.' : 'Renews monthly; cancel anytime.',
                },
                authorization_details: { payment_methods: ['upi', 'card'] },
                subscription_meta: {
                    return_url: makeCashfreeReturnUrl(attempt.id, plan, trial, billing),
                    notification_channel: ['EMAIL'],
                    session_id_expiry: checkoutExpiresAt.toISOString(),
                },
                subscription_expiry_time: new Date(Date.now() + (cycles * 31 + TRIAL_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
                ...(trialEndsAt ? { subscription_first_charge_time: trialEndsAt.toISOString() } : {}),
                subscription_tags: { qsvc_checkout_id: attempt.id, plan, trial_days: trial ? String(TRIAL_DAYS) : '0', psp_note: 'QS-VC monthly plan' },
            }, attempt.id);
            if (created.subscription_id !== attempt.id || typeof created.subscription_session_id !== 'string'
                || typeof created.plan_details?.plan_id !== 'string') {
                throw new Error('Cashfree returned an invalid subscription session');
            }
            await inTenant(pool, user.tenantId, client => client.query(
                `UPDATE public.payment_subscriptions SET provider_subscription_id = $1, provider_plan_id = $2,
                    provider_session_id = $3, status = 'pending', updated_at = NOW()
                 WHERE id = $4 AND tenant_id = $5 AND user_id = $6 AND status = 'creating'`,
                [created.subscription_id, created.plan_details.plan_id, created.subscription_session_id, attempt.id, user.tenantId, user.sub],
            ));
            res.json({ provider, subscription_id: created.subscription_id, sessionId: created.subscription_session_id,
                mode: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox', email: attempt.email,
                plan: parsed.data.plan, recurring: true, trialEndsAt: trialEndsAt?.toISOString() || null });
        } catch (error) {
            if (error instanceof Error && ['ADMIN_ACCESS', 'ALREADY_ENTITLED', 'EXISTING_SUBSCRIPTION', 'ACCOUNT_UNAVAILABLE', 'TRIAL_ALREADY_USED', 'PHONE_REQUIRED'].includes(error.message)) {
                const messages: Record<string, string> = {
                    ADMIN_ACCESS: 'Administrators already have full access.',
                    ALREADY_ENTITLED: 'Your account already has this plan or a higher plan.',
                    EXISTING_SUBSCRIPTION: 'A subscription is already pending or active for this account.',
                    ACCOUNT_UNAVAILABLE: 'This account is unavailable for checkout.',
                    TRIAL_ALREADY_USED: 'Your one free trial is not available for this account. You can continue with a paid plan.',
                    PHONE_REQUIRED: 'Add an Indian mobile number to your profile before authorizing UPI AutoPay or card billing.',
                };
                return res.status(error.message === 'ACCOUNT_UNAVAILABLE' ? 404 : 409).json({
                    code: error.message === 'TRIAL_ALREADY_USED' || error.message === 'PHONE_REQUIRED' ? error.message : undefined,
                    error: messages[error.message],
                });
            }
            await inTenant(pool, user.tenantId, client => client.query(
                `UPDATE public.payment_subscriptions SET status = 'failed', updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND status = 'creating'`, [subscriptionId, user.tenantId, user.sub],
            )).catch(() => undefined);
            logger.warn({ provider, plan, error: error instanceof Error ? error.message : 'checkout error' }, 'Payment checkout creation failed');
            res.status(502).json({ error: 'We could not start checkout. Please try again.' });
        }
    };
    router.post('/checkout', checkoutHandler);
    router.post('/razorpay/create-order', (req, res) => {
        req.body = { ...(req.body || {}), provider: 'razorpay' };
        return checkoutHandler(req, res);
    });

    router.post('/razorpay/verify-payment', async (req, res) => {
        const user = await requireUser(req, res);
        if (!user) return;
        if (!razorpayConfigured()) return res.status(503).json({ error: 'Razorpay checkout is not configured.' });
        const parsed = razorpayOrderVerifySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Payment ID, order ID, and signature are required.' });
        const { paymentId, orderId, signature } = parsed.data;
        try {
            const linked = await inTenant(pool, user.tenantId, client => client.query(
                `SELECT id, plan, billing_mode, currency, total_amount, status, checkout_expires_at,
                        current_period_end, last_provider_payment_id
                 FROM public.payment_subscriptions
                 WHERE tenant_id = $1 AND user_id = $2 AND provider = 'razorpay'
                   AND provider_order_id = $3 AND billing_mode = 'one_time'
                   AND status IN ('pending', 'active')`,
                [user.tenantId, user.sub, orderId],
            ));
            const checkout = linked.rows[0];
            if (!checkout) return res.status(404).json({ error: 'Order was not found for this account.' });
            const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
                .update(`${orderId}|${paymentId}`).digest();
            if (!safeCompareHex(signature, expectedSignature)) {
                return res.status(400).json({ error: 'Payment signature could not be verified.' });
            }
            if (checkout.status === 'active' && checkout.last_provider_payment_id === paymentId) {
                return res.json({ verified: true, status: 'active', currentPeriodEnd: checkout.current_period_end });
            }
            if (checkout.status !== 'pending' || new Date(checkout.checkout_expires_at).getTime() <= Date.now()) {
                return res.status(409).json({ error: 'This checkout has expired. Start a new payment.' });
            }

            const expectedAmount = decimalToMinor(String(checkout.total_amount), String(checkout.currency).toUpperCase());
            const matchesExpectedOrder = async (payment: Record<string, any>) => payment.id === paymentId
                && payment.order_id === orderId
                && Number(payment.amount) === expectedAmount
                && String(payment.currency).toUpperCase() === String(checkout.currency).toUpperCase();
            let payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, 'GET');
            if (!await matchesExpectedOrder(payment)) return res.status(400).json({ error: 'Payment details do not match this order.' });
            if (payment.status === 'authorized' && payment.captured !== true) {
                payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', {
                    amount: expectedAmount,
                    currency: String(checkout.currency).toUpperCase(),
                });
            }
            if (!await matchesExpectedOrder(payment) || (payment.status !== 'captured' && payment.captured !== true)) {
                return res.status(409).json({ error: 'Payment has not been captured. Your plan has not been activated.' });
            }

            const activated = await inTenant(pool, user.tenantId, async client => {
                const locked = await client.query(
                    `SELECT id, plan, status, checkout_expires_at, last_provider_payment_id
                     FROM public.payment_subscriptions
                     WHERE tenant_id = $1 AND user_id = $2 AND provider = 'razorpay'
                       AND provider_order_id = $3 AND billing_mode = 'one_time' FOR UPDATE`,
                    [user.tenantId, user.sub, orderId],
                );
                const current = locked.rows[0];
                if (!current) return null;
                if (current.status === 'active' && current.last_provider_payment_id === paymentId) {
                    return { currentPeriodEnd: checkout.current_period_end, alreadyActivated: true };
                }
                if (current.status !== 'pending' || new Date(current.checkout_expires_at).getTime() <= Date.now()) return null;
                const account = await client.query(
                    'SELECT id FROM public.users WHERE id = $1 AND tenant_id = $2 AND is_active FOR UPDATE',
                    [user.sub, user.tenantId],
                );
                if (!account.rowCount) return null;
                if (!await recordCapture(client, current.id, 'razorpay', paymentId, expectedAmount, String(checkout.currency).toUpperCase())) return null;
                const updated = await client.query(
                    `UPDATE public.payment_subscriptions SET status = 'active', last_provider_payment_id = $1,
                        current_period_end = NOW() + INTERVAL '30 days', updated_at = NOW()
                     WHERE id = $2 AND tenant_id = $3 AND user_id = $4 AND status = 'pending'
                     RETURNING current_period_end`,
                    [paymentId, current.id, user.tenantId, user.sub],
                );
                const currentPeriodEnd = updated.rows[0]?.current_period_end;
                if (!currentPeriodEnd) throw new Error('Verified order could not be activated');
                const userUpdate = await client.query(
                    `UPDATE public.users SET subscription_plan = $1,
                        subscription_expires_at = GREATEST(COALESCE(subscription_expires_at, $2), $2), updated_at = NOW()
                     WHERE id = $3 AND tenant_id = $4 AND is_active`,
                    [current.plan, currentPeriodEnd, user.sub, user.tenantId],
                );
                if (!userUpdate.rowCount) throw new Error('ACCOUNT_UNAVAILABLE');
                return { currentPeriodEnd, alreadyActivated: false };
            });
            if (!activated) return res.status(409).json({ error: 'This checkout is no longer available for activation.' });
            res.json({ verified: true, status: 'active', currentPeriodEnd: activated.currentPeriodEnd });
        } catch (error) {
            if (error instanceof Error && error.message === 'ACCOUNT_UNAVAILABLE') {
                return res.status(404).json({ error: 'This account is unavailable.' });
            }
            logger.warn({ userId: user.sub, error: error instanceof Error ? error.message : 'payment verification error' }, 'Razorpay order verification failed');
            res.status(502).json({ error: 'Payment confirmation is temporarily unavailable.' });
        }
    });

    router.post('/razorpay/verify', async (req, res) => {
        const user = await requireUser(req, res);
        if (!user) return;
        if (!razorpayConfigured() || !process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ error: 'Razorpay subscription verification is not configured.' });
        const parsed = razorpayVerifySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid payment confirmation.' });
        const { paymentId, subscriptionId, signature } = parsed.data;
        let linkedSubscriptionId: string | null = null;
        try {
            const linked = await inTenant(pool, user.tenantId, client => client.query(
                `SELECT provider_subscription_id FROM public.payment_subscriptions
                 WHERE tenant_id = $1 AND user_id = $2 AND provider = 'razorpay'
                   AND provider_subscription_id = $3 AND status IN ('pending', 'active')`,
                [user.tenantId, user.sub, subscriptionId],
            ));
            linkedSubscriptionId = linked.rows[0]?.provider_subscription_id || null;
        } catch {
            return res.status(503).json({ error: 'Payment confirmation is temporarily unavailable.' });
        }
        if (!linkedSubscriptionId) return res.status(404).json({ error: 'Subscription was not found for this account.' });
        const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
            .update(`${paymentId}|${linkedSubscriptionId}`).digest();
        if (!safeCompareHex(signature, expected)) return res.status(400).json({ error: 'Payment confirmation could not be verified.' });
        try {
            const result = await inTenant(pool, user.tenantId, client => client.query(
                `UPDATE public.payment_subscriptions SET last_provider_payment_id = $1, updated_at = NOW()
                 WHERE tenant_id = $2 AND user_id = $3 AND provider = 'razorpay'
                   AND provider_subscription_id = $4 AND status IN ('pending', 'active') RETURNING id`,
                [paymentId, user.tenantId, user.sub, subscriptionId],
            ));
            if (!result.rowCount) return res.status(404).json({ error: 'Subscription was not found for this account.' });
            res.json({ verified: true, activation: 'pending_webhook' });
        } catch {
            res.status(503).json({ error: 'Payment confirmation is temporarily unavailable.' });
        }
    });

    router.post('/cancel', async (req, res) => {
        const user = await requireUser(req, res);
        if (!user) return;
        const parsed = cancelSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid subscription.' });
        try {
            const existing = await inTenant(pool, user.tenantId, async client => {
                const result = await client.query(
                    `SELECT id, provider, provider_subscription_id, billing_mode, status, current_period_end,
                            trial_checkout AND NOT EXISTS (
                                SELECT 1 FROM public.payment_captures c WHERE c.subscription_id = payment_subscriptions.id
                            ) AS uncharged_trial
                     FROM public.payment_subscriptions WHERE id = $1 AND tenant_id = $2 AND user_id = $3 FOR UPDATE`,
                    [parsed.data.subscriptionId, user.tenantId, user.sub],
                );
                return result.rows[0] || null;
            });
            if (existing?.billing_mode === 'one_time') {
                return res.status(409).json({ error: 'This plan is a one-time purchase and does not renew.' });
            }
            if (!existing?.provider_subscription_id) return res.status(404).json({ error: 'Subscription was not found.' });
            if (['cancelled', 'expired', 'failed'].includes(existing.status)) return res.json({ cancelled: true, currentPeriodEnd: existing.current_period_end });
            if (existing.provider === 'razorpay') {
                await razorpayRequest(`/subscriptions/${encodeURIComponent(existing.provider_subscription_id)}/cancel`, 'POST', { cancel_at_cycle_end: existing.status === 'active' && !existing.uncharged_trial });
            } else if (existing.provider === 'paypal') {
                await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(existing.provider_subscription_id)}/cancel`, 'POST', { reason: 'Cancelled by the subscriber.' });
            } else {
                await cashfreeRequest(`/subscriptions/${encodeURIComponent(existing.provider_subscription_id)}/manage`, 'POST', {
                    subscription_id: existing.provider_subscription_id,
                    action: 'CANCEL',
                }, crypto.randomUUID());
            }
            const updated = await inTenant(pool, user.tenantId, client => client.query(
                `UPDATE public.payment_subscriptions SET status = 'cancelled', updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2 AND user_id = $3
                 RETURNING current_period_end AS "currentPeriodEnd"`, [existing.id, user.tenantId, user.sub],
            ));
            res.json({ cancelled: true, currentPeriodEnd: updated.rows[0]?.currentPeriodEnd || null });
        } catch (error) {
            logger.warn({ userId: user.sub, error: error instanceof Error ? error.message : 'cancel error' }, 'Payment cancellation failed');
            res.status(502).json({ error: 'We could not cancel this subscription. Please try again.' });
        }
    });

    router.post('/webhooks/razorpay', async (req, res) => {
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!rawBody || !razorpayWebhookValid(rawBody, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'Invalid webhook signature.' });
        let event: Record<string, any>;
        try { event = JSON.parse(rawBody.toString('utf8')); }
        catch { return res.status(400).json({ error: 'Invalid webhook payload.' }); }
        const eventId = req.get('x-razorpay-event-id');
        if (typeof event.event !== 'string' || !eventId || eventId.length > 255) return res.status(400).json({ error: 'Invalid webhook payload.' });
        try {
            const subscription = event.payload?.subscription?.entity;
            const payment = event.payload?.payment?.entity;
            const subscriptionId = typeof subscription?.id === 'string' ? subscription.id
                : typeof payment?.subscription_id === 'string' ? payment.subscription_id : null;
            const paid = event.event === 'subscription.charged' && Boolean(subscriptionId)
                && (payment?.status === 'captured' || payment?.captured === true);
            const trialAuthorizedEvent = ['subscription.authenticated', 'subscription.activated'].includes(event.event);
            let periodEnd: Date | null = null;
            let paymentId: string | null = typeof payment?.id === 'string' ? payment.id : null;
            let verifiedPlan: ProviderPlanSnapshot | null = null;
            let verifiedCheckoutId: string | null = null;
            let verifiedPaidAmountMinor: number | null = null;
            let verifiedPaidCurrency: string | null = null;
            let trialAuthorized = false;
            let verifiedTrialEndsAt: Date | null = null;
            if ((paid || trialAuthorizedEvent) && subscriptionId) {
                const verified = await razorpayRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET');
                verifiedCheckoutId = typeof verified.notes?.qsvc_checkout_id === 'string' ? verified.notes.qsvc_checkout_id : null;
                const verifiedPayment = paid && paymentId ? await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, 'GET') : null;
                const verifiedPlanDetails = typeof verified.plan_id === 'string'
                    ? await razorpayRequest(`/plans/${encodeURIComponent(verified.plan_id)}`, 'GET') : null;
                if (verifiedPlanDetails?.id && verifiedPlanDetails.item?.currency && verifiedPlanDetails.item?.amount != null) {
                    verifiedPlan = {
                        id: verifiedPlanDetails.id,
                        currency: verifiedPlanDetails.item.currency,
                        intervalUnit: verifiedPlanDetails.period,
                        intervalCount: Number(verifiedPlanDetails.interval),
                        amountMinor: Number(verifiedPlanDetails.item.amount),
                        totalCycles: Number(verified.total_count),
                    };
                }
                if (['active', 'completed'].includes(verified.status) && typeof verified.current_end === 'number') periodEnd = new Date(verified.current_end * 1000);
                if (paid) {
                    const paymentSubscriptionId = verifiedPayment?.subscription_id || payment?.subscription_id;
                    if (verifiedPayment?.id !== paymentId || verifiedPayment?.status !== 'captured' || paymentSubscriptionId !== subscriptionId
                        || verifiedPayment?.currency !== verifiedPlan?.currency
                        || !verifiedPlan || Number(verifiedPayment?.amount) !== verifiedPlan.amountMinor) {
                        periodEnd = null;
                    } else {
                        verifiedPaidAmountMinor = Number(verifiedPayment.amount);
                        verifiedPaidCurrency = String(verifiedPayment.currency);
                    }
                }
                if (verified.plan_id !== subscription?.plan_id && subscription?.plan_id) periodEnd = null;
                trialAuthorized = trialAuthorizedEvent && ['authenticated', 'active'].includes(String(verified.status))
                    && Boolean(verifiedCheckoutId) && typeof verifiedPlan?.id === 'string';
                if (trialAuthorized && typeof verified.start_at === 'number') verifiedTrialEndsAt = new Date(verified.start_at * 1000);
            }
            await applyWebhook(pool, 'razorpay', eventId, event.event, rawBody, subscriptionId, paid, periodEnd,
                paymentId, verifiedPlan, verifiedCheckoutId, trialAuthorized, verifiedPaidAmountMinor, verifiedPaidCurrency, verifiedTrialEndsAt);
            res.status(200).json({ received: true });
        } catch (error) {
            logger.error({ error: error instanceof Error ? error.message : 'webhook error' }, 'Razorpay webhook could not be processed');
            res.status(500).json({ error: 'Webhook processing failed.' });
        }
    });

    router.post('/webhooks/paypal', async (req, res) => {
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!rawBody) return res.status(400).json({ error: 'Invalid webhook payload.' });
        let event: Record<string, any>;
        try { event = JSON.parse(rawBody.toString('utf8')); }
        catch { return res.status(400).json({ error: 'Invalid webhook payload.' }); }
        try {
            if (!await paypalWebhookValid(req, event)) return res.status(400).json({ error: 'Invalid webhook signature.' });
            if (typeof event.id !== 'string' || typeof event.event_type !== 'string') return res.status(400).json({ error: 'Invalid webhook payload.' });
            const resource = event.resource || {};
            const subscriptionId = typeof resource.billing_agreement_id === 'string' ? resource.billing_agreement_id
                : typeof resource.id === 'string' && event.event_type.startsWith('BILLING.SUBSCRIPTION.') ? resource.id : null;
            const paid = event.event_type === 'PAYMENT.SALE.COMPLETED' && Boolean(subscriptionId);
            const trialAuthorizedEvent = event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED';
            let periodEnd: Date | null = null;
            let paymentId: string | null = typeof resource.id === 'string' && paid ? resource.id : null;
            let verifiedPlan: ProviderPlanSnapshot | null = null;
            let verifiedCheckoutId: string | null = null;
            let verifiedPaidAmountMinor: number | null = null;
            let verifiedPaidCurrency: string | null = null;
            let verifiedTrialEndsAt: Date | null = null;
            let trialAuthorized = false;
            if ((paid || trialAuthorizedEvent) && subscriptionId) {
                const verified = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET');
                verifiedCheckoutId = typeof verified.custom_id === 'string' ? verified.custom_id : null;
                const verifiedPlanDetails = typeof verified.plan_id === 'string'
                    ? await paypalRequest(`/v1/billing/plans/${encodeURIComponent(verified.plan_id)}`, 'GET') : null;
                const cycle = Array.isArray(verifiedPlanDetails?.billing_cycles)
                    ? verifiedPlanDetails.billing_cycles.find((item: any) => item.tenure_type === 'REGULAR') : null;
                const trialCycle = Array.isArray(verifiedPlanDetails?.billing_cycles)
                    ? verifiedPlanDetails.billing_cycles.find((item: any) => item.tenure_type === 'TRIAL') : null;
                const planAmount = cycle?.pricing_scheme?.fixed_price;
                if (verifiedPlanDetails?.id && planAmount?.currency_code && typeof planAmount.value === 'string') {
                    verifiedPlan = {
                        id: verifiedPlanDetails.id,
                        currency: planAmount.currency_code,
                        intervalUnit: cycle?.frequency?.interval_unit,
                        intervalCount: Number(cycle?.frequency?.interval_count),
                        totalCycles: Number(cycle?.total_cycles),
                        hasTrial: Boolean(trialCycle),
                        trialDays: trialCycle?.frequency?.interval_unit === 'DAY' && Number(trialCycle?.total_cycles) === 1
                            && Number(trialCycle?.pricing_scheme?.fixed_price?.value || 0) === 0
                            ? Number(trialCycle.frequency.interval_count) : undefined,
                        taxPercent: verifiedPlanDetails.taxes?.percentage,
                        taxInclusive: verifiedPlanDetails.taxes?.inclusive,
                        setupFee: verifiedPlanDetails.payment_preferences?.setup_fee?.value || 0,
                        amount: planAmount.value,
                    };
                }
                if (verified.status === 'ACTIVE' && typeof verified.plan_id === 'string'
                    && typeof verified.billing_info?.next_billing_time === 'string') {
                    periodEnd = new Date(verified.billing_info.next_billing_time);
                    if (Number.isNaN(periodEnd.getTime())) periodEnd = null;
                }
                if (paid && !periodEnd && verified.status === 'EXPIRED'
                    && verifiedPlan?.totalCycles === 12 && typeof resource.create_time === 'string') {
                    const paidAt = new Date(resource.create_time);
                    if (Number.isFinite(paidAt.getTime())) periodEnd = nextCalendarMonth(paidAt);
                }
                const saleAmount = resource.amount?.value ?? resource.amount?.total;
                const saleCurrency = resource.amount?.currency_code ?? resource.amount?.currency;
                const expectedSaleTotal = verifiedPlan && verifiedPlan.taxPercent != null
                    ? decimalToMinor(String(verifiedPlan.amount), verifiedPlan.currency)
                        + Math.round(decimalToMinor(String(verifiedPlan.amount), verifiedPlan.currency) * Number(verifiedPlan.taxPercent) / 100)
                    : null;
                if (!saleCurrency || saleAmount == null || !verifiedPlan
                    || String(saleCurrency).toUpperCase() !== verifiedPlan.currency.toUpperCase()
                    || expectedSaleTotal === null
                    || decimalToMinor(String(saleAmount), verifiedPlan.currency) !== expectedSaleTotal) periodEnd = null;
                else {
                    verifiedPaidAmountMinor = decimalToMinor(String(saleAmount), verifiedPlan.currency);
                    verifiedPaidCurrency = String(saleCurrency);
                }
                trialAuthorized = trialAuthorizedEvent && verified.status === 'ACTIVE' && Boolean(verifiedCheckoutId)
                    && Boolean(verifiedPlan?.hasTrial) && [7, TRIAL_DAYS].includes(verifiedPlan?.trialDays ?? 0);
                if (trialAuthorized && typeof verified.start_time === 'string') {
                    const trialStart = new Date(verified.start_time);
                    if (!Number.isNaN(trialStart.getTime())) verifiedTrialEndsAt = new Date(trialStart.getTime() + verifiedPlan!.trialDays! * 24 * 60 * 60 * 1000);
                }
            }
            await applyWebhook(pool, 'paypal', event.id, event.event_type, rawBody, subscriptionId, paid, periodEnd,
                paymentId, verifiedPlan, verifiedCheckoutId, trialAuthorized, verifiedPaidAmountMinor, verifiedPaidCurrency, verifiedTrialEndsAt);
            res.status(200).json({ received: true });
        } catch (error) {
            logger.error({ error: error instanceof Error ? error.message : 'webhook error' }, 'PayPal webhook could not be processed');
            res.status(500).json({ error: 'Webhook processing failed.' });
        }
    });

    router.post('/webhooks/cashfree', async (req, res) => {
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        const signature = req.get('x-webhook-signature');
        const timestamp = req.get('x-webhook-timestamp');
        if (!rawBody || !cashfreeWebhookValid(rawBody, signature, timestamp)) {
            return res.status(400).json({ error: 'Invalid webhook signature.' });
        }
        let event: Record<string, any>;
        try { event = JSON.parse(rawBody.toString('utf8')); }
        catch { return res.status(400).json({ error: 'Invalid webhook payload.' }); }
        if (typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') {
            return res.status(400).json({ error: 'Invalid webhook payload.' });
        }
        try {
            const data = event.data;
            const subscriptionId = typeof data.subscription_details?.subscription_id === 'string'
                ? data.subscription_details.subscription_id
                : typeof data.subscription_id === 'string' ? data.subscription_id : null;
            if (!subscriptionId) return res.status(200).json({ received: true });
            const verified = await cashfreeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET');
            if (verified.subscription_id !== subscriptionId) return res.status(200).json({ received: true });

            const details = verified.plan_details || {};
            const tags = verified.subscription_tags || data.subscription_details?.subscription_tags || {};
            const verifiedCheckoutId = typeof tags.qsvc_checkout_id === 'string' ? tags.qsvc_checkout_id : null;
            const amount = details.plan_recurring_amount ?? details.plan_amount;
            const verifiedPlan: ProviderPlanSnapshot | null = typeof details.plan_id === 'string'
                && typeof details.plan_currency === 'string' && amount != null
                ? {
                    id: details.plan_id,
                    currency: details.plan_currency,
                    intervalUnit: details.plan_interval_type,
                    intervalCount: Number(details.plan_intervals),
                    totalCycles: Number(details.plan_max_cycles),
                    hasTrial: false,
                    amount: String(amount),
                }
                : null;
            const authorization = verified.authorisation_details || verified.authorization_details || {};
            const authorizationStatus = String(authorization.authorization_status || authorization.authorizationStatus || '').toUpperCase();
            const subscriptionStatus = String(verified.subscription_status || '').toUpperCase();
            const authStatusEvent = event.type === 'SUBSCRIPTION_AUTH_STATUS';
            const authFailed = authStatusEvent && authorizationStatus !== 'ACTIVE'
                && ['FAILED', 'FAILURE', 'REJECTED'].includes(String(data.payment_status || '').toUpperCase());
            const trialAuthorized = authStatusEvent && authorizationStatus === 'ACTIVE'
                && subscriptionStatus === 'ACTIVE' && Boolean(verifiedCheckoutId);
            const paid = event.type === 'SUBSCRIPTION_PAYMENT_SUCCESS'
                && data.payment_type !== 'AUTH'
                && String(data.payment_status || '').toUpperCase() === 'SUCCESS';
            const paymentAmount = data.payment_amount;
            const paymentCurrency = typeof data.payment_currency === 'string' ? data.payment_currency.toUpperCase() : null;
            let verifiedPaidAmountMinor: number | null = null;
            if (paid && paymentCurrency && paymentAmount != null) {
                verifiedPaidAmountMinor = decimalToMinor(String(paymentAmount), paymentCurrency);
            }
            const nextCharge = verified.next_schedule_date;
            let periodEnd: Date | null = null;
            if (paid && typeof nextCharge === 'string') {
                const parsedEnd = cashfreeDate(nextCharge);
                if (parsedEnd && parsedEnd.getTime() > Date.now()) periodEnd = parsedEnd;
            }
            if (paid && !periodEnd && subscriptionStatus === 'COMPLETED' && verifiedPlan?.totalCycles === 12) {
                const paidAt = cashfreeDate(event.event_time);
                if (paidAt) periodEnd = nextCalendarMonth(paidAt);
            }
            const statusSuffix = event.type === 'SUBSCRIPTION_STATUS_CHANGED'
                ? `.${subscriptionStatus}`
                : authFailed ? '_AUTH_FAILED' : '';
            const eventId = crypto.createHash('sha256').update(rawBody).digest('hex');
            const paymentId = typeof data.payment_id === 'string' ? data.payment_id
                : typeof data.cf_payment_id === 'string' ? data.cf_payment_id : null;
            await applyWebhook(pool, 'cashfree', eventId, `${event.type}${statusSuffix}`, rawBody,
                subscriptionId, paid, periodEnd, paymentId, verifiedPlan, verifiedCheckoutId,
                trialAuthorized, verifiedPaidAmountMinor, paymentCurrency, cashfreeDate(verified.subscription_first_charge_time));
            res.status(200).json({ received: true });
        } catch (error) {
            logger.error({ error: error instanceof Error ? error.message : 'webhook error' }, 'Cashfree webhook could not be processed');
            res.status(500).json({ error: 'Webhook processing failed.' });
        }
    });

    router.post('/cashfree/return', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
        const checkout = z.string().uuid().safeParse(String(req.query.checkoutId || ''));
        const plan = z.enum(PAID_PLAN_NAMES).safeParse(req.query.plan);
        const billing = z.enum(['monthly', 'annual']).default('monthly').safeParse(req.query.billing);
        if (!checkout.success || !plan.success || !billing.success) return res.status(400).send('This checkout return link is invalid.');
        // The browser return is only a navigation signal. Mandate activation is verified by the signed webhook.
        const trial = req.query.trial === '1';
        return res.redirect(303, makeReturnUrl('return', planKey(plan.data)!, 'cashfree', checkout.data, trial, billing.data));
    });

    return router;
}
