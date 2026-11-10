import '../styles/pricing-comparison.css';
import { Link, useSearchParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import CurrencyRateSelector from '../components/CurrencyRateSelector';
import { PAID_PLAN_NAMES, TRIAL_DAYS, getPlanPrice, type BillingPeriod, type PaidPlanKey } from '../../../../shared/payment-pricing.mjs';
import { formatConvertedAmount, useCurrencyRates } from '../lib/currency-rates';
import { useSession } from '../lib/use-session';
import { useEntitlements } from '../lib/entitlements';
import PLAN_LEVEL from '../../../../shared/plan-levels.json';

export const plans = PAID_PLAN_NAMES.map(name => ({
    name,
    key: name.toLowerCase() as PaidPlanKey,
    desc: {
        Basic: 'Everyday meetings for individuals and small teams.',
        Starter: 'Scheduling and captions for growing teams.',
        Pro: 'Multilingual meetings and cloud recording.',
        Business: 'Pro meeting tools for organisations.',
    }[name],
    icon: {
        Basic: 'person',
        Starter: 'calendar_month',
        Pro: 'workspace_premium',
        Business: 'groups',
    }[name],
    offer: {
        Basic: { percent: 50, label: '50% off for 3 months' },
        Starter: null,
        Pro: { percent: 20, label: '20% off first month' },
        Business: null,
    }[name],
    features: {
        Basic: ['Browser meetings', 'HD video, screen sharing and chat', 'Host controls', 'Background effects', 'AI noise suppression'],
        Starter: ['Everything in Basic', 'Meeting scheduling', 'AI captions where available', 'Private conversations up to 30 minutes'],
        Pro: ['Everything in Starter', 'Cloud recording where available', 'Live translation where available', 'Private conversations without a plan time cap'],
        Business: ['Pro meeting features', 'Shared screen and chat', 'Meeting scheduling', 'Cloud recording where available'],
    }[name],
}));

const enterpriseFeatures = [
    'Deployment sized for your organisation', 'On-premises or air-gapped installation options',
    'SIP / H.323 room device options', 'White-label branding options', 'Support and SLA by agreement',
];

const capabilities = [
    ['Browser meetings', 'Available in the demo'],
    ['Screen sharing and chat', 'Available in the demo'],
    ['Captions and speech options', 'Check the Language menu in your meeting'],
    ['Meeting recording', 'Available to eligible signed-in hosts where recording is offered'],
    ['Organisation hosting and identity', 'Contact sales for options'],
];
const questions = [
    { question: 'Can I buy a plan now?', answer: 'Open checkout to see available payment methods. You’ll see the total and renewal terms before you approve payment.' },
    { question: 'Can I record a meeting?', answer: 'Signed-in hosts can record with Pro or an approved enterprise plan where recording is available. Hosts can download, share or delete their recordings.' },
    { question: 'Which languages can I use?', answer: 'Open Language in your meeting to see available captions and audio. Some languages offer captions only.' },
    { question: 'Can my organisation run QS-VC internally?', answer: 'Talk to us about a private workspace. We can discuss which devices and features your team needs, including offline access.' },
];

export default function PricingPage() {
    const [params, setParams] = useSearchParams();
    const billing: BillingPeriod = params.get('billing') === 'annual' ? 'annual' : 'monthly';
    const setBilling = (period: BillingPeriod) => setParams({ billing: period }, { replace: true });
    const currencyRates = useCurrencyRates();
    const annual = billing === 'annual';
    const formatPrice = (amount: number) => currencyRates.displayCurrency === 'INR'
        ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)
        : formatConvertedAmount(amount, currencyRates.displayCurrency, currencyRates.rates);
    const session = useSession();
    const entitlements = useEntitlements();
    const isAdmin = entitlements.isPlatformAdmin || session.profile?.role === 'admin';
    const eligibleForTrial = !isAdmin && entitlements.plan === 'guest' && !entitlements.trialUsed
        && entitlements.status === 'paid_active' && !entitlements.loading && session.status !== 'checking';

    return <div className="public-site public-plans pricing-page">
        <SiteNav />
        <main id="main-content" className="public-container">
            <section className="pricing-comparison" aria-labelledby="pricing-title">
                <header className="public-page-intro pricing-comparison-intro">
                    <h1 id="pricing-title">Find your QS-VC plan</h1>
                    <p>Start with 14 days free. Choose the plan and billing option that suit your team.</p>
                </header>
                <div className="pricing-comparison-controls">
                    <div className="pricing-billing-switch" role="group" aria-label="Billing period">
                        <button type="button" aria-pressed={!annual} onClick={() => setBilling('monthly')}>Monthly</button>
                        <button type="button" aria-pressed={annual} onClick={() => setBilling('annual')}>
                            Annual <span className="pricing-switch-savings">Save up to 17%</span>
                        </button>
                    </div>
                    <CurrencyRateSelector id="pricing-currency" value={currencyRates} />
                    <p className="pricing-billing-terms" role="status">{annual
                        ? 'Annual rate, billed monthly for up to 12 payments. Cancel future renewals anytime.'
                        : 'Pay month to month. Cancel anytime.'}</p>
                </div>
                {isAdmin && <p className="pricing-admin-note">Your admin access includes all plans. <Link to="/app">Go to meetings</Link></p>}
                <p className="pricing-promotion-notice"><span className="mi" aria-hidden="true">sell</span><span>Introductory offer preview. Checkout currently uses regular prices.</span></p>
                <div className="pricing-offer-grid">
                    {plans.map(plan => {
                        const price = getPlanPrice(plan.key, billing)!;
                        const savings = annual ? 12 * (getPlanPrice(plan.key)!.baseAmountMinor - price.baseAmountMinor) / 100 : 0;
                        const checkout = `/payment?plan=${plan.name}&billing=${billing}`;
                        const alreadyIncluded = entitlements.status === 'paid_active'
                            && PLAN_LEVEL[entitlements.plan] >= PLAN_LEVEL[plan.key];
                        const featured = plan.key === (annual ? 'pro' : 'basic');
                        const offerPrice = plan.offer
                            ? Math.round(price.baseAmountMinor * (100 - plan.offer.percent) / 100)
                            : price.baseAmountMinor;
                        return <article className={featured ? 'pricing-offer pricing-offer-featured' : 'pricing-offer'} id={`plan-${plan.key}`} key={plan.key}>
                            <div className="pricing-offer-header">
                                <div className="pricing-offer-title">
                                    <span className="mi pricing-plan-icon" aria-hidden="true">{plan.icon}</span>
                                    <h2>{plan.name}</h2>
                                </div>
                                {featured && <span className="pricing-offer-recommended">Recommended</span>}
                                <p>{plan.desc}</p>
                            </div>
                            <div className="pricing-offer-promotion">
                                {plan.offer && <span className="pricing-discount-label">{plan.offer.label}</span>}
                            </div>
                            <div className="pricing-offer-rate">
                                <div className="pricing-offer-amount">
                                    <strong>{formatPrice(offerPrice / 100)}</strong>
                                    {plan.offer && <span className="pricing-regular-price"><span className="sr-only">Regular price </span><s>{formatPrice(price.baseAmountMinor / 100)}</s></span>}
                                </div>
                                <p>Per user/month{annual ? ', billed monthly' : ''}</p>
                                {plan.offer && <p className="pricing-offer-renewal">Offer preview. Regular rate {formatPrice(price.baseAmountMinor / 100)}/user/month.</p>}
                                {savings > 0 && <p className="pricing-offer-savings">Annual rate saves {formatPrice(savings)} a year</p>}
                            </div>
                            <div className="pricing-offer-actions">
                                {isAdmin || alreadyIncluded ? <span className="pricing-offer-account-status">
                                    {isAdmin ? 'Included with admin access' : entitlements.plan === plan.key ? 'Current plan' : 'Included in your plan'}
                                </span> : <>
                                    <Link className="pricing-offer-action" to={eligibleForTrial ? `${checkout}&trial=1` : checkout}>
                                        {eligibleForTrial ? `Try free for ${TRIAL_DAYS} days` : 'Continue to checkout'}<span className="sr-only"> ({plan.name})</span>
                                    </Link>
                                    {eligibleForTrial && <span className="pricing-trial-note">No plan fee for 14 days</span>}
                                </>}
                            </div>
                            <ul className="pricing-offer-features">
                                {plan.features.map(feature => <li key={feature}><span className="mi mi-sm" aria-hidden="true">check</span><span>{feature}</span></li>)}
                            </ul>
                        </article>;
                    })}
                    <article className="pricing-offer" id="plan-enterprise">
                        <div className="pricing-offer-header">
                            <div className="pricing-offer-title"><span className="mi pricing-plan-icon" aria-hidden="true">apartment</span><h2>Enterprise</h2></div>
                            <p>Quantum-Premise for private deployments and room systems.</p>
                        </div>
                        <div className="pricing-offer-promotion" />
                        <div className="pricing-offer-rate">
                            <div className="pricing-offer-amount"><strong>Let’s talk</strong></div>
                            <p>Tailored pricing for your organisation</p>
                        </div>
                        <div className="pricing-offer-actions"><Link className="pricing-offer-action" to="/contact?interest=Enterprise">Contact sales</Link></div>
                        <ul className="pricing-offer-features">
                            {enterpriseFeatures.map(feature => <li key={feature}><span className="mi mi-sm" aria-hidden="true">check</span><span>{feature}</span></li>)}
                        </ul>
                    </article>
                </div>
                <div className="pricing-free-row" id="plan-free">
                    <div className="pricing-free-plan">
                        <span className="mi pricing-plan-icon" aria-hidden="true">videocam</span>
                        <div><h2>Free · {formatPrice(0)} forever</h2><p>Browser meetings, screen sharing and chat. No card needed.</p></div>
                    </div>
                    <Link className="pricing-offer-action" to="/app">Start free</Link>
                </div>
                <p className="pricing-offer-fine-print">One {TRIAL_DAYS}-day free trial per eligible account, with an approved payment method. Introductory offers are for new customers, one per account. Crossed-out prices show the regular rate. Currency conversions are estimates. Review your price and renewal terms at checkout.</p>
            </section>
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
                <h2 id="recording-status-title">Meeting recording for signed-in hosts</h2>
                <p>Eligible hosts can record in workspaces that offer recording. Ask us about storage limits, access and how long you can keep recordings.</p>
            </section>
            <section className="public-plan-details" id="deployment-considerations" aria-labelledby="deployment-title">
                <h2 id="deployment-title">Start with your requirements.</h2>
                <p>Talk to us about where your team meets, which devices they use and what you need to keep private or available offline.</p>
            </section>
            <section className="public-faq" aria-labelledby="plans-questions-title">
                <h2 id="plans-questions-title">Before you decide.</h2>
                <div>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<span className="mi" aria-hidden="true">add</span></summary><p>{answer}</p></details>)}</div>
            </section>
        </main>
        <SiteFooter />
    </div>;
}
