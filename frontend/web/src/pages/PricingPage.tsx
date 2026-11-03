import ActionContents from '../components/ActionContents';
import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';

export const plans = [
    {
        name: 'Free',
        price: '₹0',
        period: 'forever',
        desc: 'Perfect for personal use and quick meetings.',
        highlight: false,
        features: [
            { text: 'Up to 100 participants', included: true },
            { text: '40-minute meeting limit', included: true },
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
            { text: 'Up to 300 participants', included: true },
            { text: '24-hour meeting limit', included: true },
            { text: 'Full HD video (1080p)', included: true },
            { text: 'Cloud recording (50GB)', included: true },
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
            { text: 'Up to 500 participants', included: true },
            { text: 'Unlimited meeting duration', included: true },
            { text: '4K video support', included: true },
            { text: 'Cloud recording (200GB)', included: true },
            { text: 'AI captions (22 languages)', included: true },
            { text: 'Real-time translation', included: true },
            { text: 'Meeting summaries (AI)', included: true },
            { text: 'Breakout rooms', included: true },
            { text: 'SSO / Google / Microsoft', included: true },
            { text: 'Admin dashboard & analytics', included: true },
        ],
    },
    {
        name: 'Enterprise',
        price: 'Custom',
        period: 'tailored pricing',
        desc: 'For large organizations, banks, government.',
        highlight: false,
        features: [
            { text: '1000+ participants', included: true },
            { text: 'Unlimited everything', included: true },
            { text: 'Post-Quantum Encryption (PQC)', included: true },
            { text: 'End-to-End Encryption (E2EE)', included: true },
            { text: 'On-Premise / Air-Gapped', included: true },
            { text: 'LDAP / Active Directory', included: true },
            { text: 'SIP/H.323 interop', included: true },
            { text: 'Dedicated SLA (99.99%)', included: true },
            { text: 'White-label / Custom branding', included: true },
            { text: 'Dedicated support engineer', included: true },
        ],
    },
];


const capabilities = [
    ['Browser meetings', 'Available in the demo'],
    ['Screen sharing and chat', 'Available in the demo'],
    ['Captions and speech options', 'Depend on browser, device and meeting server'],
    ['Meeting recording', 'Disabled in the demo. Paid recording is planned.'],
    ['Organisation hosting and identity', 'Require a separate deployment review'],
];
const questions = [
    { question: 'Can I buy a plan now?', answer: 'Plans are not available to purchase here. The rates shown are proposed. Confirm pricing, included features and commercial terms before making a purchase decision.' },
    { question: 'Can I record a meeting?', answer: 'Recording is disabled in this demo. A paid option is planned. Recording inclusions, storage and retention terms still need confirmation.' },
    { question: 'Which languages can I use?', answer: 'Available caption languages depend on the configured meeting server. Translated speech also needs a matching voice on your device. Check the language control inside the meeting.' },
    { question: 'Can my organisation run QS-VC internally?', answer: 'An internal deployment needs a review of your network, devices, identity and hosting requirements. This demo does not establish offline or air-gapped operation.' },
];

export default function PricingPage() {
    return <div className="public-site public-plans pricing-page">
        <SiteNav />
        <main id="main-content" className="public-container">
            <header className="public-page-intro">
                <h1>Plan your QS-VC rollout.</h1>
                <p>Try the meeting demo and see which capabilities need a separate rollout.</p>
            </header>
            <p className="public-pricing-notice">Proposed pricing. Rates and inclusions are proposed and require confirmation before purchase.</p>
                    <div className="pricing-grid">
                        {plans.map(plan => <article className={`pricing-card ${plan.highlight ? 'pricing-card-highlight' : ''}`} key={plan.name}>
                            <div className="pricing-card-header"><h2>{plan.name}{plan.name === 'Pro' && <span className="pricing-crown" aria-label="Pro premium plan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5 4 4-7 4 7 5-4-2 12H5L3 6Z" fill="currentColor"/><path d="M6 21h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>}{plan.name === 'Enterprise' && <span className="pricing-corporate" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 7h3M8 11h3M8 15h3M9 21v-3M17 13h1M17 17h1"/></svg></span>}</h2><p className="pricing-desc">{plan.desc}</p></div>
                            <div className="pricing-price"><span className="pricing-amount">{plan.price}</span><span className="pricing-period">{plan.period}</span></div>
                            <p className="pricing-sample-label">Proposed inclusions</p>
                            <ul className="pricing-features">{plan.features.map(feature => <li className={feature.included ? '' : 'pricing-feature-disabled'} key={feature.text}><span className="mi mi-sm" aria-hidden="true">{feature.included ? 'check' : 'remove'}</span><span>{feature.text}{!feature.included && <span className="sr-only">, not included in this proposal</span>}</span></li>)}</ul>
                            <>{plan.name === 'Free' ? <button type="button" className="btn-secondary pricing-current-plan" disabled>Current plan</button> : <Link className={plan.highlight ? 'btn-primary qsvc-action' : 'btn-secondary qsvc-action qsvc-action--secondary'} to={plan.name === 'Enterprise' ? '/contact?interest=Enterprise' : plan.name === 'Free' ? '/app' : `/payment?plan=${plan.name}`}><ActionContents>{plan.name === 'Enterprise' ? 'Contact the team' : 'Get now'}</ActionContents></Link>}</>
                        </article>)}
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
                <h2 id="recording-status-title">Recording is a planned option.</h2>
                <p>Paid recording is intended for teams that need a record of their meetings. It is not enabled or available to buy in this demo. Storage, participant notices, access and retention terms need to be agreed before a rollout.</p>
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
