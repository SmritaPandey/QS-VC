'use strict';

const PLAN_LEVEL = Object.freeze(require('./plan-levels.json'));
const PAID_PLANS = ['basic', 'starter', 'pro', 'business'];

function isTrialPlan(plan) {
    return typeof plan === 'string' && plan.endsWith('_trial') && PAID_PLANS.includes(plan.slice(0, -6));
}

// Private side conversations are available only to signed-in people. The
// initiator's current entitlement determines the server-side session limit.
const PRIVATE_CONVERSATION_LIMIT_MS = Object.freeze({
    guest: 2 * 60 * 1000,
    basic_trial: 2 * 60 * 1000,
    basic: 2 * 60 * 1000,
    business_trial: null,
    business: null,
    starter_trial: 30 * 60 * 1000,
    starter: 30 * 60 * 1000,
    pro_trial: null,
    pro: null,
    enterprise: null,
});

// Populate only when a capability is formally assigned to a plan. Unknown features fail closed.
const FEATURE_MIN_PLAN = Object.freeze({
    meeting_scheduling: 'starter',
    ai_captions: 'starter',
    background_effects: 'basic',
    ai_noise_suppression: 'basic',
    cloud_recording: 'pro',
});

function can(user, feature) {
    const required = FEATURE_MIN_PLAN[feature];
    if (!required) return false;
    if (user?.role === 'admin') return true;
    if (user?.status === 'paid_expired') return false;
    const plan = user?.plan || 'guest';
    if (isTrialPlan(plan) && user?.status === 'trial_expired') return false;
    if (plan === 'enterprise' && user?.status !== 'enterprise_approved') return false;
    return PLAN_LEVEL[plan] >= PLAN_LEVEL[required];
}

function resolvePlan(row, now = new Date()) {
    if (!row) return { plan: 'guest', status: 'paid_active' };
    if (isTrialPlan(row.subscription_plan) && row.trial_ends_at && new Date(row.trial_ends_at) <= now) return { plan: row.subscription_plan, status: 'trial_expired' };
    if (isTrialPlan(row.subscription_plan) && row.trial_ends_at) return { plan: row.subscription_plan, status: 'trial_active' };
    if (PAID_PLANS.includes(row.subscription_plan)) return {
        plan: row.subscription_plan,
        status: row.subscription_expires_at && new Date(row.subscription_expires_at) <= now ? 'paid_expired' : 'paid_active',
    };
    if (row.subscription_plan === 'enterprise') return { plan: 'enterprise', status: row.enterprise_status || 'enterprise_pending' };
    const tenantPlan = String(row.tenant_plan || '').toLowerCase();
    if (tenantPlan === 'enterprise') return { plan: 'enterprise', status: row.enterprise_status || 'enterprise_pending' };
    if (PAID_PLANS.includes(tenantPlan)) return { plan: tenantPlan, status: 'paid_active' };
    return { plan: 'guest', status: 'paid_active' };
}

function startTrial(user, plan, now = new Date()) {
    if (!user || String(user.tenant_plan || '').toLowerCase() !== 'free'
        || user.subscription_plan || user.trial_started_at) return user;
    if (!PAID_PLANS.includes(plan)) return user;
    const start = new Date(now);
    return {
        ...user,
        subscription_plan: `${plan}_trial`,
        trial_started_at: start.toISOString(),
        trial_ends_at: new Date(start.getTime() + 14 * 86400000).toISOString(),
    };
}

function getEntitlements(user, now = new Date()) {
    const resolved = resolvePlan(user, now);
    return {
        ...resolved,
        trialEndsAt: user?.trial_ends_at ? new Date(user.trial_ends_at).toISOString() : null,
        trialUsed: Boolean(user?.trial_started_at),
        features: Object.keys(FEATURE_MIN_PLAN).filter(feature => can({ ...resolved, role: user?.role }, feature)),
        featureMinimumPlans: FEATURE_MIN_PLAN,
    };
}

function getPrivateConversationLimitMs(user) {
    if (!user?.sub) return 0;
    if (user.role === 'admin') return null;
    const plan = user.plan || 'guest';
    if (user.status === 'paid_expired') return PRIVATE_CONVERSATION_LIMIT_MS.guest;
    if (isTrialPlan(plan) && user.status === 'trial_expired') return PRIVATE_CONVERSATION_LIMIT_MS.guest;
    if (plan === 'enterprise' && user.status !== 'enterprise_approved') return PRIVATE_CONVERSATION_LIMIT_MS.guest;
    return Object.prototype.hasOwnProperty.call(PRIVATE_CONVERSATION_LIMIT_MS, plan)
        ? PRIVATE_CONVERSATION_LIMIT_MS[plan]
        : PRIVATE_CONVERSATION_LIMIT_MS.guest;
}

module.exports = { PLAN_LEVEL, FEATURE_MIN_PLAN, PRIVATE_CONVERSATION_LIMIT_MS, can, resolvePlan, startTrial, getEntitlements, getPrivateConversationLimitMs };
