export type PaidPlanKey = 'starter' | 'pro';
export interface PlanPrice {
    baseAmountMinor: number;
    currency: 'INR';
    taxPercent: 18;
    taxAmountMinor: number;
    totalAmountMinor: number;
}
export const GST_PERCENT: 18;
export const PLAN_PRICES: Readonly<Record<PaidPlanKey, Readonly<{ baseAmountMinor: number; currency: 'INR' }>>>;
export function getPlanPrice(plan: PaidPlanKey): PlanPrice | null;
