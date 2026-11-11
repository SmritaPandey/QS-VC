import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import CurrencyRateSelector from '../components/CurrencyRateSelector';
import PLAN_LEVEL from '../../../../shared/plan-levels.json';
import { TRIAL_DAYS, type PaidPlanKey } from '../../../../shared/payment-pricing.mjs';
import { plans } from './PricingPage';
import { AUTH_API, getToken, refreshSession } from '../lib/session';
import { useSession } from '../lib/use-session';
import { useEntitlements } from '../lib/entitlements';
import { useCurrencyRates, type DisplayCurrency } from '../lib/currency-rates';
import '../styles/payment.css';

type Gateway = 'razorpay' | 'paypal' | 'cashfree';
type GatewayOption = { enabled: boolean; trialEnabled: boolean; mode?: 'live' | 'test' | 'unknown'; maxBillingCycles?: number | null; currency: string; baseAmount: string; taxAmount: string; totalAmount: string;
    promotion?: { percent: number; cycles: number; regularBaseAmount: string; regularTotalAmount: string } | null };
type Options = { billing?: 'monthly' | 'annual'; paymentsEnabled: boolean; taxPercent: number; trialDays: number; providers: Record<Gateway, GatewayOption> };
type PaymentStatus = {
    id: string;
    plan: PaidPlanKey;
    status: string;
    billingMode: 'subscription' | 'one_time';
    currentPeriodEnd: string | null;
    provider?: Gateway;
    currency?: string;
    totalAmount?: string;
    replacesSubscriptionId?: string | null;
} | null;
type CheckoutResult = {
    provider: Gateway;
    subscription_id?: string;
    keyId?: string;
    email?: string;
    recurring?: boolean;
    approvalUrl?: string;
    sessionId?: string;
    mode?: 'sandbox' | 'production';
};
type EntitlementSnapshot = { plan?: string; status?: string; trialEndsAt?: string | null };

declare global {
    interface Window {
        Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, callback: (value: Record<string, unknown>) => void) => void };
        Cashfree?: (input: { mode: 'sandbox' | 'production' }) => {
            subscriptionsCheckout: (options: { subsSessionId: string; redirectTarget: '_self' }) => Promise<unknown> | unknown;
        };
    }
}

const GATEWAYS: Gateway[] = ['cashfree', 'razorpay', 'paypal'];
const DEFAULT_PROVIDER: GatewayOption = { enabled: false, trialEnabled: false, currency: '', baseAmount: '', taxAmount: '', totalAmount: '' };
const OPTIONS_UNAVAILABLE = 'We couldn’t load payment options. Please try again.';

class CheckoutError extends Error {}

function formatMoney(amount: string | number, currency: string) {
    const number = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(number)) return '—';
    try { return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(number); }
    catch { return `${currency} ${number.toFixed(2)}`; }
}

function formatDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date) : '';
}

function planLabel(plan?: string) {
    const key = plan?.replace(/_trial$/, '');
    return plans.find(item => item.key === key)?.name ?? 'another';
}

function renewalTerms(maxBillingCycles?: number | null) {
    if (maxBillingCycles === null) return 'Renews monthly until you cancel.';
    if (typeof maxBillingCycles === 'number' && Number.isSafeInteger(maxBillingCycles) && maxBillingCycles > 0) return `Renews monthly for up to ${maxBillingCycles} billing cycles. You can cancel anytime.`;
    return '';
}

function convertDisplayAmount(amount: string, from: string, to: DisplayCurrency, rates: Partial<Record<DisplayCurrency, number>>) {
    const parsed = Number(amount);
    const fromCode = from as DisplayCurrency;
    const fromRate = from === 'INR' ? 1 : rates[fromCode];
    const toRate = to === 'INR' ? 1 : rates[to];
    if (!Number.isFinite(parsed) || !fromRate || !toRate) return '';
    try { return new Intl.NumberFormat(to === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency: to }).format(parsed / fromRate * toRate); }
    catch { return ''; }
}

