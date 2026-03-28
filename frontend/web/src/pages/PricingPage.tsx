import { useNavigate } from 'react-router-dom';

const plans = [
    {
        name: 'Free',
        price: '₹0',
        priceUsd: '$0',
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
        cta: 'Get Started Free',
        ctaIcon: 'rocket_launch',
    },
    {
        name: 'Starter',
        price: '₹499',
        priceUsd: '$5.99',
        period: '/user/month',
        desc: 'For small teams that need longer meetings.',
        highlight: false,
        badge: 'SAVE 50% vs Zoom',
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
        cta: 'Start Free Trial',
        ctaIcon: 'start',
    },
    {
        name: 'Pro',
        price: '₹999',
        priceUsd: '$11.99',
        period: '/user/month',
        desc: 'For growing businesses with advanced needs.',
        highlight: true,
        badge: 'MOST POPULAR',
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
        cta: 'Start Free Trial',
        ctaIcon: 'star',
    },
    {
        name: 'Enterprise',
        price: 'Custom',
        priceUsd: '',
        period: 'tailored pricing',
        desc: 'For large organizations, banks, government.',
        highlight: false,
        badge: 'QUANTUM SAFE',
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
        cta: 'Contact Sales',
        ctaIcon: 'mail',
    },
];

const faqs = [
    {
        q: 'How does QS-VC compare to Zoom pricing?',
        a: 'QS-VC offers the same (and more) features at 40-50% lower pricing. Our Starter plan at ₹499/user/month includes features that Zoom charges ₹1,100+ for.',
    },
    {
        q: 'What is Post-Quantum Encryption?',
        a: 'PQC uses algorithms (Kyber + Dilithium) that are resistant to attacks from future quantum computers. QS-VC is the first VC platform to offer this.',
    },
    {
        q: 'Can I deploy on my own servers?',
        a: 'Yes! Our Enterprise plan supports on-premise deployment, including air-gapped environments with no internet connectivity — perfect for banks, defence, and government.',
    },
    {
        q: 'Do you support Indian regional languages?',
        a: 'Yes! Our Pro plan includes AI captions and real-time translation for all 22 scheduled Indian languages including Hindi, Tamil, Telugu, Bengali, Marathi, and more.',
    },
    {
        q: 'Is there a free trial?',
        a: 'Yes! All paid plans include a 14-day free trial. The Free plan is available forever with no credit card required.',
    },
    {
        q: 'What payment methods do you accept?',
        a: 'We accept UPI, credit/debit cards, net banking, and international cards via Razorpay and Stripe. Enterprise billing is available with invoicing.',
    },
];

