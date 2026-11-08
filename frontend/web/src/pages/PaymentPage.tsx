import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import CurrencyRateSelector from '../components/CurrencyRateSelector';
import { plans } from './PricingPage';
import { AUTH_API, getToken, refreshSession } from '../lib/session';
import { useSession } from '../lib/use-session';
import { useEntitlements } from '../lib/entitlements';
import { useCurrencyRates, type DisplayCurrency } from '../lib/currency-rates';
import '../styles/payment.css';

type Gateway = 'razorpay' | 'paypal' | 'cashfree';
type GatewayOption = { enabled: boolean; trialEnabled: boolean; maxBillingCycles?: number | null; currency: string; baseAmount: string; taxAmount: string; totalAmount: string };
type Options = { paymentsEnabled: boolean; taxPercent: number; trialDays: number; providers: Record<Gateway, GatewayOption> };
type PaymentStatus = {
    id: string;
    plan: 'starter' | 'pro';
    status: string;
    billingMode: 'subscription' | 'one_time';
    currentPeriodEnd: string | null;
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
            checkout: (options: { subscriptionSessionId: string; redirectTarget: '_self' }) => Promise<unknown> | unknown;
        };
    }
}

const GATEWAYS: Gateway[] = ['razorpay', 'cashfree', 'paypal'];
const DEFAULT_PROVIDER: GatewayOption = { enabled: false, trialEnabled: false, currency: '', baseAmount: '', taxAmount: '', totalAmount: '' };

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
    if (plan === 'starter' || plan === 'starter_trial') return 'Starter';
    if (plan === 'pro' || plan === 'pro_trial') return 'Pro';
    return 'another';
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

function gatewayDescription(gateway: Gateway) {
    if (gateway === 'razorpay') return 'Recurring monthly payments using UPI AutoPay, cards or other methods supported for your account.';
    if (gateway === 'cashfree') return 'Cashfree UPI AutoPay, including BHIM where supported, and cards.';
    return 'PayPal hosted monthly approval in the currency configured for your account.';
}

