import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Entitlements } from '../../../../shared/entitlements.cjs';
import { AUTH_API, getToken } from './session';
import { useSession } from './use-session';

type ClientEntitlements = Entitlements & { privateConversationLimitSeconds?: number | null; loading: boolean; isPlatformAdmin: boolean };
const guest: ClientEntitlements = { plan: 'guest', status: 'paid_active', trialEndsAt: null, trialUsed: false, features: [], featureMinimumPlans: {}, loading: false, isPlatformAdmin: false };
const initial: ClientEntitlements = { ...guest, loading: true };
const EntitlementsContext = createContext<ClientEntitlements>(initial);

export function hasFeature(entitlements: Pick<ClientEntitlements, 'features' | 'isPlatformAdmin'>, feature: string) {
    return entitlements.isPlatformAdmin || entitlements.features.includes(feature);
}

export function EntitlementsProvider({ children }: { children: ReactNode }) {
    const session = useSession();
    const [value, setValue] = useState<ClientEntitlements>(initial);
    useEffect(() => {
        const originalFetch = window.fetch;
        const intercepted: typeof fetch = async (...args) => {
            const response = await originalFetch.apply(window, args);
            if (response.status === 403 && response.headers.get('content-type')?.includes('application/json')) {
                const result = await response.clone().json().catch(() => null);
                if (result?.code === 'UPGRADE_REQUIRED' && typeof result.requiredPlan === 'string') {
                    window.dispatchEvent(new CustomEvent('qsvc:upgrade-required', { detail: {
                        requiredPlan: result.requiredPlan,
                        ...(typeof result.feature === 'string' ? { feature: result.feature } : {}),
                    } }));
                }
            }
            return response;
        };
        window.fetch = intercepted;
        return () => { if (window.fetch === intercepted) window.fetch = originalFetch; };
    }, []);
    useEffect(() => {
        let active = true;
        const token = getToken();
        const isPlatformAdmin = session.status === 'authenticated' && session.profile?.role === 'admin';
        if (session.status !== 'authenticated' || !token) {
            setValue({ ...guest, loading: session.status === 'checking' });
            return () => { active = false; };
        }
        setValue(current => ({ ...current, isPlatformAdmin, loading: true }));
        const load = () => {
            fetch(`${AUTH_API}/api/auth/me/entitlements`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), cache: 'no-store' })
                .then(response => { if (!response.ok) throw new Error('Entitlements unavailable'); return response.json(); })
                .then(data => {
                    if (!['guest', 'starter_trial', 'starter', 'pro_trial', 'pro', 'enterprise'].includes(data.plan) || !Array.isArray(data.features)) throw new Error('Invalid entitlements');
                    const featureMinimumPlans = data.featureMinimumPlans && typeof data.featureMinimumPlans === 'object' && !Array.isArray(data.featureMinimumPlans)
                        ? data.featureMinimumPlans : {};
                    if (active) setValue({ plan: data.plan, status: data.status, trialEndsAt: data.trialEndsAt || null, trialUsed: data.trialUsed === true, features: data.features, featureMinimumPlans, privateConversationLimitSeconds: data.privateConversationLimitSeconds, loading: false, isPlatformAdmin });
                }).catch(() => { if (active) setValue({ ...guest, loading: false, isPlatformAdmin }); });
        };
        window.addEventListener('qsvc:entitlements-refresh', load);
        load();
        return () => { active = false; window.removeEventListener('qsvc:entitlements-refresh', load); };
    }, [session.status, session.profile?.id, session.profile?.role]);
    return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlements() { return useContext(EntitlementsContext); }
