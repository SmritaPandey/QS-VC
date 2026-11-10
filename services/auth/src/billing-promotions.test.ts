import { afterEach, expect, it, vi } from 'vitest';
import { processIntroTransitions } from './billing';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const job = { id: 'checkout', tenant_id: 'tenant', provider_subscription_id: 'subscription', provider_plan_id: 'intro',
    currency: 'INR', total_amount: '67.26', billing_period: 'monthly', intro_cycles: 3,
    regular_base_amount: '114.00', regular_tax_amount: '20.52', regular_total_amount: '134.52', regular_provider_plan_id: 'regular' };
const regular = { plan_id: 'regular', plan_currency: 'INR', plan_recurring_amount: 134.52,
    plan_interval_type: 'MONTH', plan_intervals: 1, plan_max_cycles: 97 };

it.each(['switch', 'already-switched', 'provider-failure', 'wrong-price', 'cancelled'])('retries the durable price transition safely: %s', async scenario => {
    vi.stubEnv('CASHFREE_CLIENT_ID', 'test-id'); vi.stubEnv('CASHFREE_CLIENT_SECRET', 'test-secret');
    const client = { query: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 })), release: vi.fn() };
    const pool = { query: vi.fn(async () => ({ rows: [job] })), connect: vi.fn(async () => client) };
    const logger = { error: vi.fn(), warn: vi.fn() };
    let switched = scenario === 'already-switched';
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (scenario === 'provider-failure') throw new Error('offline');
        if (String(url).endsWith('/plans/regular')) return Response.json(scenario === 'wrong-price' ? { ...regular, plan_recurring_amount: 999 } : regular);
        if (String(url).endsWith('/manage')) { switched = true; return Response.json({}); }
        return Response.json({ subscription_status: scenario === 'cancelled' ? 'CANCELLED' : 'ACTIVE',
            plan_details: switched ? regular : { plan_id: 'intro', plan_recurring_amount: 67.26 } });
    });
    vi.stubGlobal('fetch', fetch);
    await processIntroTransitions(pool as never, logger);
    const calls = fetch.mock.calls;
    expect(calls.some(([url]) => String(url).includes('/payments'))).toBe(false);
    expect(calls.filter(([url]) => String(url).endsWith('/manage'))).toHaveLength(scenario === 'switch' ? 1 : 0);
    if (scenario === 'switch') expect(JSON.parse(String(calls.find(([url]) => String(url).endsWith('/manage'))![1]?.body))).toEqual({
        subscription_id: 'subscription', action: 'CHANGE_PLAN', action_details: { plan_id: 'regular' },
    });
    const completed = client.query.mock.calls.some(([sql]) => String(sql).includes('price_transition_completed_at = NOW()'));
    expect(completed).toBe(['switch', 'already-switched'].includes(scenario));
    expect(logger.error).toHaveBeenCalledTimes(['provider-failure', 'wrong-price'].includes(scenario) ? 1 : 0);
});
