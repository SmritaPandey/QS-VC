import { expect, it } from 'vitest';
import { getIntroPrice, getPlanPrice } from './payment-pricing.mjs';

it.each([
    ['basic', 'monthly', 5700, 1026, 6726, 3],
    ['basic', 'annual', 4750, 855, 5605, 3],
    ['pro', 'monthly', 95920, 17266, 113186, 1],
    ['pro', 'annual', 79920, 14386, 94306, 1],
] as const)('computes %s %s promotional charges with GST on the discounted amount', (plan, billing, baseAmountMinor, taxAmountMinor, totalAmountMinor, cycles) => {
    expect(getIntroPrice(plan, billing)).toMatchObject({ baseAmountMinor, taxAmountMinor, totalAmountMinor, cycles });
    expect(getPlanPrice(plan, billing)!.totalAmountMinor).toBeGreaterThan(totalAmountMinor);
});

it('leaves non-promotional plans and regular prices unchanged', () => {
    expect(getIntroPrice('starter')).toBeNull();
    expect(getIntroPrice('business')).toBeNull();
    expect(getPlanPrice('basic')).toMatchObject({ baseAmountMinor: 11400, totalAmountMinor: 13452 });
});
