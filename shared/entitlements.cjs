'use strict';

const PLAN_LEVEL = { guest: 0, starter_trial: 1, starter: 1, pro: 2, enterprise: 3 };

// Private side conversations are available only to signed-in people. The
// initiator's current entitlement determines the server-side session limit.
const PRIVATE_CONVERSATION_LIMIT_MS = Object.freeze({
    guest: 2 * 60 * 1000,
    starter_trial: 30 * 60 * 1000,
    starter: 30 * 60 * 1000,
    pro: null,
    enterprise: null,
});

// Populate only when a capability is formally assigned to a plan. Unknown features fail closed.
const FEATURE_MIN_PLAN = Object.freeze({
    meeting_scheduling: 'starter',
    ai_captions: 'starter',
    background_effects: 'starter',
    ai_noise_suppression: 'starter',
    cloud_recording: 'pro',
});

function can(user, feature) {
    const required = FEATURE_MIN_PLAN[feature];
    if (!required) return false;
    const plan = user?.plan || 'guest';
    if (plan === 'starter_trial' && user?.status === 'trial_expired') return false;
    if (plan === 'enterprise' && user?.status !== 'enterprise_approved') return false;
    return PLAN_LEVEL[plan] >= PLAN_LEVEL[required];
}

function resolvePlan(row, now = new Date()) {
    if (!row) return { plan: 'guest', status: 'paid_active' };
    if (row.subscription_plan === 'starter_trial' && row.trial_ends_at && new Date(row.trial_ends_at) <= now) return { plan: 'starter_trial', status: 'trial_expired' };
    if (row.subscription_plan === 'starter_trial' && row.trial_ends_at) return { plan: 'starter_trial', status: 'trial_active' };
    if (row.subscription_plan === 'starter') return { plan: 'starter', status: 'paid_active' };
    if (row.subscription_plan === 'pro') return { plan: 'pro', status: 'paid_active' };
    if (row.subscription_plan === 'enterprise') return { plan: 'enterprise', status: row.enterprise_status || 'enterprise_pending' };
    const tenantPlan = String(row.tenant_plan || '').toLowerCase();
    if (tenantPlan === 'enterprise') return { plan: 'enterprise', status: row.enterprise_status || 'enterprise_pending' };
    if (tenantPlan === 'pro') return { plan: 'pro', status: 'paid_active' };
    if (tenantPlan === 'starter') return { plan: 'starter', status: 'paid_active' };
    return { plan: 'guest', status: 'paid_active' };
}

function startTrial(user, now = new Date()) {
    if (!user || String(user.tenant_plan || '').toLowerCase() !== 'free'
        || user.subscription_plan || user.trial_started_at) return user;
    const start = new Date(now);
    return {
        ...user,
        subscription_plan: 'starter_trial',
        trial_started_at: start.toISOString(),
        trial_ends_at: new Date(start.getTime() + 7 * 86400000).toISOString(),
    };
}

function getEntitlements(user, now = new Date()) {
    const resolved = resolvePlan(user, now);
    return {
        ...resolved,
        trialEndsAt: user?.trial_ends_at ? new Date(user.trial_ends_at).toISOString() : null,
        features: Object.keys(FEATURE_MIN_PLAN).filter(feature => can(resolved, feature)),
        featureMinimumPlans: FEATURE_MIN_PLAN,
    };
}

function getPrivateConversationLimitMs(user) {
    if (!user?.sub) return 0;
    const plan = user.plan || 'guest';
    if (plan === 'starter_trial' && user.status === 'trial_expired') return PRIVATE_CONVERSATION_LIMIT_MS.guest;
    if (plan === 'enterprise' && user.status !== 'enterprise_approved') return PRIVATE_CONVERSATION_LIMIT_MS.guest;
    return Object.prototype.hasOwnProperty.call(PRIVATE_CONVERSATION_LIMIT_MS, plan)
        ? PRIVATE_CONVERSATION_LIMIT_MS[plan]
        : PRIVATE_CONVERSATION_LIMIT_MS.guest;
}

module.exports = { PLAN_LEVEL, FEATURE_MIN_PLAN, PRIVATE_CONVERSATION_LIMIT_MS, can, resolvePlan, startTrial, getEntitlements, getPrivateConversationLimitMs };
