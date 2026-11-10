import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SignedInWorkspace from './SignedInWorkspace';
import { useEntitlements } from '../lib/entitlements';

vi.mock('../lib/use-session', () => ({ useSession: () => ({
    status: 'authenticated', profile: { id: 'member', displayName: 'Team member', email: 'member@example.test', role: 'user' },
}) }));
vi.mock('../lib/entitlements', () => ({ useEntitlements: vi.fn(), hasFeature: vi.fn() }));
const render = () => renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(SignedInWorkspace, {
    creating: false, signingOut: false, sessionError: '', onCreate: vi.fn(), onSignOut: vi.fn(), onExpired: vi.fn(),
})));
const plan = { plan: 'pro', status: 'paid_active', trialEndsAt: null, trialUsed: true, features: [], featureMinimumPlans: {}, loading: false, verified: true, isPlatformAdmin: false } as const;

describe('meeting home account status', () => {
    it('shows the verified paid plan with a path to manage it', () => {
        vi.mocked(useEntitlements).mockReturnValue({ ...plan, features: [] });
        const html = render();
        expect(html).toContain('Pro plan');
        expect(html).toContain('Manage plan');
        expect(html).toContain('Your next meeting starts here.');
    });

    it('gives a new free member a choice of trial plans without showing an active trial', () => {
        vi.mocked(useEntitlements).mockReturnValue({ ...plan, plan: 'guest', trialUsed: false, features: [] });
        const html = render();
        expect(html).toContain('Free member');
        expect(html).toContain('Choose a trial plan');
        expect(html).not.toContain('class="trial-chip"');
    });

    it('offers retry instead of calling an unavailable plan Free', () => {
        vi.mocked(useEntitlements).mockReturnValue({ ...plan, plan: 'guest', features: [], verified: false });
        const html = render();
        expect(html).toContain('Plan unavailable');
        expect(html).toContain('meeting-home-plan-retry');
        expect(html).not.toContain('>Free<');
    });

    it('keeps administrator access visible through a plan lookup failure', () => {
        vi.mocked(useEntitlements).mockReturnValue({ ...plan, features: [], isPlatformAdmin: true, verified: false });
        expect(render()).toContain('Administrator');
        expect(render()).not.toContain('Plan unavailable');
    });

    it('shows a trial that ended without a zero-day active-trial chip', () => {
        vi.mocked(useEntitlements).mockReturnValue({ ...plan, features: [], plan: 'starter_trial', status: 'trial_expired', trialEndsAt: '2026-01-01T00:00:00Z' });
        const html = render();
        expect(html).toContain('Starter trial ended');
        expect(html).not.toContain('class="trial-chip"');
    });
});