function loadProviderScript(name: 'razorpay' | 'cashfree'): Promise<boolean> {
    const isLoaded = () => name === 'razorpay' ? Boolean(window.Razorpay) : Boolean(window.Cashfree);
    if (isLoaded()) return Promise.resolve(true);
    return new Promise(resolve => {
        let timeout = 0;
        let settled = false;
        const finish = (loaded: boolean) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve(loaded);
        };
        timeout = window.setTimeout(() => finish(isLoaded()), 12000);
        const attribute = `data-qsvc-${name}`;
        const existing = document.querySelector<HTMLScriptElement>(`script[${attribute}]`);
        if (existing) {
            existing.addEventListener('load', () => finish(isLoaded()), { once: true });
            existing.addEventListener('error', () => finish(false), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = name === 'razorpay'
            ? 'https://checkout.razorpay.com/v1/checkout.js'
            : 'https://sdk.cashfree.com/js/v3/cashfree.js';
        script.async = true;
        script.setAttribute(attribute, 'true');
        script.onload = () => finish(isLoaded());
        script.onerror = () => finish(false);
        document.head.appendChild(script);
    });
}

function gatewayName(gateway: Gateway) {
    return gateway === 'razorpay' ? 'Razorpay' : gateway === 'cashfree' ? 'Cashfree UPI AutoPay' : 'PayPal';
}

export async function openCashfreeSubscription(sessionId?: string, mode?: 'sandbox' | 'production') {
    if (!sessionId?.trim() || (mode !== 'sandbox' && mode !== 'production')) throw new CheckoutError('We couldn’t open Cashfree. Try again or choose another payment option.');
    const loaded = await loadProviderScript('cashfree');
    if (!loaded || !window.Cashfree) throw new CheckoutError('We couldn’t open Cashfree. Check your connection and try again.');
    const cashfree = window.Cashfree({ mode });
    if (typeof cashfree.subscriptionsCheckout !== 'function') throw new CheckoutError('Cashfree could not load. Refresh this page and try again.');
    const result = await cashfree.subscriptionsCheckout({ subsSessionId: sessionId, redirectTarget: '_self' });
    if (result && typeof result === 'object' && 'error' in result && result.error) throw new CheckoutError('We couldn’t open Cashfree. Please try again.');
}

function gatewayDescription(gateway: Gateway) {
    if (gateway === 'razorpay') return 'Recurring monthly payments using UPI AutoPay, cards or other methods supported for your account.';
    if (gateway === 'cashfree') return 'Cashfree UPI AutoPay, including BHIM where supported, and cards.';
    return 'Review and approve monthly payments on PayPal.';
}

export function PaymentProviderChoices({ selected, available, providers, loading, disabled, onSelect }: {
    selected: Gateway;
    available: Gateway[];
    providers: Options['providers'];
    loading: boolean;
    disabled: boolean;
    onSelect: (gateway: Gateway) => void;
}) {
    return <fieldset className="payment-provider-list" disabled={disabled}>
        <legend className="sr-only">Recurring payment provider</legend>
        {GATEWAYS.map(item => {
            const ready = available.includes(item);
            const selectedReady = ready && selected === item;
            const unavailable = !loading && !ready;
            const mode = providers[item]?.mode;
            const status = loading ? 'Checking…' : !ready
                ? item === 'razorpay' && mode === 'test' ? 'Test mode · Unavailable' : 'Unavailable'
                : mode === 'test' ? 'Test mode' : mode === 'live' ? 'Live' : 'Available';
            return <label key={item} className={`payment-gateway${selectedReady ? ' is-selected' : ''}${unavailable ? ' is-unavailable' : ''}`}>
                <input type="radio" name="gateway" value={item} checked={selectedReady} disabled={!ready}
                    aria-describedby={`payment-provider-status-${item}`} onChange={() => onSelect(item)} />
                <span className="payment-gateway-copy">
                    <span className="payment-gateway-heading"><strong>{gatewayName(item)}</strong><span id={`payment-provider-status-${item}`} className={`payment-mode-badge${ready && mode === 'test' ? ' payment-mode-badge--test' : ''}`}>{status}</span></span>
                    <small>{gatewayDescription(item)}</small>
                </span>
                <span className="mi payment-provider-check" aria-hidden="true">{unavailable ? 'lock' : loading ? 'schedule' : selectedReady ? 'check_circle' : 'radio_button_unchecked'}</span>
            </label>;
        })}
    </fieldset>;
}

function normalizeProvider(option?: GatewayOption): GatewayOption {
    if (!option || typeof option.currency !== 'string' || !/^[A-Z]{3}$/.test(option.currency)
        || ![option.baseAmount, option.taxAmount, option.totalAmount].every(amount =>
            typeof amount === 'string' && /^\d+(?:\.\d+)?$/.test(amount) && Number.isFinite(Number(amount)))
        || Number(option.totalAmount) <= 0) return DEFAULT_PROVIDER;
    if (option.promotion && (!Number.isInteger(option.promotion.cycles) || option.promotion.cycles < 1 || option.promotion.cycles > 12
        || !Number.isInteger(option.promotion.percent) || option.promotion.percent <= 0 || option.promotion.percent >= 100
        || ![option.promotion.regularBaseAmount, option.promotion.regularTotalAmount].every(value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))
        || Number(option.promotion.regularTotalAmount) < Number(option.totalAmount))) return DEFAULT_PROVIDER;
    return { ...option, enabled: option.enabled === true, trialEnabled: option.trialEnabled === true,
        mode: option.mode === 'live' || option.mode === 'test' ? option.mode : 'unknown' };
}

