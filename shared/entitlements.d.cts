export type Plan = 'guest' | 'starter_trial' | 'starter' | 'pro' | 'enterprise';
export type Status = 'trial_active' | 'trial_expired' | 'paid_active' | 'enterprise_pending' | 'enterprise_approved' | 'enterprise_rejected';
export type PaidPlan = 'guest' | 'starter' | 'pro' | 'enterprise';
export interface Entitlements {
    plan: Plan;
    status: Status;
    trialEndsAt: string | null;
    features: string[];
    featureMinimumPlans: Readonly<Record<string, PaidPlan>>;
}
export const PLAN_LEVEL: Record<Plan, number>;
export const FEATURE_MIN_PLAN: Readonly<Record<string, PaidPlan>>;
export function can(user: { plan?: Plan; status?: Status } | null | undefined, feature: string): boolean;
export function resolvePlan(row: { trial_ends_at?: string | Date | null; subscription_plan?: string | null; tenant_plan?: string | null; enterprise_status?: Status } | null, now?: Date): { plan: Plan; status: Status };
export function startTrial<T extends { tenant_plan?: string | null; subscription_plan?: string | null; trial_started_at?: string | Date | null }>(user: T | null, now?: Date): T | (T & { subscription_plan: 'starter_trial'; trial_started_at: string; trial_ends_at: string }) | null;
export function getEntitlements(user: { tenant_plan?: string | null; subscription_plan?: string | null; trial_started_at?: string | Date | null; trial_ends_at?: string | Date | null; enterprise_status?: Status } | null, now?: Date): Entitlements;
