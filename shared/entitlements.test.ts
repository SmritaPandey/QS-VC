import { describe, expect, it } from 'vitest';
import { FEATURE_MIN_PLAN, getEntitlements, startTrial } from './entitlements.cjs';

const started = new Date('2026-11-01T12:00:00.000Z');

describe('plan entitlements and trial eligibility', () => {
    it('starts a new free account on a seven-day Starter trial', () => {
        const user = startTrial({ tenant_plan: 'free' }, started)!;
        expect(user).toMatchObject({ subscription_plan: 'starter_trial', trial_started_at: started.toISOString() });
        expect(user.trial_ends_at).toBe('2026-11-08T12:00:00.000Z');
        expect(getEntitlements(user, started)).toMatchObject({ plan: 'starter_trial', status: 'trial_active', features: ['meeting_scheduling'] });
    });

    it('keeps trial access on day six', () => {
        const user = startTrial({ tenant_plan: 'free' }, started)!;
        expect(getEntitlements(user, new Date('2026-11-07T12:00:00.000Z'))).toMatchObject({ plan: 'starter_trial', status: 'trial_active' });
    });

    it('expires exactly at the stored UTC end time', () => {
        const user = startTrial({ tenant_plan: 'free' }, started)!;
        expect(getEntitlements(user, new Date(user.trial_ends_at))).toMatchObject({ plan: 'starter_trial', status: 'trial_expired', features: [] });
    });

    it('keeps expired trials expired after the end time', () => {
        const user = startTrial({ tenant_plan: 'free' }, started)!;
        expect(getEntitlements(user, new Date('2026-11-09T12:00:00.000Z')).status).toBe('trial_expired');
    });

    it('starts an existing free account once and never extends it on another sign-in', () => {
        const firstSignIn = startTrial({ tenant_plan: 'free' }, started)!;
        const secondSignIn = startTrial(firstSignIn, new Date('2026-11-05T12:00:00.000Z'));
        expect(secondSignIn).toBe(firstSignIn);
        expect(secondSignIn.trial_started_at).toBe(started.toISOString());
        expect(secondSignIn.trial_ends_at).toBe('2026-11-08T12:00:00.000Z');
    });

    it('does not start trials for paid or previously trialed accounts', () => {
        expect(startTrial({ tenant_plan: 'pro' }, started)).toMatchObject({ tenant_plan: 'pro' });
        expect(startTrial({ tenant_plan: 'free', subscription_plan: 'starter_trial', trial_started_at: started.toISOString() }, started)).toMatchObject({ trial_started_at: started.toISOString() });
    });

    it('assigns cloud recording to Pro while scheduling remains a Starter feature', () => {
        expect(FEATURE_MIN_PLAN).toEqual({ meeting_scheduling: 'starter', cloud_recording: 'pro' });
        expect(getEntitlements(null).featureMinimumPlans).toEqual(FEATURE_MIN_PLAN);
        expect(getEntitlements({ subscription_plan: 'starter_trial', trial_ends_at: '2026-11-08T12:00:00.000Z' }, started).features).toEqual(['meeting_scheduling']);
        expect(getEntitlements({ subscription_plan: 'pro' }, started).features).toEqual(['meeting_scheduling', 'cloud_recording']);
    });
});