export default function PricingPage() {
    const navigate = useNavigate();

    return (
        <div className="home-page">
            {/* Background */}
            <div className="home-bg">
                <div className="home-bg-orb home-bg-orb-1" />
                <div className="home-bg-orb home-bg-orb-2" />
            </div>

            {/* Navigation */}
            <nav className="home-nav" id="nav-top">
                <div className="home-nav-inner">
                    <div className="home-nav-logo" onClick={() => navigate('/')}>
                        <span className="mi" style={{ color: 'var(--accent-secondary)', fontSize: 28 }}>verified_user</span>
                        <span className="home-brand">QS-VC</span>
                    </div>
                    <div className="home-nav-links">
                        <button className="home-nav-link" onClick={() => navigate('/')}>Home</button>
                        <button className="home-nav-link" onClick={() => navigate('/pricing')}>Pricing</button>
                        <button className="btn-outline" onClick={() => navigate('/app')}>
                            <span className="mi mi-sm">login</span>
                            Sign In
                        </button>
                        <button className="btn-primary" onClick={() => navigate('/app')}>
                            Start Free
                        </button>
                    </div>
                </div>
            </nav>

            {/* Pricing Header */}
            <section className="pricing-hero">
                <div className="home-section-header">
                    <span className="home-section-badge">Pricing</span>
                    <h1 className="home-section-title" style={{ fontSize: 42 }}>
                        Simple, Transparent Pricing
                    </h1>
                    <p className="home-section-sub">
                        Up to <strong style={{ color: 'var(--accent-secondary)' }}>50% cheaper</strong> than Zoom & Google Meet.
                        No hidden fees. Cancel anytime.
                    </p>
                </div>

                {/* Pricing Cards */}
                <div className="pricing-grid">
                    {plans.map((plan, i) => (
                        <div
                            className={`pricing-card ${plan.highlight ? 'pricing-card-highlight' : ''}`}
                            key={i}
                        >
                            {plan.badge && (
                                <div className={`pricing-badge ${plan.highlight ? 'pricing-badge-primary' : ''}`}>
                                    {plan.badge}
                                </div>
                            )}
                            <div className="pricing-card-header">
                                <h3>{plan.name}</h3>
                                <p className="pricing-desc">{plan.desc}</p>
                            </div>
                            <div className="pricing-price">
                                <span className="pricing-amount">{plan.price}</span>
                                {plan.priceUsd && <span className="pricing-usd">{plan.priceUsd}</span>}
                                <span className="pricing-period">{plan.period}</span>
                            </div>
                            <ul className="pricing-features">
                                {plan.features.map((f, j) => (
                                    <li key={j} className={f.included ? '' : 'pricing-feature-disabled'}>
                                        <span className="mi mi-sm" style={{
                                            color: f.included ? 'var(--accent-success)' : 'var(--text-muted)',
                                            fontSize: 16
                                        }}>
                                            {f.included ? 'check_circle' : 'cancel'}
                                        </span>
                                        {f.text}
                                    </li>
                                ))}
                            </ul>
                            <button
                                className={plan.highlight ? 'btn-primary' : 'btn-secondary'}
                                style={{ width: '100%', marginTop: 'auto' }}
                                onClick={() => plan.name === 'Enterprise' ? window.open('mailto:sales@qsvc.com') : navigate('/app')}
                            >
                                <span className="mi mi-sm">{plan.ctaIcon}</span>
                                {plan.cta}
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            {/* Price Comparison */}
            <section className="pricing-compare">
                <div className="home-section-header">
                    <h2 className="home-section-title">How We Compare</h2>
                    <p className="home-section-sub">Real pricing. Real savings. Real features.</p>
                </div>
                <div className="home-comparison-table-wrap">
                    <table className="home-comparison-table pricing-compare-table">
                        <thead>
                            <tr>
                                <th>Plan Tier</th>
                                <th className="home-comp-highlight">QS-VC</th>
                                <th>Zoom</th>
                                <th>Google Meet</th>
                                <th>PeopleLink</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Free</td>
                                <td className="home-comp-highlight"><strong>₹0</strong> (100 users, 40 min)</td>
                                <td>₹0 (100 users, 40 min)</td>
                                <td>₹0 (100 users, 60 min)</td>
                                <td>N/A</td>
                            </tr>
                            <tr>
                                <td>Starter / Basic</td>
                                <td className="home-comp-highlight"><strong>₹499</strong>/user/mo</td>
                                <td>₹1,100/user/mo</td>
                                <td>₹825/user/mo</td>
                                <td>₹800+/user/mo</td>
                            </tr>
                            <tr>
                                <td>Pro / Business</td>
                                <td className="home-comp-highlight"><strong>₹999</strong>/user/mo</td>
                                <td>₹1,650/user/mo</td>
                                <td>₹1,380/user/mo</td>
                                <td>₹1,200+/user/mo</td>
                            </tr>
                            <tr>
                                <td>Enterprise</td>
                                <td className="home-comp-highlight"><strong>Custom</strong></td>
                                <td>Custom ($25-40)</td>
                                <td>Custom ($25+)</td>
                                <td>Custom</td>
                            </tr>
                            <tr>
                                <td>Quantum-Safe (PQC)</td>
                                <td className="home-comp-highlight"><span className="mi mi-sm" style={{color:'var(--accent-success)'}}>check_circle</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                            </tr>
                            <tr>
                                <td>Indian Language AI</td>
                                <td className="home-comp-highlight"><span className="mi mi-sm" style={{color:'var(--accent-success)'}}>check_circle</span> 22 languages</td>
                                <td>English only</td>
                                <td>Limited</td>
                                <td>Limited</td>
                            </tr>
                            <tr>
                                <td>On-Premise Deploy</td>
                                <td className="home-comp-highlight"><span className="mi mi-sm" style={{color:'var(--accent-success)'}}>check_circle</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--accent-success)'}}>check_circle</span></td>
                            </tr>
                            <tr>
                                <td>UPI / INR Billing</td>
                                <td className="home-comp-highlight"><span className="mi mi-sm" style={{color:'var(--accent-success)'}}>check_circle</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--text-muted)'}}>cancel</span></td>
                                <td><span className="mi mi-sm" style={{color:'var(--accent-success)'}}>check_circle</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* FAQ */}
            <section className="pricing-faq">
                <div className="home-section-header">
                    <h2 className="home-section-title">Frequently Asked Questions</h2>
                </div>
                <div className="pricing-faq-grid">
                    {faqs.map((f, i) => (
                        <div className="pricing-faq-item" key={i}>
                            <h4>
                                <span className="mi mi-sm" style={{ color: 'var(--accent-primary)' }}>help</span>
                                {f.q}
                            </h4>
                            <p>{f.a}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* CTA */}
            <section className="home-cta">
                <div className="home-cta-inner">
                    <h2>Start Your Free Trial Today</h2>
                    <p>14 days free. No credit card required. Cancel anytime.</p>
                    <div className="home-hero-actions">
                        <button className="btn-primary btn-lg" onClick={() => navigate('/app')}>
                            <span className="mi mi-sm">rocket_launch</span>
                            Get Started Free
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="home-footer">
                <div className="home-footer-bottom">
                    <p>© 2026 QS-VC. All rights reserved. Made with ❤️ in India 🇮🇳</p>
                </div>
            </footer>
        </div>
    );
}
