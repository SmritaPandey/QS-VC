export const GST_PERCENT = 18;
export const TRIAL_DAYS = 14;
export const PAID_PLAN_NAMES = Object.freeze(['Basic', 'Starter', 'Pro', 'Business']);
export const PLAN_PRICES = Object.freeze({
    basic: Object.freeze({ monthly: 11400, annual: 9500 }),
    starter: Object.freeze({ monthly: 30900, annual: 25700 }),
    pro: Object.freeze({ monthly: 119900, annual: 99900 }),
    business: Object.freeze({ monthly: 193800, annual: 161500 }),
});

export function getPlanPrice(plan, billing = 'monthly') {
    if (!Object.hasOwn(PLAN_PRICES, plan) || !['monthly', 'annual'].includes(billing)) return null;
    const baseAmountMinor = PLAN_PRICES[plan][billing];
    const taxAmountMinor = Math.round((baseAmountMinor * GST_PERCENT) / 100);
    return Object.freeze({
        baseAmountMinor,
        currency: 'INR',
        taxPercent: GST_PERCENT,
        taxAmountMinor,
        totalAmountMinor: baseAmountMinor + taxAmountMinor,
    });
}
