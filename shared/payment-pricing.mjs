export const GST_PERCENT = 18;

export const PLAN_PRICES = Object.freeze({
    starter: Object.freeze({ baseAmountMinor: 49900, currency: 'INR' }),
    pro: Object.freeze({ baseAmountMinor: 99900, currency: 'INR' }),
});

export function getPlanPrice(plan) {
    const price = PLAN_PRICES[plan];
    if (!price) return null;
    const taxAmountMinor = Math.round((price.baseAmountMinor * GST_PERCENT) / 100);
    return Object.freeze({
        ...price,
        taxPercent: GST_PERCENT,
        taxAmountMinor,
        totalAmountMinor: price.baseAmountMinor + taxAmountMinor,
    });
}
