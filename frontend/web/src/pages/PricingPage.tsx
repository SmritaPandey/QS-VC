import ActionContents from '../components/ActionContents';
import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import CurrencyRateSelector from '../components/CurrencyRateSelector';
import { getPlanPrice } from '../../../../shared/payment-pricing.mjs';
import { formatConvertedAmount, useCurrencyRates } from '../lib/currency-rates';
import { useSession } from '../lib/use-session';
import { useEntitlements } from '../lib/entitlements';

export const plans = [
    {
        name: 'Free',
        price: '₹0',
        period: 'forever',
        desc: 'Perfect for personal use and quick meetings.',
        highlight: false,
        features: [
            { text: 'Browser meetings', included: true },
            { text: 'Host controls', included: true },
            { text: 'HD video & audio', included: true },
            { text: 'Screen sharing', included: true },
            { text: 'In-meeting chat', included: true },
            { text: 'Basic noise suppression', included: true },
            { text: 'Cloud recording', included: false },
            { text: 'AI captions', included: false },
            { text: 'Admin dashboard', included: false },
            { text: 'SSO / SAML', included: false },
        ],
    },
    {
        name: 'Starter',
        price: '₹499',
        period: '/user/month',
        desc: 'For small teams that need longer meetings.',
        highlight: false,
        features: [
            { text: 'Signed-in workspace', included: true },
            { text: 'Private conversations up to 30 minutes', included: true },
            { text: 'Video quality depends on device and network', included: true },
            { text: 'Cloud recording (requires Pro)', included: false },
            { text: 'AI noise suppression', included: true },
            { text: 'AI captions (English)', included: true },
            { text: 'Meeting scheduling', included: true },
            { text: 'Custom backgrounds', included: true },
            { text: 'AI translation', included: false },
            { text: 'Admin dashboard', included: false },
        ],
    },
    {
        name: 'Pro',
        price: '₹999',
        period: '/user/month',
        desc: 'For growing businesses with advanced needs.',
        highlight: true,
        features: [
            { text: 'Advanced meeting tools', included: true },
            { text: 'Private conversations without a plan time cap', included: true },
            { text: 'Video quality depends on device and network', included: true },
            { text: 'Cloud recording (configured storage required)', included: true },
            { text: 'AI captions (22 languages)', included: true },
            { text: 'Real-time translation', included: true },
            { text: 'Meeting summaries (AI)', included: true },
            { text: 'Breakout rooms', included: true },
            { text: 'Google / Microsoft sign-in (when configured)', included: true },
            { text: 'Admin dashboard & analytics', included: true },
        ],
    },
    {
        name: 'Enterprise',
        displayName: 'Quantum-Premise',
        price: 'Custom',
        period: 'tailored pricing',
        desc: 'For large organizations, banks, government.',
        highlight: false,
        features: [
            { text: 'Capacity scoped to your deployment', included: true },
            { text: 'Features agreed for your organisation', included: true },
            { text: 'Post-Quantum Encryption (PQC): ML-KEM-1024 + ML-DSA-87', included: true },
            { text: 'End-to-End Encryption (E2EE), on by default', included: true },
            { text: 'On-Premise / Air-Gapped', included: true },
            { text: 'LDAP / Active Directory', included: true },
            { text: 'SIP/H.323 interop', included: true },
            { text: 'SLA agreed in your contract', included: true },
            { text: 'White-label / Custom branding', included: true },
            { text: 'Dedicated support engineer', included: true },
        ],
    },
];


const capabilities = [
    ['Browser meetings', 'Available in the demo'],
    ['Screen sharing and chat', 'Available in the demo'],
    ['Captions and speech options', 'Depend on browser, device and meeting server'],
    ['Meeting recording', 'Requires Pro, a signed-in host and configured storage'],
    ['Organisation hosting and identity', 'Require a separate deployment review'],
];
const questions = [
    { question: 'Can I buy a plan now?', answer: 'Checkout availability depends on this deployment. If a recurring payment provider is enabled on the checkout page, you can continue there; otherwise no payment will be taken. Prices, inclusions and commercial terms remain proposed and require confirmation before purchase.' },
    { question: 'Can I record a meeting?', answer: 'Cloud recording requires Pro or an approved enterprise plan, a signed-in meeting host and configured storage. Hosts choose when to download, share or delete recordings.' },
    { question: 'Which languages can I use?', answer: 'Available caption languages depend on the configured meeting server. Translated speech also needs a matching voice on your device. Check the language control inside the meeting.' },
    { question: 'Can my organisation run QS-VC internally?', answer: 'An internal deployment needs a review of your network, devices, identity and hosting requirements. This demo does not establish offline or air-gapped operation.' },
];