async function responseJson(response: Response) {
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function checkoutError(status: number, body: Record<string, unknown> | null) {
    if (status === 401) return 'Your session has expired. Sign in again to continue.';
    if (status === 409) {
        if (body?.code === 'PHONE_REQUIRED') return 'Add a valid Indian mobile number to continue.';
        if (body?.code === 'TRIAL_ALREADY_USED') return 'This account has already used its free trial. You can choose a paid plan.';
        if (body?.error === 'The payment price changed. Refresh checkout and confirm the new total.') {
            return 'The price changed. Refresh checkout and review the new total.';
        }
        return 'Check your current plan or pending subscription before trying again.';
    }
    return 'We couldn’t open checkout. Please try again.';
}

export default function PaymentPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const currencyRates = useCurrencyRates();
    const requestedPlan = params.get('plan');
    const requestedBilling = params.get('billing');
    const billing = requestedBilling === 'annual' ? 'annual' : 'monthly';
    const billingQuery = billing === 'annual' ? '&billing=annual' : '';
    const pricingHref = billing === 'annual' ? '/pricing?billing=annual' : '/pricing';
    const isTrialIntent = params.get('trial') === '1';
    const isProviderReturn = params.get('result') === 'return';
    const isProviderCancel = params.get('result') === 'cancel';
    const plan = !requestedBilling || ['monthly', 'annual'].includes(requestedBilling)
        ? plans.find(item => item.name === requestedPlan)
        : undefined;
    const planKey = plan?.key;
    const [gateway, setGateway] = useState<Gateway>('cashfree');
    const [options, setOptions] = useState<Options>({
        paymentsEnabled: false,
        taxPercent: 18,
        trialDays: TRIAL_DAYS,
        providers: { razorpay: { ...DEFAULT_PROVIDER, currency: 'INR' }, paypal: { ...DEFAULT_PROVIDER }, cashfree: { ...DEFAULT_PROVIDER, currency: 'INR' } },
    });
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    const [optionsError, setOptionsError] = useState(false);
    const [optionsAttempt, setOptionsAttempt] = useState(0);
    const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(null);
    const [paymentStatusReady, setPaymentStatusReady] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [consent, setConsent] = useState(false);
    const [trialRedirectNotice, setTrialRedirectNotice] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const session = useSession();
    const entitlements = useEntitlements();
    const token = getToken();
    const isAdmin = entitlements.isPlatformAdmin || session.profile?.role === 'admin';

    const trialConsumed = entitlements.trialUsed
        || entitlements.status === 'trial_active'
        || entitlements.status === 'trial_expired'
        || entitlements.status === 'paid_expired'
        || (entitlements.status === 'paid_active' && entitlements.plan !== 'guest');
    const trialEligible = !isAdmin && entitlements.verified && entitlements.plan === 'guest' && !trialConsumed;
    const showTrialFlow = isTrialIntent && !trialRedirectNotice;
    const isTrialCheckout = showTrialFlow && trialEligible && session.status === 'authenticated' && !entitlements.loading;
    const isAuthReady = Boolean(token) && session.status === 'authenticated';
    const storedIndianMobile = /^\+91[6-9]\d{9}$/.test(session.profile?.phoneNumber || '');
    const needsIndianMobile = gateway === 'cashfree' && !storedIndianMobile;

    const enabledGateways = useMemo(() => optionsLoaded && options.paymentsEnabled
        ? GATEWAYS.filter(item => options.providers[item]?.enabled)
        : [], [options, optionsLoaded]);
    const checkoutGateways = showTrialFlow
        ? GATEWAYS.filter(item => optionsLoaded && options.paymentsEnabled && options.providers[item]?.trialEnabled)
        : enabledGateways;
    const providerPrice = options.providers[gateway];
    const gatewayReady = showTrialFlow ? providerPrice?.trialEnabled : providerPrice?.enabled;
    const priceReady = Boolean(optionsLoaded && providerPrice?.baseAmount && providerPrice?.taxAmount && providerPrice?.totalAmount && providerPrice?.currency);
    const pendingPriceChanged = Boolean(priceReady && paymentStatus?.status === 'pending' && paymentStatus.plan === planKey
        && paymentStatus.provider === gateway && paymentStatus.currency === providerPrice.currency && paymentStatus.totalAmount
        && Number(paymentStatus.totalAmount) !== Number(providerPrice.totalAmount));
    const totalAmountDisplay = priceReady
        ? convertDisplayAmount(providerPrice.totalAmount, providerPrice.currency, currencyRates.displayCurrency, currencyRates.rates)
        : '';
    const planEntitled = planKey && entitlements.status === 'paid_active' && PLAN_LEVEL[entitlements.plan] >= PLAN_LEVEL[planKey];
    const statusCoversPlan = planKey && paymentStatus?.status === 'active' && PLAN_LEVEL[paymentStatus.plan] >= PLAN_LEVEL[planKey];
    const isCurrentPlan = planEntitled || statusCoversPlan;
    const subscriptionOpen = paymentStatus
        && (['creating', 'active', 'pending', 'past_due'].includes(paymentStatus.status)
            || (paymentStatus.status === 'cancelled' && Boolean(paymentStatus.currentPeriodEnd)
                && new Date(paymentStatus.currentPeriodEnd!).getTime() > Date.now()));
    const upgradesCurrentPlan = Boolean(planKey && subscriptionOpen && PLAN_LEVEL[paymentStatus.plan] < PLAN_LEVEL[planKey]
        && ['active', 'past_due', 'cancelled'].includes(paymentStatus.status));
    const upgradeFrom = upgradesCurrentPlan ? paymentStatus?.id
        : paymentStatus?.plan === planKey ? paymentStatus?.replacesSubscriptionId : undefined;
    const isUpgrade = Boolean(upgradeFrom);
    const blockPlanChange = Boolean(pendingPriceChanged || planKey && subscriptionOpen && !isUpgrade && !isCurrentPlan
        && (paymentStatus.plan !== planKey || paymentStatus.status !== 'pending'));
    const renewalTermCopy = billing === 'annual' && providerPrice?.maxBillingCycles === 12
        ? 'Up to 12 monthly payments. You can cancel future renewals anytime.'
        : billing === 'monthly' ? renewalTerms(providerPrice?.maxBillingCycles) : '';
    const renewalTermsReady = Boolean(renewalTermCopy);
    const signInNext = `/payment?plan=${encodeURIComponent(plan?.name || '')}${billingQuery}${isTrialIntent ? '&trial=1' : ''}`;
    const formattedEntitlementEnd = formatDate(entitlements.trialEndsAt);

    const refreshPaymentStatus = useCallback(async () => {
        if (!token) return null;
        const response = await fetch(`${AUTH_API}/api/auth/billing/status`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!response.ok) throw new Error('Payment status is temporarily unavailable.');
        const result = await response.json().catch(() => {
            throw new CheckoutError('Payment status is temporarily unavailable.');
        }) as PaymentStatus;
        setPaymentStatus(result);
        setPaymentStatusReady(true);
        return result;
    }, [token]);

    useEffect(() => {
        if (!plan) return;
        const controller = new AbortController();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        setOptionsLoaded(false);
        setConsent(false);
        setOptionsError(false);
        fetch(`${AUTH_API}/api/auth/billing/options?plan=${encodeURIComponent(plan.name)}${billingQuery}${isUpgrade ? '&upgrade=1' : ''}`, {
            headers, signal: controller.signal, cache: 'no-store',
        }).then(async response => {
            if (!response.ok) throw new Error(OPTIONS_UNAVAILABLE);
            const result = await responseJson(response) as Options | null;
            if (!result?.providers || typeof result.providers !== 'object' || Array.isArray(result.providers)
                || typeof result.paymentsEnabled !== 'boolean' || result.billing !== billing || result.trialDays !== TRIAL_DAYS) {
                throw new Error(OPTIONS_UNAVAILABLE);
            }
            const normalized: Options = {
                paymentsEnabled: result.paymentsEnabled,
                taxPercent: Number.isFinite(result.taxPercent) ? result.taxPercent : 18,
                trialDays: Number.isFinite(result.trialDays) ? result.trialDays : TRIAL_DAYS,
                providers: {
                    razorpay: normalizeProvider(result.providers.razorpay),
                    paypal: normalizeProvider(result.providers.paypal),
                    cashfree: normalizeProvider(result.providers.cashfree),
                },
            };
            if (controller.signal.aborted) return;
            setConsent(false);
            setOptions(normalized);
            setOptionsLoaded(true);
            const firstConfigured = GATEWAYS.find(item => normalized.paymentsEnabled
                && (showTrialFlow ? normalized.providers[item].trialEnabled : normalized.providers[item].enabled));
            setGateway(firstConfigured || 'cashfree');
        }).catch(() => {
            if (controller.signal.aborted) return;
            setOptionsError(true);
        });
        return () => controller.abort();
    }, [plan?.name, token, showTrialFlow, billingQuery, optionsAttempt, isUpgrade]);

    useEffect(() => {
        setPaymentStatus(null);
        setPaymentStatusReady(false);
        if (!token || session.status !== 'authenticated') return;
        void refreshPaymentStatus().catch(() => setError('We couldn’t check your current plan. Refresh this page to try again.'));
    }, [token, session.status, refreshPaymentStatus]);

    useEffect(() => {
        if (!isTrialIntent || !plan || isProviderReturn || session.status !== 'authenticated' || entitlements.loading || !entitlements.verified) return;
        if (isAdmin) return;
        if (trialEligible) return;
        const reason = entitlements.status === 'trial_active'
            ? `Your ${planLabel(entitlements.plan)} trial is already active${formattedEntitlementEnd ? ` through ${formattedEntitlementEnd}` : ''}. Choose a paid plan if you want to continue.`
            : trialConsumed
                ? 'This account has used its one free trial. Continuing to the selected paid plan.'
                : 'This account is not eligible for a free trial. Continuing to the selected paid plan.';
        setTrialRedirectNotice(reason);
        setConsent(false);
        navigate(`/payment?plan=${encodeURIComponent(plan.name)}${billingQuery}`, { replace: true });
    }, [isTrialIntent, plan?.name, isProviderReturn, session.status, entitlements.loading, entitlements.status, entitlements.plan, entitlements.verified, trialEligible, trialConsumed, isAdmin, formattedEntitlementEnd, navigate, billingQuery]);

    useEffect(() => {
        if (!isProviderReturn || !token || !plan) return;
        let cancelled = false;
        let timer = 0;
        let attempt = 0;
        setMessage('We’re checking your payment setup. This can take a moment.');
        const check = async () => {
            if (cancelled) return;
            attempt += 1;
            try {
                const billing = await refreshPaymentStatus();
                const response = await fetch(`${AUTH_API}/api/auth/me/entitlements`, {
                    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
                });
                if (response.ok) {
                    const current = await response.json() as EntitlementSnapshot;
                    window.dispatchEvent(new Event('qsvc:entitlements-refresh'));
                    const trialActive = isTrialIntent && current.status === 'trial_active';
                    const paidActive = !isTrialIntent && current.status === 'paid_active';
                    const upgrading = billing?.plan === planKey && Boolean(billing?.replacesSubscriptionId);
                    if (isTrialIntent && current.status === 'paid_active') {
                        setMessage('');
                        setError(`This return was for a ${plan.name} trial, but your account has ${planLabel(current.plan)} paid access. Trial activation was not confirmed.`);
                        return;
                    }
                    if (!isTrialIntent && current.status === 'trial_active' && !upgrading) {
                        setMessage('');
                        setError(`This return was for the paid ${plan.name} plan, but your account has an active ${planLabel(current.plan)} trial. Paid access was not confirmed.`);
                        return;
                    }
                    if (trialActive) {
                        if (current.plan !== `${planKey}_trial`) {
                            setMessage('');
                            setError(`Your account shows a ${planLabel(current.plan)} trial, but this checkout requested ${plan.name}. The requested trial was not confirmed.`);
                            return;
                        }
                        const end = formatDate(current.trialEndsAt);
                        setError('');
                        setMessage(`Your ${plan.name} trial is active${end ? ` through ${end}` : ''}. The provider confirms the first-charge date.`);
                        return;
                    }
                    if (paidActive && (!upgrading || current.plan === planKey)) {
                        if (current.plan !== planKey) {
                            setMessage('');
                            setError(`Your account shows ${planLabel(current.plan)} access, but this checkout requested ${plan.name}. The requested plan was not confirmed.`);
                            return;
                        }
                        const end = formatDate(billing?.currentPeriodEnd);
                        setError('');
                        setMessage(`Your ${plan.name} plan is active${end ? ` through ${end}` : ''}.`);
                        return;
                    }
                }
            } catch { /* Keep checking; provider confirmation can take a short time. */ }
            if (attempt < 8 && !cancelled) timer = window.setTimeout(() => void check(), 3000);
            else if (!cancelled) setMessage('Your payment setup is still pending. Return here later to check your plan status.');
        };
        void check();
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [isProviderReturn, isTrialIntent, token, plan?.name, planKey, refreshPaymentStatus]);

    useEffect(() => {
        if (isProviderCancel) setMessage('Checkout was cancelled. You can try again when ready.');
    }, [isProviderCancel]);

    useEffect(() => { setConsent(false); }, [gateway, planKey, isTrialCheckout]);
    useEffect(() => { setPhoneNumber(session.profile?.phoneNumber || ''); }, [session.profile?.id, session.profile?.phoneNumber]);

    async function readEntitlementStatus(): Promise<EntitlementSnapshot | null> {
        if (!token) return null;
        const response = await fetch(`${AUTH_API}/api/auth/me/entitlements`, {
            headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        });
        if (!response.ok) return null;
        const current = await response.json() as EntitlementSnapshot;
        window.dispatchEvent(new Event('qsvc:entitlements-refresh'));
        return current;
    }

    async function waitForServerConfirmation(trial: boolean) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            try {
                const billing = await refreshPaymentStatus();
                const current = await readEntitlementStatus();
                if (trial && current?.status === 'paid_active') {
                    setMessage('');
                    setError(`This checkout requested a ${plan?.name} trial, but your account has ${planLabel(current.plan)} paid access. Trial activation was not confirmed.`);
                    return;
                }
                if (!trial && current?.status === 'trial_active' && !isUpgrade) {
                    setMessage('');
                    setError(`This checkout requested the paid ${plan?.name} plan, but your account has an active ${planLabel(current.plan)} trial. Paid access was not confirmed.`);
                    return;
                }
                if (trial && current?.status === 'trial_active') {
                    if (current.plan !== `${planKey}_trial`) {
                        setMessage('');
                        setError(`Your account shows a ${planLabel(current.plan)} trial, but this checkout requested ${plan?.name}. The requested trial was not confirmed.`);
                        return;
                    }
                    const end = formatDate(current.trialEndsAt);
                    setError('');
                    setMessage(`Your ${plan?.name} trial is active${end ? ` through ${end}` : ''}. The provider confirms the first-charge date.`);
                    return;
                }
                if (!trial && current?.status === 'paid_active' && (!isUpgrade || current.plan === planKey)) {
                    if (current.plan !== planKey) {
                        setMessage('');
                        setError(`Your account shows ${planLabel(current.plan)} access, but this checkout requested ${plan?.name}. The requested plan was not confirmed.`);
                        return;
                    }
                    setError('');
                    const end = formatDate(billing?.currentPeriodEnd);
                    setMessage(`Your ${plan?.name} plan is active${end ? ` through ${end}` : ''}.`);
                    return;
                }
            } catch { /* Provider and webhook confirmation can arrive asynchronously. */ }
            await new Promise(resolve => window.setTimeout(resolve, 3000));
        }
        setMessage('Your payment setup is still pending. Return here later to check your plan status.');
    }

    async function beginCheckout() {
        if (!plan || !planKey || !isAuthReady || !paymentStatusReady || !priceReady || !checkoutGateways.includes(gateway) || !consent || busy || isCurrentPlan || blockPlanChange || isProviderReturn || !renewalTermsReady) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            if (gateway === 'cashfree' && !storedIndianMobile) {
                const normalizedPhone = phoneNumber.trim().replace(/[\s()-]/g, '');
                if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone)) {
                    throw new CheckoutError('Enter a valid Indian mobile number with +91 to use UPI AutoPay.');
                }
                const profileUpdate = await fetch(`${AUTH_API}/api/auth/me`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: normalizedPhone }),
                });
                if (!profileUpdate.ok) throw new CheckoutError('Your mobile number could not be saved. Please try again.');
                await refreshSession();
            }
            if (gateway !== 'paypal' && !await loadProviderScript(gateway)) {
                throw new CheckoutError(`We couldn’t load ${gatewayName(gateway)}. Check your connection and try again.`);
            }
            const response = await fetch(`${AUTH_API}/api/auth/billing/checkout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: gateway, plan: plan.name, billing, trial: isTrialCheckout, mandateConsent: true,
                    ...(upgradeFrom ? { upgradeFrom } : {}), quote: {
                    currency: providerPrice.currency, totalAmount: providerPrice.totalAmount,
                    ...(providerPrice.promotion ? { promotion: { cycles: providerPrice.promotion.cycles, regularTotalAmount: providerPrice.promotion.regularTotalAmount } } : {}),
                } }),
            });
            const body = await responseJson(response);
            if (!response.ok) throw new CheckoutError(checkoutError(response.status, body));
            const result = body as CheckoutResult | null;
            if (result?.recurring !== true || result.provider !== gateway) throw new CheckoutError('We couldn’t open checkout. Please try again.');

            if (gateway === 'paypal') {
                if (typeof result.approvalUrl !== 'string') throw new CheckoutError('We couldn’t open PayPal. Try again or choose another payment option.');
                const approval = new URL(result.approvalUrl);
                if (approval.protocol !== 'https:' || !['www.paypal.com', 'www.sandbox.paypal.com'].includes(approval.hostname)) {
                    throw new CheckoutError('We couldn’t open PayPal. Try again or choose another payment option.');
                }
                window.location.assign(approval.toString());
                return;
            }

            if (gateway === 'razorpay') {
                if (typeof result.subscription_id !== 'string' || !result.subscription_id || typeof result.keyId !== 'string' || !result.keyId) throw new CheckoutError('We couldn’t open Razorpay. Try again or choose another payment option.');
                const loaded = await loadProviderScript('razorpay');
                if (!loaded || !window.Razorpay) throw new CheckoutError('We couldn’t open Razorpay. Check your connection and try again.');
                const checkout = new window.Razorpay({
                    key: result.keyId,
                    subscription_id: result.subscription_id,
                    name: 'QS-VC',
                    description: `QS-VC ${plan.name} ${billing} plan${isTrialCheckout ? ` · ${options.trialDays}-day free trial` : ''}`,
                    prefill: { email: result.email || session.profile?.email || '' },
                    theme: { color: '#087d83' },
                    handler: async (confirmation: Record<string, unknown>) => {
                        setBusy(true);
                        try {
                            const verified = await fetch(`${AUTH_API}/api/auth/billing/razorpay/verify`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    paymentId: confirmation.razorpay_payment_id,
                                    subscriptionId: confirmation.razorpay_subscription_id || result.subscription_id,
                                    signature: confirmation.razorpay_signature,
                                }),
                            });
                            if (!verified.ok) throw new Error();
                            setMessage('We’re confirming your payment setup.');
                            await waitForServerConfirmation(isTrialCheckout);
                        } catch {
                            setError('We couldn’t confirm your payment setup yet. Check your plan status before trying again.');
                        } finally {
                            setBusy(false);
                        }
                    },
                    modal: { ondismiss: () => setMessage('Checkout closed. Check your plan status if you already approved payment.') },
                });
                checkout.on('payment.failed', () => {
                    setError('Razorpay couldn’t approve your payment method. Try again or choose another payment option.');
                });
                checkout.open();
                return;
            }

            await openCashfreeSubscription(result.sessionId, result.mode);
            setMessage('We’re waiting for Cashfree to confirm your payment setup.');
        } catch (cause) {
            setError(cause instanceof CheckoutError ? cause.message : 'We couldn’t open checkout. Please try again.');
        } finally {
            setBusy(false);
        }
    }

    async function cancelSubscription() {
        if (!paymentStatus?.id || !token || paymentStatus.billingMode !== 'subscription') return;
        setBusy(true);
        setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/billing/cancel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscriptionId: paymentStatus.id }),
            });
            const result = await responseJson(response);
            if (!response.ok) throw new Error();
            await refreshPaymentStatus().catch(() => undefined);
            const currentPeriodEnd = typeof result?.currentPeriodEnd === 'string' ? result.currentPeriodEnd : '';
            setMessage(paymentStatus.status === 'pending' ? 'Pending checkout cancelled.' : currentPeriodEnd
                ? `Renewal is cancelled. Your paid access remains until ${new Date(currentPeriodEnd).toLocaleDateString()}.`
                : 'Renewal is cancelled.');
        } catch {
            setError('We couldn’t confirm your cancellation. Check your subscription before trying again.');
        } finally {
            setBusy(false);
        }
    }

    const pageTitle = showTrialFlow ? `Set up your ${plan?.name || ''} trial.` : 'Review and check out';
    const introCopy = showTrialFlow
        ? `One free ${options.trialDays}-day trial per account. Your trial starts when recurring payments are approved and lasts at least ${options.trialDays} days. You’ll see the first charge date before you approve.`
        : 'Review the monthly price, GST and renewal terms before continuing.';
    const displayedMonthlyTotal = priceReady ? formatMoney(providerPrice.totalAmount, providerPrice.currency) : '';
    const promotion = providerPrice.promotion;
    const promotionTerms = promotion
        ? `${promotion.percent}% off for the first ${promotion.cycles} paid month${promotion.cycles === 1 ? '' : 's'}, then ${formatMoney(promotion.regularTotalAmount, providerPrice.currency)}/month including GST.` : '';
    const trialFirstChargeCopy = priceReady
        ? `First monthly charge is ${displayedMonthlyTotal} ${providerPrice.currency}, including GST. You won’t be charged a plan fee until at least ${options.trialDays} days after approval.`
        : `You won’t be charged a plan fee until at least ${options.trialDays} days after approval.`;

    return <div className="public-site"><SiteNav /><main id="main-content" className="public-container payment-page">
        <Link className="payment-back-link" to={pricingHref}>← Back to plans</Link>
        <header className="public-page-intro"><h1>{pageTitle}</h1><p>{introCopy}</p></header>
        {!plan ? <section className="payment-summary"><h2>Choose a plan first.</h2><p>Select Basic, Starter, Pro or Business to review payment options.</p><Link to={pricingHref}>View plans</Link></section>
            : isAdmin ? <section className="payment-admin-access" role="status"><h2>You already have every feature.</h2><p>There is no need to start a trial or set up a monthly plan.</p><Link className="btn-primary" to="/app">Go to meetings</Link></section>
            : <div className="payment-layout">
                <section className="payment-plan-review" aria-labelledby="selected-plan-title">
                    <div><span className="mi" aria-hidden="true">videocam</span><h2 id="selected-plan-title">QS-VC {plan.name}</h2></div>
                    <p>{plan.desc}</p>
                    <p>{billing === 'annual' ? 'Annual rate · billed monthly' : 'Monthly plan'} · Per user</p>
                    <Link to={pricingHref}>Change plan</Link>
                </section>
                <section className="payment-summary" aria-labelledby="order-title">
                    <h2 id="order-title">Order summary</h2><p className="payment-order-plan">QS-VC {plan.name}</p><p>{billing === 'annual' ? 'Annual rate · billed monthly' : 'Monthly billing'}</p>
                    <CurrencyRateSelector id="payment-currency" value={currencyRates} />
                    {priceReady ? <div className="payment-breakdown" aria-label={`${gatewayName(gateway)} monthly price breakdown`}>
                        <p><span>Plan price</span><strong>{promotion && <s className="payment-regular-price">{formatMoney(promotion.regularBaseAmount, providerPrice.currency)} </s>}{formatMoney(providerPrice.baseAmount, providerPrice.currency)}</strong></p>
                        {promotion && <p className="payment-offer-note">{promotionTerms}</p>}
                        <p><span>GST ({options.taxPercent}%)</span><strong>{formatMoney(providerPrice.taxAmount, providerPrice.currency)}</strong></p>
                        <p className="payment-total"><span>{options.paymentsEnabled && gatewayReady ? 'Monthly total per user' : 'Proposed monthly total per user'}</span><strong>{displayedMonthlyTotal}<small> / month</small></strong></p>
                        {totalAmountDisplay && currencyRates.displayCurrency !== providerPrice.currency && <p className="payment-conversion"><span>Approx. in {currencyRates.displayCurrency}</span><strong>{totalAmountDisplay}</strong></p>}
                    </div> : <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>{optionsLoaded || optionsError ? 'We couldn’t load the price for this plan.' : 'Loading current price…'}</p></div>}
                    {priceReady && !isCurrentPlan && !blockPlanChange && (!showTrialFlow || isTrialCheckout) && <div className="payment-due-today">
                        <span>{isTrialCheckout ? 'Plan fee today' : gatewayReady && options.paymentsEnabled ? 'Due at checkout' : 'Proposed first charge'}</span>
                        <strong>{isTrialCheckout ? formatMoney(0, providerPrice.currency) : displayedMonthlyTotal}</strong>
                        <small>{isTrialCheckout ? `First plan charge at least ${options.trialDays} days after approval. Any payment-method verification is shown by the provider.` : 'Includes GST. Review and approve the final amount with your payment provider.'}</small>
                    </div>}
                    <p className="payment-note">{renewalTermCopy && `${renewalTermCopy} `}Currency conversions are estimates. You pay in the currency shown at checkout.</p>
                    {showTrialFlow && <div className="payment-trial-summary-note">
                        <strong>No plan fee during the trial.</strong>
                        <span>{trialFirstChargeCopy}</span>
                        <span>Your account gets one trial across all paid plans.</span>
                    </div>}
                    {trialRedirectNotice && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>{trialRedirectNotice}</p></div>}
                    <Link className="payment-change-plan" to={pricingHref}>Choose a different plan</Link>
                </section>
                <section className="payment-options" aria-labelledby="gateway-title">
                    <h2>Contact information</h2>
                    <p className="payment-details-intro">Your subscription belongs to your signed-in QS-VC account.</p>
                    {session.status === 'checking' && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">schedule</span><p>Checking your account…</p></div>}
                    {session.status !== 'checking' && !isAuthReady && !(showTrialFlow && optionsLoaded && enabledGateways.length > 0 && checkoutGateways.length === 0) && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">info</span>
                        <p>{showTrialFlow ? 'Sign in or create an account to continue setting up your selected trial.' : 'Sign in or create an account to continue to checkout.'} Your plan choice will be kept when you return.</p>
                        <div className="payment-auth-actions">
                            <Link className="btn-primary" to={`/login?next=${encodeURIComponent(signInNext)}`}>Sign in</Link>
                            <Link className="btn-secondary" to={`/signup?next=${encodeURIComponent(signInNext)}`}>Create account</Link>
                        </div>
                    </div>}
                    {isAuthReady && session.profile?.email && <label className="payment-account-email">
                        <span>Billing account</span>
                        <input type="email" value={session.profile.email} readOnly aria-readonly="true" />
                        <small>Checkout uses this account email. It cannot be changed here.</small>
                    </label>}
                    {isAuthReady && needsIndianMobile && <label className="payment-account-email">
                        <span>Indian mobile number</span>
                        <input type="tel" autoComplete="tel" inputMode="tel" value={phoneNumber}
                            onChange={event => setPhoneNumber(event.target.value)} placeholder="+91 98765 43210"
                            aria-describedby="payment-phone-help" />
                        <small id="payment-phone-help">Cashfree UPI AutoPay needs an Indian mobile number. We’ll save it to your account.</small>
                    </label>}
                    {isTrialIntent && isAuthReady && entitlements.loading && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">schedule</span><p>Checking trial eligibility…</p></div>}
                    {optionsError && <div className="payment-status payment-status--error"><span className="mi" aria-hidden="true">error</span><p role="alert">{OPTIONS_UNAVAILABLE}</p><button className="payment-cancel payment-retry" type="button" onClick={() => { setOptionsError(false); setOptionsAttempt(value => value + 1); }}>Try again</button></div>}
                    <h2 id="gateway-title" className="payment-method-title">Choose a payment channel</h2>
                    <p className="payment-details-intro">Choose a provider here. Add or change your card or UPI details in its checkout.</p>
                    <PaymentProviderChoices selected={gateway} available={checkoutGateways} providers={options.providers}
                        loading={!optionsLoaded && !optionsError} disabled={!isAuthReady || busy || isProviderReturn}
                        onSelect={item => { setGateway(item); setConsent(false); }} />
                    {gatewayReady && providerPrice.mode === 'test' && <p className="payment-note" role="status">Test mode — payments are simulated.</p>}
                    {!optionsLoaded && !optionsError && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">schedule</span><p>Loading payment providers…</p></div>}
                    {optionsLoaded && !options.paymentsEnabled && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>Payment methods are temporarily unavailable. Please try again later.</p></div>}
                    {optionsLoaded && options.paymentsEnabled && enabledGateways.length === 0 && checkoutGateways.length === 0 && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>Recurring payments are currently unavailable for this plan.</p></div>}
                    {optionsLoaded && options.paymentsEnabled && showTrialFlow && enabledGateways.length > 0 && checkoutGateways.length === 0 && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>A free trial is currently unavailable for this plan. You can still choose a paid plan.</p><Link className="payment-trial-paid-link" to={`/payment?plan=${encodeURIComponent(plan.name)}${billingQuery}`}>Continue without a trial</Link></div>}
                    {isCurrentPlan && !paymentStatus && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">subscriptions</span>
                        <p>Your account already has access to {plan.name}.</p>
                    </div>}
                    {paymentStatus && !isProviderReturn && ['active', 'pending', 'past_due', 'cancelled'].includes(paymentStatus.status) && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">subscriptions</span>
                        <p>{paymentStatus.status === 'cancelled'
                            ? `Your ${planLabel(paymentStatus.plan)} renewal is cancelled${paymentStatus.currentPeriodEnd ? `; access continues through ${new Date(paymentStatus.currentPeriodEnd).toLocaleDateString()}` : ''}.`
                            : `Your ${planLabel(paymentStatus.plan)} monthly subscription is ${paymentStatus.status.replace('_', ' ')}${paymentStatus.currentPeriodEnd ? ` through ${new Date(paymentStatus.currentPeriodEnd).toLocaleDateString()}` : ''}.`}</p>
                    </div>}
                    {pendingPriceChanged && <p className="payment-note" role="status">Your pending checkout has an earlier price. Cancel it below, then start again to use this offer. We won’t change an existing payment agreement without your approval.</p>}
                    {blockPlanChange && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">info</span>
                        <p>Finish or cancel your pending checkout before choosing another plan.</p>
                    </div>}
                    {isUpgrade && <p className="payment-note" role="status">Your upgrade starts a new billing period at the displayed price after payment is confirmed. Your current plan stays available until then. We’ll cancel its future renewals after the upgrade succeeds. Unused time is not credited, and a second free trial is not included.</p>}
                    {message && <div className="payment-status payment-status--success" role="status"><span className="mi" aria-hidden="true">info</span><p>{message}</p></div>}
                    {error && <div className="payment-status payment-status--error" role="alert"><span className="mi" aria-hidden="true">error</span><p>{error}</p></div>}
                    {isAuthReady && checkoutGateways.length > 0 && !isCurrentPlan && !blockPlanChange && !isProviderReturn && (!showTrialFlow || isTrialCheckout) && <>
                        <label className="payment-consent">
                            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
                            <span>{promotion
                                ? `I authorize ${gatewayName(gateway)} to charge ${displayedMonthlyTotal} per month for the first ${promotion.cycles} paid month${promotion.cycles === 1 ? '' : 's'}${isTrialCheckout ? ' after my free trial' : ''}, then ${formatMoney(promotion.regularTotalAmount, providerPrice.currency)} per month, including ${options.taxPercent}% GST. ${isTrialCheckout ? 'No plan fee is charged during the trial. ' : ''}${renewalTermCopy}`
                                : isTrialCheckout
                                ? `I authorize ${gatewayName(gateway)} to charge ${displayedMonthlyTotal || 'the displayed monthly total'} each month after my trial, including ${options.taxPercent}% GST. No plan fee is charged during the trial. ${renewalTermCopy}`
                                : `I authorize ${gatewayName(gateway)} to charge the recurring monthly total shown above, including ${options.taxPercent}% GST. ${renewalTermCopy}`}</span>
                        </label>
                        {isTrialCheckout && <p className="payment-trial-first-charge">{trialFirstChargeCopy}</p>}
                        <button className="btn-primary payment-checkout-button" type="button" onClick={() => void beginCheckout()} disabled={!consent || busy || !paymentStatusReady || !options.paymentsEnabled || !gatewayReady || !priceReady || !renewalTermsReady} aria-busy={busy}>
                            {busy ? 'Opening secure checkout…' : isTrialCheckout ? 'Approve recurring payments' : 'Continue to monthly checkout'}
                        </button>
                    </>}
                    {isAuthReady && paymentStatus?.id && paymentStatus.billingMode === 'subscription' && ['active', 'pending', 'past_due'].includes(paymentStatus.status) && <button className="payment-cancel" type="button" onClick={() => void cancelSubscription()} disabled={busy}>{busy ? 'Cancelling…' : paymentStatus.status === 'pending' ? 'Cancel checkout' : 'Cancel renewal'}</button>}
                    {(!providerPrice?.enabled || !renewalTermsReady) && optionsLoaded && options.paymentsEnabled && providerPrice?.enabled && <p className="payment-note" role="status">Renewal terms are unavailable right now. Please try again later.</p>}
                    <p className="payment-cancel-note">Return here to cancel future renewals.</p>
                    <Link className="payment-contact" to={`/contact?interest=${plan.name}`}>Contact us about this plan</Link>
                </section>
            </div>}
    </main><SiteFooter /></div>;
}