async function responseJson(response: Response) {
    return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function responseError(body: Record<string, unknown>, fallback: string) {
    return typeof body.error === 'string' ? body.error : fallback;
}

export default function PaymentPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const currencyRates = useCurrencyRates();
    const requestedPlan = params.get('plan');
    const isTrialIntent = params.get('trial') === '1';
    const isProviderReturn = params.get('result') === 'return';
    const isProviderCancel = params.get('result') === 'cancel';
    const plan = plans.find(item => item.name === requestedPlan && ['Starter', 'Pro'].includes(item.name));
    const planKey = plan?.name.toLowerCase() as 'starter' | 'pro' | undefined;
    const [gateway, setGateway] = useState<Gateway>('razorpay');
    const [options, setOptions] = useState<Options>({
        paymentsEnabled: false,
        taxPercent: 18,
        trialDays: 7,
        providers: { razorpay: { ...DEFAULT_PROVIDER, currency: 'INR' }, paypal: { ...DEFAULT_PROVIDER }, cashfree: { ...DEFAULT_PROVIDER, currency: 'INR' } },
    });
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    const [optionsError, setOptionsError] = useState('');
    const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(null);
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
        || (entitlements.status === 'paid_active' && ['starter', 'pro', 'enterprise'].includes(entitlements.plan));
    const trialEligible = !isAdmin && entitlements.plan === 'guest' && !trialConsumed;
    const showTrialFlow = isTrialIntent && !trialRedirectNotice;
    const isTrialCheckout = showTrialFlow && trialEligible && session.status === 'authenticated' && !entitlements.loading;
    const isAuthReady = Boolean(token) && session.status === 'authenticated';
    const storedIndianMobile = /^\+91[6-9]\d{9}$/.test(session.profile?.phoneNumber || '');
    const needsIndianMobile = gateway === 'cashfree' && !storedIndianMobile;

    const enabledGateways = useMemo(() => optionsLoaded && options.paymentsEnabled
        ? GATEWAYS.filter(item => options.providers[item]?.enabled)
        : [], [options, optionsLoaded]);
    const checkoutGateways = useMemo(() => showTrialFlow
        ? enabledGateways.filter(item => options.providers[item]?.trialEnabled)
        : enabledGateways, [enabledGateways, options, showTrialFlow]);
    const providerPrice = options.providers[gateway];
    const priceReady = Boolean(providerPrice?.baseAmount && providerPrice?.taxAmount && providerPrice?.totalAmount && providerPrice?.currency);
    const totalAmountDisplay = priceReady
        ? convertDisplayAmount(providerPrice.totalAmount, providerPrice.currency, currencyRates.displayCurrency, currencyRates.rates)
        : '';
    const planEntitled = entitlements.status === 'paid_active'
        && (entitlements.plan === planKey || (entitlements.plan === 'pro' && planKey === 'starter'));
    const statusCoversPlan = paymentStatus?.status === 'active'
        && (paymentStatus.plan === planKey || (paymentStatus.plan === 'pro' && planKey === 'starter'));
    const isCurrentPlan = planEntitled || statusCoversPlan;
    const starterEntitlementLive = entitlements.plan === 'starter' && entitlements.status === 'paid_active';
    const starterSubscriptionLive = paymentStatus?.plan === 'starter'
        && paymentStatus.billingMode === 'subscription'
        && ['active', 'pending', 'past_due', 'cancelled'].includes(paymentStatus.status)
        && (!paymentStatus.currentPeriodEnd || new Date(paymentStatus.currentPeriodEnd).getTime() > Date.now());
    const blockStarterToPro = planKey === 'pro' && (starterEntitlementLive || starterSubscriptionLive);
    const renewalTermCopy = renewalTerms(providerPrice?.maxBillingCycles);
    const renewalTermsReady = Boolean(renewalTermCopy);
    const signInNext = `/payment?plan=${encodeURIComponent(plan?.name || '')}${isTrialIntent ? '&trial=1' : ''}`;
    const formattedEntitlementEnd = formatDate(entitlements.trialEndsAt);

    const refreshPaymentStatus = useCallback(async () => {
        if (!token) return null;
        const response = await fetch(`${AUTH_API}/api/auth/billing/status`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!response.ok) throw new Error('Payment status is temporarily unavailable.');
        const result = await response.json() as PaymentStatus;
        setPaymentStatus(result);
        return result;
    }, [token]);

    useEffect(() => {
        if (!plan) return;
        const controller = new AbortController();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        setOptionsLoaded(false);
        setOptionsError('');
        fetch(`${AUTH_API}/api/auth/billing/options?plan=${encodeURIComponent(plan.name)}`, {
            headers, signal: controller.signal, cache: 'no-store',
        }).then(async response => {
            const result = await response.json() as Options;
            if (!response.ok) throw new Error('Payment options could not be loaded.');
            if (!result.providers || typeof result.paymentsEnabled !== 'boolean') throw new Error('Payment options could not be loaded.');
            const normalized: Options = {
                paymentsEnabled: result.paymentsEnabled,
                taxPercent: Number.isFinite(result.taxPercent) ? result.taxPercent : 18,
                trialDays: Number.isFinite(result.trialDays) ? result.trialDays : 7,
                providers: {
                    razorpay: { ...DEFAULT_PROVIDER, ...result.providers.razorpay },
                    paypal: { ...DEFAULT_PROVIDER, ...result.providers.paypal },
                    cashfree: { ...DEFAULT_PROVIDER, ...result.providers.cashfree },
                },
            };
            setOptions(normalized);
            setOptionsLoaded(true);
            const firstConfigured = GATEWAYS.find(item => normalized.paymentsEnabled
                && normalized.providers[item].enabled
                && (!showTrialFlow || normalized.providers[item].trialEnabled));
            setGateway(firstConfigured || (normalized.providers.razorpay.totalAmount ? 'razorpay' : 'cashfree'));
        }).catch(cause => {
            if (controller.signal.aborted) return;
            setOptionsError(cause instanceof Error ? cause.message : 'Payment options could not be loaded.');
        });
        return () => controller.abort();
    }, [plan?.name, token, showTrialFlow]);

    useEffect(() => {
        if (!token || session.status !== 'authenticated') return;
        void refreshPaymentStatus().catch(() => undefined);
    }, [token, session.status, refreshPaymentStatus]);

    useEffect(() => {
        if (!isTrialIntent || !plan || isProviderReturn || session.status !== 'authenticated' || entitlements.loading) return;
        if (isAdmin) return;
        if (trialEligible) return;
        const reason = entitlements.status === 'trial_active'
            ? `Your ${entitlements.plan === 'pro_trial' ? 'Pro' : 'Starter'} trial is already active${formattedEntitlementEnd ? ` through ${formattedEntitlementEnd}` : ''}. Choose a paid monthly plan if you want to continue.`
            : trialConsumed
                ? 'This account has used its one 7-day trial. Continuing to the selected paid monthly plan.'
                : 'This account is not eligible for a free trial. Continuing to the selected paid monthly plan.';
        setTrialRedirectNotice(reason);
        setConsent(false);
        navigate(`/payment?plan=${encodeURIComponent(plan.name)}`, { replace: true });
    }, [isTrialIntent, plan?.name, isProviderReturn, session.status, entitlements.loading, entitlements.status, entitlements.plan, trialEligible, trialConsumed, isAdmin, formattedEntitlementEnd, navigate]);

    useEffect(() => {
        if (!isProviderReturn || !token || !plan) return;
        let cancelled = false;
        let timer = 0;
        let attempt = 0;
        setMessage('The payment provider returned you to QS-VC. We are checking its confirmation before activating your plan.');
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
                    if (isTrialIntent && current.status === 'paid_active') {
                        setMessage('');
                        setError(`This return was for a ${plan.name} trial, but your account has ${planLabel(current.plan)} paid access. Trial activation was not confirmed.`);
                        return;
                    }
                    if (!isTrialIntent && current.status === 'trial_active') {
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
                        setMessage(`Your ${plan.name} trial is active${end ? ` through ${end}` : ''}. It lasts at least 7 days after mandate authorization; the provider checkout confirms the first-charge date.`);
                        return;
                    }
                    if (paidActive) {
                        if (current.plan !== planKey) {
                            setMessage('');
                            setError(`Your account shows ${planLabel(current.plan)} access, but this checkout requested ${plan.name}. The requested plan was not confirmed.`);
                            return;
                        }
                        const end = formatDate(billing?.currentPeriodEnd);
                        setError('');
                        setMessage(`Your ${plan.name} monthly plan is active${end ? ` through ${end}` : ''}.`);
                        return;
                    }
                }
            } catch { /* Keep checking; provider confirmation can take a short time. */ }
            if (attempt < 8 && !cancelled) timer = window.setTimeout(() => void check(), 3000);
            else if (!cancelled) setMessage('Mandate confirmation is still processing. Your plan will activate only after the provider confirms it. You can return to this page later to check again.');
        };
        void check();
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [isProviderReturn, isTrialIntent, token, plan?.name, planKey, refreshPaymentStatus]);

    useEffect(() => {
        if (isProviderCancel) setMessage('Checkout was cancelled. No plan access or trial was started. You can try again when ready.');
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
                if (!trial && current?.status === 'trial_active') {
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
                    setMessage(`Your ${plan?.name} trial is active${end ? ` through ${end}` : ''}. It lasts at least 7 days after mandate authorization; the provider checkout confirms the first-charge date.`);
                    return;
                }
                if (!trial && current?.status === 'paid_active') {
                    if (current.plan !== planKey) {
                        setMessage('');
                        setError(`Your account shows ${planLabel(current.plan)} access, but this checkout requested ${plan?.name}. The requested plan was not confirmed.`);
                        return;
                    }
                    setError('');
                    const end = formatDate(billing?.currentPeriodEnd);
                    setMessage(`Your ${plan?.name} monthly plan is active${end ? ` through ${end}` : ''}.`);
                    return;
                }
            } catch { /* Provider and webhook confirmation can arrive asynchronously. */ }
            await new Promise(resolve => window.setTimeout(resolve, 3000));
        }
        setMessage('Mandate authorization was submitted. Your plan will activate only after server verification; confirmation may take a few minutes.');
    }

    async function beginCheckout() {
        if (!plan || !planKey || !isAuthReady || !checkoutGateways.includes(gateway) || !consent || busy || isCurrentPlan || blockStarterToPro || isProviderReturn || !renewalTermsReady) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            if (gateway === 'cashfree' && !storedIndianMobile) {
                const normalizedPhone = phoneNumber.trim().replace(/[\s()-]/g, '');
                if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone)) {
                    throw new Error('Enter a valid Indian mobile number with +91 to use UPI AutoPay.');
                }
                const profileUpdate = await fetch(`${AUTH_API}/api/auth/me`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: normalizedPhone }),
                });
                const profileResult = await responseJson(profileUpdate);
                if (!profileUpdate.ok) throw new Error(responseError(profileResult, 'Your mobile number could not be saved.'));
                await refreshSession();
            }
            const response = await fetch(`${AUTH_API}/api/auth/billing/checkout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: gateway, plan: plan.name, trial: isTrialCheckout, mandateConsent: true }),
            });
            const body = await responseJson(response);
            if (!response.ok) throw new Error(responseError(body, 'Checkout could not be started.'));
            const result = body as unknown as CheckoutResult;
            if (result.recurring !== true || result.provider !== gateway) throw new Error('The server did not return a recurring subscription checkout. No trial was started.');

            if (gateway === 'paypal') {
                if (!result.approvalUrl) throw new Error('PayPal did not return an approval link.');
                const approval = new URL(result.approvalUrl);
                if (approval.protocol !== 'https:' || !['www.paypal.com', 'www.sandbox.paypal.com'].includes(approval.hostname)) {
                    throw new Error('PayPal returned an unexpected checkout address.');
                }
                window.location.assign(approval.toString());
                return;
            }

            if (gateway === 'razorpay') {
                if (!result.subscription_id || !result.keyId) throw new Error('Razorpay did not return a subscription checkout.');
                const loaded = await loadProviderScript('razorpay');
                if (!loaded || !window.Razorpay) throw new Error('Razorpay Checkout did not load. Check your connection and try again.');
                const checkout = new window.Razorpay({
                    key: result.keyId,
                    subscription_id: result.subscription_id,
                    name: 'QS-VC',
                    description: `QS-VC ${plan.name} monthly plan${isTrialCheckout ? ` · ${options.trialDays}-day free trial` : ''}`,
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
                            const verification = await responseJson(verified);
                            if (!verified.ok) throw new Error(responseError(verification, 'Razorpay could not verify the mandate authorization.'));
                            setMessage('Razorpay received your mandate authorization. Waiting for server confirmation before activating the plan.');
                            await waitForServerConfirmation(isTrialCheckout);
                        } catch (cause) {
                            setError(cause instanceof Error ? cause.message : 'Mandate confirmation is pending.');
                        } finally {
                            setBusy(false);
                        }
                    },
                    modal: { ondismiss: () => setMessage('Checkout closed. No trial starts until the provider confirms mandate authorization.') },
                });
                checkout.on('payment.failed', failure => {
                    const details = failure.error as { description?: string } | undefined;
                    setError(details?.description || 'Mandate authorization failed. No trial was started; please try again.');
                });
                checkout.open();
                return;
            }

            if (!result.sessionId || !result.mode) throw new Error('Cashfree did not return a subscription checkout session.');
            const loaded = await loadProviderScript('cashfree');
            if (!loaded || !window.Cashfree) throw new Error('Cashfree Checkout did not load. Check your connection and try again.');
            const cashfree = window.Cashfree({ mode: result.mode });
            const checkoutResult = await cashfree.checkout({ subscriptionSessionId: result.sessionId, redirectTarget: '_self' });
            if (checkoutResult && typeof checkoutResult === 'object' && 'error' in checkoutResult && checkoutResult.error) {
                throw new Error('Cashfree could not open the mandate authorization screen. Please try again.');
            }
            setMessage('Cashfree received your request. Your plan activates only after the provider confirms the mandate.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Checkout could not be started.');
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
            if (!response.ok) throw new Error(responseError(result, 'Subscription cancellation failed.'));
            await refreshPaymentStatus();
            const currentPeriodEnd = typeof result.currentPeriodEnd === 'string' ? result.currentPeriodEnd : '';
            setMessage(currentPeriodEnd
                ? `Renewal is cancelled. Your paid access remains until ${new Date(currentPeriodEnd).toLocaleDateString()}.`
                : 'Renewal is cancelled.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Subscription cancellation failed.');
        } finally {
            setBusy(false);
        }
    }

    const pageTitle = showTrialFlow ? `Set up your ${plan?.name || ''} trial.` : 'Your next step with QS-VC.';
    const introCopy = showTrialFlow
        ? `One free ${options.trialDays}-day trial per account. It begins after mandate authorization and lasts at least ${options.trialDays} days; the provider confirms the first-charge date.`
        : 'Review the monthly price, GST and renewal terms before continuing.';
    const displayedMonthlyTotal = priceReady ? formatMoney(providerPrice.totalAmount, providerPrice.currency) : '';
    const trialFirstChargeCopy = priceReady
        ? `First monthly charge: ${displayedMonthlyTotal} ${providerPrice.currency}, including GST. The provider checkout confirms the date; it will be at least ${options.trialDays} days after mandate authorization.`
        : `The first-charge date is confirmed by the provider and will be at least ${options.trialDays} days after mandate authorization.`;

    return <div className="public-site"><SiteNav /><main id="main-content" className="public-container payment-page">
        <Link className="payment-back-link" to="/pricing">← Back to plans</Link>
        <header className="public-page-intro"><h1>{pageTitle}</h1><p>{introCopy}</p></header>
        {!plan ? <section className="payment-summary"><h2>Choose a plan first.</h2><p>Select Starter or Pro to review payment options.</p><Link to="/pricing">View plans</Link></section>
            : isAdmin ? <section className="payment-admin-access" role="status"><span className="payment-eyebrow">ADMIN ACCESS</span><h2>You already have every feature.</h2><p>There is no need to start a trial or set up a monthly plan.</p><Link className="btn-primary" to="/app">Go to meetings</Link></section>
            : <div className="payment-layout">
                <section className="payment-summary" aria-labelledby="order-title">
                    <span className="payment-eyebrow">YOUR SELECTED PLAN</span><h2 id="order-title">QS-VC {plan.name}</h2><p>{plan.desc}</p>
                    <CurrencyRateSelector id="payment-currency" value={currencyRates} />
                    {priceReady ? <div className="payment-breakdown" aria-label={`${gatewayName(gateway)} monthly price breakdown`}>
                        <p><span>Plan price</span><strong>{formatMoney(providerPrice.baseAmount, providerPrice.currency)}</strong></p>
                        <p><span>GST ({options.taxPercent}%)</span><strong>{formatMoney(providerPrice.taxAmount, providerPrice.currency)}</strong></p>
                        <p className="payment-total"><span>{options.paymentsEnabled && providerPrice.enabled ? 'Monthly total per user' : 'Proposed monthly total per user'}</span><strong>{displayedMonthlyTotal}<small> / month</small></strong></p>
                        {totalAmountDisplay && currencyRates.displayCurrency !== providerPrice.currency && <p className="payment-conversion"><span>Approx. in {currencyRates.displayCurrency}</span><strong>{totalAmountDisplay}</strong></p>}
                    </div> : <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>{optionsLoaded ? 'A monthly price is not available for this payment provider.' : 'Loading current monthly price…'}</p></div>}
                    <p className="payment-note">{renewalTermCopy || 'Renewal terms are unavailable for this provider, so checkout is paused.'} The currency selector changes the display estimate only; payment uses the selected provider’s configured currency.</p>
                    {showTrialFlow && <div className="payment-trial-summary-note">
                        <strong>No plan fee during the trial.</strong>
                        <span>{trialFirstChargeCopy}</span>
                        <span>Your account gets one trial total: Starter or Pro.</span>
                    </div>}
                    {trialRedirectNotice && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>{trialRedirectNotice}</p></div>}
                    <Link className="payment-change-plan" to="/pricing">Choose a different plan</Link>
                </section>
                <section className="payment-options" aria-labelledby="gateway-title">
                    <h2 id="gateway-title">Choose a payment channel</h2>
                    {session.status === 'checking' && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">schedule</span><p>Checking your account…</p></div>}
                    {session.status !== 'checking' && !isAuthReady && !(showTrialFlow && optionsLoaded && enabledGateways.length > 0 && checkoutGateways.length === 0) && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">info</span>
                        <p>{showTrialFlow ? 'Sign in or create an account to continue setting up your selected trial.' : 'Sign in or create an account to continue to monthly checkout.'} Your plan choice will be kept when you return.</p>
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
                        <small id="payment-phone-help">Cashfree UPI AutoPay needs an Indian mobile number. We’ll save it to your account profile before checkout.</small>
                    </label>}
                    {isTrialIntent && isAuthReady && entitlements.loading && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">schedule</span><p>Checking trial eligibility…</p></div>}
                    {optionsError && <div className="payment-status payment-status--error" role="alert"><span className="mi" aria-hidden="true">error</span><p>{optionsError}</p></div>}
                    {checkoutGateways.length > 0 && <fieldset className="payment-provider-list" disabled={!isAuthReady || busy || isProviderReturn}>
                        <legend className="sr-only">Recurring payment provider</legend>
                        {checkoutGateways.map(item => <label key={item} className={`payment-gateway${gateway === item ? ' is-selected' : ''}`}>
                            <input type="radio" name="gateway" value={item} checked={gateway === item} onChange={() => { setGateway(item); setConsent(false); }} />
                            <span className="payment-gateway-copy"><strong>{gatewayName(item)}</strong><small>{gatewayDescription(item)}</small></span>
                            <span className="mi payment-provider-check" aria-hidden="true">{gateway === item ? 'check_circle' : 'radio_button_unchecked'}</span>
                        </label>)}
                    </fieldset>}
                    {!optionsLoaded && !optionsError && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">schedule</span><p>Loading payment providers…</p></div>}
                    {optionsError && <p className="payment-note">Payment options are unavailable, so checkout is paused. No payment will be taken.</p>}
                    {optionsLoaded && !options.paymentsEnabled && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>Online checkout is not enabled yet. No payment will be taken.</p></div>}
                    {optionsLoaded && options.paymentsEnabled && enabledGateways.length === 0 && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>No recurring payment provider is configured for this plan yet.</p></div>}
                    {optionsLoaded && options.paymentsEnabled && showTrialFlow && enabledGateways.length > 0 && checkoutGateways.length === 0 && <div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>No configured payment provider can start a free trial for this plan. You can continue to the paid monthly checkout instead.</p><Link className="payment-trial-paid-link" to={`/payment?plan=${encodeURIComponent(plan.name)}`}>Continue without a trial</Link></div>}
                    {isCurrentPlan && !paymentStatus && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">subscriptions</span>
                        <p>Your account already has access to {plan.name}.</p>
                    </div>}
                    {paymentStatus && !isProviderReturn && ['active', 'pending', 'past_due', 'cancelled'].includes(paymentStatus.status) && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">subscriptions</span>
                        <p>{paymentStatus.status === 'cancelled'
                            ? `Your ${paymentStatus.plan === 'pro' ? 'Pro' : 'Starter'} renewal is cancelled${paymentStatus.currentPeriodEnd ? `; access continues through ${new Date(paymentStatus.currentPeriodEnd).toLocaleDateString()}` : ''}.`
                            : `Your ${paymentStatus.plan === 'pro' ? 'Pro' : 'Starter'} monthly subscription is ${paymentStatus.status.replace('_', ' ')}${paymentStatus.currentPeriodEnd ? ` through ${new Date(paymentStatus.currentPeriodEnd).toLocaleDateString()}` : ''}.`}</p>
                    </div>}
                    {blockStarterToPro && <div className="payment-status" role="status">
                        <span className="mi" aria-hidden="true">info</span>
                        <p>{paymentStatus?.status === 'cancelled'
                            ? `Your Starter renewal is already cancelled${paymentStatus.currentPeriodEnd ? `, with access through ${new Date(paymentStatus.currentPeriodEnd).toLocaleDateString()}` : ''}. Choose Pro after your current Starter access ends.`
                            : paymentStatus?.plan === 'starter' && paymentStatus.billingMode === 'subscription' && ['active', 'pending', 'past_due'].includes(paymentStatus.status)
                                ? `Your Starter access is still active${paymentStatus.currentPeriodEnd ? ` through ${new Date(paymentStatus.currentPeriodEnd).toLocaleDateString()}` : ''}. Cancel the Starter renewal below, then choose Pro after the current access period ends.`
                                : 'Your Starter access is still active. Pro checkout is available after that access ends.'}</p>
                    </div>}
                    {message && <div className="payment-status payment-status--success" role="status"><span className="mi" aria-hidden="true">info</span><p>{message}</p></div>}
                    {error && <div className="payment-status payment-status--error" role="alert"><span className="mi" aria-hidden="true">error</span><p>{error}</p></div>}
                    {isAuthReady && checkoutGateways.length > 0 && !isCurrentPlan && !blockStarterToPro && !isProviderReturn && (!showTrialFlow || isTrialCheckout) && <>
                        <label className="payment-consent">
                            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
                            <span>{isTrialCheckout
                                ? `I authorize ${gatewayName(gateway)} to set up a recurring monthly mandate for ${displayedMonthlyTotal || 'the displayed monthly total'} including ${options.taxPercent}% GST after my trial. No plan fee is charged during the trial. ${renewalTermCopy}`
                                : `I authorize ${gatewayName(gateway)} to charge the recurring monthly total shown above, including ${options.taxPercent}% GST. ${renewalTermCopy}`}</span>
                        </label>
                        {isTrialCheckout && <p className="payment-trial-first-charge">{trialFirstChargeCopy} Your trial begins only after the provider confirms mandate authorization.</p>}
                        <button className="btn-primary payment-checkout-button" type="button" onClick={() => void beginCheckout()} disabled={!consent || busy || !options.paymentsEnabled || !providerPrice?.enabled || !priceReady || !renewalTermsReady} aria-busy={busy}>
                            {busy ? 'Opening secure checkout…' : isTrialCheckout ? 'Continue to mandate setup' : 'Continue to monthly checkout'}
                        </button>
                    </>}
                    {isAuthReady && paymentStatus?.id && paymentStatus.billingMode === 'subscription' && ['active', 'pending', 'past_due'].includes(paymentStatus.status) && <button className="payment-cancel" type="button" onClick={() => void cancelSubscription()} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel renewal'}</button>}
                    {(!providerPrice?.enabled || !renewalTermsReady) && optionsLoaded && options.paymentsEnabled && providerPrice?.enabled && <p className="payment-note" role="status">The provider’s renewal limit is missing, so checkout is paused until it is configured.</p>}
                    <p className="payment-cancel-note">You can cancel an active subscription using the cancellation control above. QS-VC activates access after server verification.</p>
                    <Link className="payment-contact" to={`/contact?interest=${plan.name}`}>Contact us about this plan</Link>
                </section>
            </div>}
    </main><SiteFooter /></div>;
}
