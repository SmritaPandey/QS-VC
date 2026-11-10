export type PaidPlanKey = 'basic' | 'starter' | 'pro' | 'business';
export type BillingPeriod = 'monthly' | 'annual';
export interface PlanPrice {
    baseAmountMinor: number;
    currency: 'INR';
    taxPercent: 18;
    taxAmountMinor: number;
    totalAmountMinor: number;
}
export const GST_PERCENT: 18;
export const TRIAL_DAYS: 14;
export const PAID_PLAN_NAMES: readonly ['Basic', 'Starter', 'Pro', 'Business'];
export const PLAN_PRICES: Readonly<Record<PaidPlanKey, Readonly<Record<BillingPeriod, number>>>>;
export function getPlanPrice(plan: PaidPlanKey, billing?: BillingPeriod): PlanPrice | null;
export const PLAN_OFFERS: Readonly<Partial<Record<PaidPlanKey, Readonly<{ percent: number; cycles: number; label: string }>>>>;
export function getIntroPrice(plan: PaidPlanKey, billing?: BillingPeriod): (PlanPrice & { percent: number; cycles: number; label: string }) | null;
