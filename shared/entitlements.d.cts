export type Plan = 'guest' | 'starter_trial' | 'starter' | 'pro_trial' | 'pro' | 'enterprise';
export type Status = 'trial_active' | 'trial_expired' | 'paid_active' | 'paid_expired' | 'enterprise_pending' | 'enterprise_approved' | 'enterprise_rejected';
export type PaidPlan = 'guest' | 'starter' | 'pro' | 'enterprise';
export interface Entitlements {
    plan: Plan;
    status: Status;
    trialEndsAt: string | null;
    trialUsed: boolean;
    features: string[];
    featureMinimumPlans: Readonly<Record<string, PaidPlan>>;
    privateConversationLimitSeconds?: number | null;
}
export const PLAN_LEVEL: Record<Plan, number>;
export const PRIVATE_CONVERSATION_LIMIT_MS: Readonly<Record<Plan, number | null>>;
export const FEATURE_MIN_PLAN: Readonly<Record<string, PaidPlan>>;
export function can(user: { plan?: Plan; status?: Status; role?: string } | null | undefined, feature: string): boolean;
export function resolvePlan(row: { trial_ends_at?: string | Date | null; subscription_expires_at?: string | Date | null; subscription_plan?: string | null; tenant_plan?: string | null; enterprise_status?: Status } | null, now?: Date): { plan: Plan; status: Status };
export function startTrial<T extends { tenant_plan?: string | null; subscription_plan?: string | null; trial_started_at?: string | Date | null }>(user: T | null, plan: 'starter' | 'pro', now?: Date): T | (T & { subscription_plan: 'starter_trial' | 'pro_trial'; trial_started_at: string; trial_ends_at: string }) | null;
export function getEntitlements(user: { tenant_plan?: string | null; subscription_plan?: string | null; trial_started_at?: string | Date | null; trial_ends_at?: string | Date | null; subscription_expires_at?: string | Date | null; enterprise_status?: Status; role?: string } | null, now?: Date): Entitlements;
export function getPrivateConversationLimitMs(user: { sub?: string; plan?: Plan; status?: Status; role?: string } | null | undefined): number | null;