export default function PricingPage() {
    const currencyRates = useCurrencyRates();
    const session = useSession();
    const entitlements = useEntitlements();
    const activeTrialPlan = entitlements.status === 'trial_active' && (entitlements.plan === 'starter_trial' || entitlements.plan === 'pro_trial') ? entitlements.plan : null;
    const activeTrialName = activeTrialPlan === 'pro_trial' ? 'Pro' : activeTrialPlan ? 'Starter' : '';
    const activeTrialEnd = entitlements.trialEndsAt && Number.isFinite(new Date(entitlements.trialEndsAt).getTime())
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(entitlements.trialEndsAt))
        : '';
    const trialUsed = entitlements.trialUsed || Boolean(activeTrialPlan) || entitlements.status === 'trial_expired';
    const paidPlanName = entitlements.status === 'paid_active' && ['starter', 'pro'].includes(entitlements.plan)
        ? entitlements.plan === 'pro' ? 'Pro' : 'Starter'
        : '';
    const paidAccessExpired = entitlements.status === 'paid_expired';
    const eligibleForTrial = !trialUsed && !paidPlanName && !paidAccessExpired && entitlements.plan === 'guest';
    const isAdmin = entitlements.isPlatformAdmin || session.profile?.role === 'admin';

    return <div className="public-site public-plans pricing-page">
        <SiteNav />
        <main id="main-content" className="public-container">
            <header className="public-page-intro">
                <h1>Plan your QS-VC rollout.</h1>
                <p>Try the meeting demo and see which capabilities need a separate rollout.</p>
            </header>
            <p className="public-pricing-notice">Proposed pricing. Rates and inclusions are proposed and require confirmation before purchase.</p>
            {isAdmin && <p className="pricing-admin-note" role="status">Your admin access includes every plan feature. <Link to="/app">Go to meetings</Link></p>}
            <CurrencyRateSelector id="pricing-currency" value={currencyRates} />
            {!isAdmin && <p className="pricing-trial-note">{activeTrialPlan
                ? `Your ${activeTrialName} trial is active${activeTrialEnd ? ` through ${activeTrialEnd}` : ''}. Each account can use one free 7-day trial.`
                : entitlements.status === 'trial_expired' ? 'Your 7-day trial has ended. Continue to checkout for a paid plan.'
                    : trialUsed ? 'This account has already used its one free trial. Continue to checkout for a paid plan.'
                    : paidAccessExpired ? 'Your paid access has expired. This account is not eligible for another trial; choose a plan to continue.'
                    : paidPlanName ? `Your ${paidPlanName} plan is active. One free 7-day trial is available only to accounts that have not started a plan.`
                        : 'Choose Starter or Pro for one free 7-day trial per account. No plan fee is charged during the trial. A recurring payment mandate is required, and you can cancel anytime.'}</p>}
                    <div className="pricing-grid">
                        {plans.map(plan => {
                            const price = plan.name === 'Starter' ? getPlanPrice('starter') : plan.name === 'Pro' ? getPlanPrice('pro') : null;
                            return <article id={`plan-${plan.name.toLowerCase()}`} className={`pricing-card ${plan.highlight ? 'pricing-card-highlight' : ''}`} key={plan.name}>
                            <div className="pricing-card-header"><h2>{'displayName' in plan ? plan.displayName : plan.name}{plan.name === 'Pro' && <span className="pricing-crown" aria-label="Pro premium plan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5 4 4-7 4 7 5-4-2 12H5L3 6Z" fill="currentColor"/><path d="M6 21h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>}{plan.name === 'Enterprise' && <span className="pricing-corporate" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 7h3M8 11h3M8 15h3M9 21v-3M17 13h1M17 17h1"/></svg></span>}</h2><p className="pricing-desc">{plan.desc}</p></div>
                            <div className="pricing-price"><span className="pricing-amount">{price ? formatConvertedAmount(price.baseAmountMinor / 100, currencyRates.displayCurrency, currencyRates.rates) : plan.price}</span><span className="pricing-period">{plan.period}</span></div>
                            <p className="pricing-sample-label">Proposed inclusions</p>
                            <ul className="pricing-features">{plan.features.map(feature => <li className={feature.included ? '' : 'pricing-feature-disabled'} key={feature.text}><span className="mi mi-sm" aria-hidden="true">{feature.included ? 'check' : 'remove'}</span><span>{feature.text}{!feature.included && <span className="sr-only">, not included in this proposal</span>}</span></li>)}</ul>
                            {plan.name === 'Free' ? <button type="button" className="btn-secondary pricing-current-plan" disabled>Current plan</button> : isAdmin ? <p className="pricing-admin-included">Included with admin access</p> : plan.name === 'Enterprise' ? <Link className="btn-secondary qsvc-action qsvc-action--secondary" to="/contact?interest=Enterprise"><ActionContents>Contact the team</ActionContents></Link> : <div className="pricing-card-actions">
                                {eligibleForTrial && session.status !== 'checking' && !entitlements.loading ? <Link className={plan.highlight ? 'btn-primary qsvc-action pricing-trial-button' : 'btn-secondary qsvc-action qsvc-action--secondary pricing-trial-button'} to={`/payment?plan=${encodeURIComponent(plan.name)}&trial=1`}>
                                    <ActionContents>Start 7-day free trial</ActionContents>
                                </Link> : eligibleForTrial ? <p className="pricing-trial-card-status" role="status">Checking trial eligibility…</p> : <p className="pricing-trial-card-status" role="status">{activeTrialPlan
                                    ? `${activeTrialName} trial active${activeTrialEnd ? ` through ${activeTrialEnd}` : ''}`
                                    : entitlements.status === 'trial_expired' ? '7-day trial ended'
                                        : trialUsed ? 'Free trial already used'
                                        : paidAccessExpired ? 'Paid access expired'
                                        : paidPlanName ? paidPlanName === plan.name ? `${paidPlanName} plan active` : `${paidPlanName} includes this plan`
                                            : 'A trial is not available for this account'}</p>}
                                {paidPlanName !== plan.name && !(entitlements.plan === 'pro' && plan.name === 'Starter') && <Link className="pricing-checkout-link" to={`/payment?plan=${encodeURIComponent(plan.name)}`}>{paidPlanName === 'Starter' && plan.name === 'Pro' ? 'View Pro options' : 'Continue to checkout'}</Link>}
                            </div>}
                        </article>;
                        })}
                    </div>
            <section className="public-plan-details" aria-labelledby="capabilities-title">
                <h2 id="capabilities-title">What you can try today.</h2>
                <div className="public-comparison">
                    <table>
                        <caption className="sr-only">Capabilities and their current availability in the QS-VC demo</caption>
                        <thead><tr><th scope="col">Capability</th><th scope="col">Current demo status</th></tr></thead>
                        <tbody>{capabilities.map(([name, status]) => <tr key={name}><th scope="row">{name}</th><td data-label="Current demo status">{status}</td></tr>)}</tbody>
                    </table>
                </div>
            </section>
            <section className="public-plan-details" id="recording-status" aria-labelledby="recording-status-title">
                <h2 id="recording-status-title">Recording requires Pro and configured storage.</h2>
                <p>Signed-in hosts with access can record meetings when storage is configured. Storage capacity, participant notices, access and retention terms need to be agreed before a rollout.</p>
            </section>
            <section className="public-plan-details" id="deployment-considerations" aria-labelledby="deployment-title">
                <h2 id="deployment-title">Start with your requirements.</h2>
                <p>Identify who needs to join, the devices they use and where meeting data may be processed. Then review your network, account access and hosting needs. Security features and offline operation require separate validation.</p>
            </section>
            <section className="public-faq" aria-labelledby="plans-questions-title">
                <h2 id="plans-questions-title">Before you decide.</h2>
                <div>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<span className="mi" aria-hidden="true">add</span></summary><p>{answer}</p></details>)}</div>
            </section>
        </main>
        <SiteFooter />
    </div>;
}
