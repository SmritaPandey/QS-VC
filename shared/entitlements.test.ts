import { describe, expect, it } from 'vitest';
import { FEATURE_MIN_PLAN, getEntitlements, getPrivateConversationLimitMs, startTrial } from './entitlements.cjs';

const started = new Date('2026-11-01T12:00:00.000Z');

describe('plan entitlements and trial eligibility', () => {
    it('starts a new free account on a seven-day Starter trial when Starter is selected', () => {
        const user = startTrial({ tenant_plan: 'free' }, 'starter', started)!;
        expect(user).toMatchObject({ subscription_plan: 'starter_trial', trial_started_at: started.toISOString() });
        expect(user.trial_ends_at).toBe('2026-11-08T12:00:00.000Z');
        expect(getEntitlements(user, started)).toMatchObject({ plan: 'starter_trial', status: 'trial_active', trialUsed: true, features: ['meeting_scheduling', 'ai_captions', 'background_effects', 'ai_noise_suppression'] });
    });

    it('keeps trial access on day six', () => {
        const user = startTrial({ tenant_plan: 'free' }, 'starter', started)!;
        expect(getEntitlements(user, new Date('2026-11-07T12:00:00.000Z'))).toMatchObject({ plan: 'starter_trial', status: 'trial_active' });
    });

    it('expires exactly at the stored UTC end time', () => {
        const user = startTrial({ tenant_plan: 'free' }, 'starter', started)!;
        expect(getEntitlements(user, new Date(user.trial_ends_at))).toMatchObject({ plan: 'starter_trial', status: 'trial_expired', features: [] });
    });

    it('keeps expired trials expired after the end time', () => {
        const user = startTrial({ tenant_plan: 'free' }, 'starter', started)!;
        expect(getEntitlements(user, new Date('2026-11-09T12:00:00.000Z')).status).toBe('trial_expired');
    });

    it('keeps one explicitly chosen trial unchanged on later sign-ins', () => {
        const firstSignIn = startTrial({ tenant_plan: 'free' }, 'starter', started)!;
        const secondSignIn = startTrial(firstSignIn, 'starter', new Date('2026-11-05T12:00:00.000Z'));
        expect(secondSignIn).toBe(firstSignIn);
        expect(secondSignIn.trial_started_at).toBe(started.toISOString());
        expect(secondSignIn.trial_ends_at).toBe('2026-11-08T12:00:00.000Z');
    });

    it('does not start trials for paid or previously trialed accounts', () => {
        expect(startTrial({ tenant_plan: 'pro' }, 'starter', started)).toMatchObject({ tenant_plan: 'pro' });
        expect(startTrial({ tenant_plan: 'free', subscription_plan: 'starter_trial', trial_started_at: started.toISOString() }, 'pro', started)).toMatchObject({ trial_started_at: started.toISOString() });
    });

    it('starts the selected Pro trial once, grants Pro features, then expires at seven days', () => {
        const user = startTrial({ tenant_plan: 'free' }, 'pro', started)!;
        expect(user).toMatchObject({ subscription_plan: 'pro_trial', trial_ends_at: '2026-11-08T12:00:00.000Z' });
        expect(getEntitlements(user, started)).toMatchObject({ plan: 'pro_trial', status: 'trial_active', trialUsed: true, features: [...Object.keys(FEATURE_MIN_PLAN)] });
        expect(getEntitlements(user, new Date(user.trial_ends_at))).toMatchObject({ plan: 'pro_trial', status: 'trial_expired', features: [] });
    });

    it('assigns cloud recording to Pro while scheduling remains a Starter feature', () => {
        expect(FEATURE_MIN_PLAN).toEqual({ meeting_scheduling: 'starter', ai_captions: 'starter', background_effects: 'starter', ai_noise_suppression: 'starter', cloud_recording: 'pro' });
        expect(getEntitlements(null).featureMinimumPlans).toEqual(FEATURE_MIN_PLAN);
        expect(getEntitlements({ subscription_plan: 'starter_trial', trial_ends_at: '2026-11-08T12:00:00.000Z' }, started).features).toEqual(['meeting_scheduling', 'ai_captions', 'background_effects', 'ai_noise_suppression']);
        expect(getEntitlements({ subscription_plan: 'pro_trial', trial_ends_at: '2026-11-08T12:00:00.000Z' }, started).features).toEqual([...Object.keys(FEATURE_MIN_PLAN)]);
        expect(getEntitlements({ subscription_plan: 'pro' }, started).features).toEqual(['meeting_scheduling', 'ai_captions', 'background_effects', 'ai_noise_suppression', 'cloud_recording']);
    });

    it('grants admins every configured feature and unlimited private conversations regardless of plan', () => {
        const admin = { role: 'admin', tenant_plan: 'free' };
        expect(getEntitlements(admin, started).features).toEqual(Object.keys(FEATURE_MIN_PLAN));
        expect(getPrivateConversationLimitMs({ sub: 'admin-user', role: 'admin', plan: 'guest' })).toBeNull();
        expect(getEntitlements({ ...admin, subscription_plan: 'starter_trial', trial_ends_at: '2026-11-06T12:00:00.000Z' }, started).features)
            .toEqual(Object.keys(FEATURE_MIN_PLAN));
    });

    it('applies private conversation limits from the signed-in initiator entitlement', () => {
        expect(getPrivateConversationLimitMs(undefined)).toBe(0);
        expect(getPrivateConversationLimitMs({ sub: 'free-user', plan: 'guest', status: 'paid_active' })).toBe(120_000);
        expect(getPrivateConversationLimitMs({ sub: 'trial-user', plan: 'starter_trial', status: 'trial_active' })).toBe(1_800_000);
        expect(getPrivateConversationLimitMs({ sub: 'pro-trial-user', plan: 'pro_trial', status: 'trial_active' })).toBeNull();
        expect(getPrivateConversationLimitMs({ sub: 'expired-user', plan: 'starter_trial', status: 'trial_expired' })).toBe(120_000);
        expect(getPrivateConversationLimitMs({ sub: 'expired-pro-trial-user', plan: 'pro_trial', status: 'trial_expired' })).toBe(120_000);
        expect(getPrivateConversationLimitMs({ sub: 'starter-user', plan: 'starter', status: 'paid_active' })).toBe(1_800_000);
        expect(getPrivateConversationLimitMs({ sub: 'pro-user', plan: 'pro', status: 'paid_active' })).toBeNull();
        expect(getPrivateConversationLimitMs({ sub: 'enterprise-user', plan: 'enterprise', status: 'enterprise_approved' })).toBeNull();
        expect(getPrivateConversationLimitMs({ sub: 'pending-user', plan: 'enterprise', status: 'enterprise_pending' })).toBe(120_000);
    });
});
