import { useNavigate } from 'react-router-dom';

const stats = [
    { value: '256-bit', label: 'Post-Quantum Encryption' },
    { value: '<100ms', label: 'Ultra-Low Latency' },
    { value: '1000+', label: 'Participants per Call' },
    { value: '22+', label: 'Indian Languages' },
];

const features = [
    {
        icon: 'shield',
        title: 'Quantum-Safe Security',
        desc: 'First-ever post-quantum encrypted video conferencing with Kyber + Dilithium. Future-proof against quantum computer attacks.',
        accent: 'var(--accent-secondary)',
    },
    {
        icon: 'smart_toy',
        title: 'AI-Powered Meetings',
        desc: 'Real-time captions in 22+ Indian languages, live translation, noise suppression, and AI meeting summaries.',
        accent: 'var(--accent-info)',
    },
    {
        icon: 'groups',
        title: 'Enterprise Scale',
        desc: 'Host meetings with 1000+ participants, breakout rooms, webinars with 10K+ attendees, and PSTN dial-in.',
        accent: 'var(--accent-primary)',
    },
    {
        icon: 'videocam',
        title: 'Crystal Clear Video',
        desc: 'Adaptive bitrate from 4K to audio-only. Works seamlessly even on 2G/3G connections across India.',
        accent: 'var(--accent-warning)',
    },
    {
        icon: 'record_voice_over',
        title: 'Live Translation',
        desc: 'Speak in Hindi, see subtitles in English. Real-time voice-to-voice translation across 100+ languages.',
        accent: '#f472b6',
    },
    {
        icon: 'cloud_done',
        title: 'Cloud & On-Premise',
        desc: 'SaaS for everyone, air-gapped on-premise for banks & government. Your data stays where you want it.',
        accent: 'var(--accent-success)',
    },
];

const comparisons = [
    { feature: 'Post-Quantum Encryption (PQC)', qsvc: true, zoom: false, meet: false },
    { feature: 'End-to-End Encryption', qsvc: true, zoom: true, meet: false },
    { feature: 'AI Captions (22 Indian Languages)', qsvc: true, zoom: false, meet: false },
    { feature: 'Real-Time Translation', qsvc: true, zoom: true, meet: true },
    { feature: 'On-Premise Deployment', qsvc: true, zoom: false, meet: false },
    { feature: 'Air-Gapped (No Internet)', qsvc: true, zoom: false, meet: false },
    { feature: 'Data Residency in India', qsvc: true, zoom: false, meet: false },
    { feature: 'UPI / INR Billing', qsvc: true, zoom: false, meet: false },
    { feature: 'Open-Source Core', qsvc: true, zoom: false, meet: false },
    { feature: '1000+ Participants', qsvc: true, zoom: true, meet: true },
];

const testimonials = [
    {
        quote: 'Finally, a VC solution that takes quantum threats seriously. QS-VC is the future of secure communications.',
        name: 'Dr. Ravi Shankar',
        role: 'CISO, National Bank of India',
        avatar: 'RS',
    },
    {
        quote: 'The AI captioning in Hindi and Tamil is game-changing for our pan-India team meetings.',
        name: 'Priya Mehta',
        role: 'VP Engineering, TechMahindra',
        avatar: 'PM',
    },
    {
        quote: 'Switching from Zoom saved us 45% on licensing while getting better security. No-brainer.',
        name: 'Amit Joshi',
        role: 'IT Director, Infosys BPO',
        avatar: 'AJ',
    },
];

export default function HomePage() {
    const navigate = useNavigate();

    return (
        <div className="home-page">
            {/* Animated background */}
            <div className="home-bg">
                <div className="home-bg-orb home-bg-orb-1" />
                <div className="home-bg-orb home-bg-orb-2" />
                <div className="home-bg-orb home-bg-orb-3" />
                <div className="home-bg-grid" />
            </div>

            {/* Navigation */}
            <nav className="home-nav" id="nav-top">
                <div className="home-nav-inner">
                    <div className="home-nav-logo" onClick={() => navigate('/')}>
                        <span className="mi" style={{ color: 'var(--accent-secondary)', fontSize: 28 }}>verified_user</span>
                        <span className="home-brand">QS-VC</span>
                        <span className="home-brand-tag">Quantum Safe</span>
                    </div>
                    <div className="home-nav-links">
                        <a href="#features" className="home-nav-link">Features</a>
                        <a href="#comparison" className="home-nav-link">Compare</a>
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

            {/* Hero Section */}
            <section className="home-hero" id="hero">
                <div className="home-hero-content">
                    <div className="home-hero-badge">
                        <span className="mi mi-sm">flag</span>
                        Made in India 🇮🇳 &nbsp;·&nbsp; Quantum Safe &nbsp;·&nbsp; AI Powered
                    </div>
                    <h1 className="home-hero-title">
                        The World's First<br />
                        <span className="home-hero-gradient">Quantum-Safe</span><br />
                        Video Conferencing
                    </h1>
                    <p className="home-hero-sub">
                        Unbreakable meetings with post-quantum encryption, AI-powered captions in 22+ Indian languages,
                        and enterprise-grade security — at <strong>half the price</strong> of Zoom.
                    </p>
                    <div className="home-hero-actions">
                        <button className="btn-primary btn-lg" onClick={() => navigate('/app')}>
                            <span className="mi mi-sm">videocam</span>
                            Start Free Meeting
                        </button>
                        <button className="btn-secondary btn-lg" onClick={() => navigate('/pricing')}>
                            <span className="mi mi-sm">payments</span>
                            View Pricing
                        </button>
                    </div>
                    <p className="home-hero-note">No credit card required · Free plan forever · 40-min meetings</p>
                </div>

                {/* Floating Stats */}
                <div className="home-stats">
                    {stats.map((s, i) => (
                        <div className="home-stat" key={i}>
                            <div className="home-stat-value">{s.value}</div>
                            <div className="home-stat-label">{s.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Features Grid */}
            <section className="home-features" id="features">
                <div className="home-section-header">
                    <span className="home-section-badge">Features</span>
                    <h2 className="home-section-title">Everything You Need for Secure Meetings</h2>
                    <p className="home-section-sub">Built from the ground up with quantum-safe security and AI intelligence.</p>
                </div>
                <div className="home-features-grid">
                    {features.map((f, i) => (
                        <div className="home-feature-card" key={i} style={{ '--card-accent': f.accent } as React.CSSProperties}>
                            <div className="home-feature-icon">
                                <span className="mi" style={{ color: f.accent }}>{f.icon}</span>
                            </div>
                            <h3>{f.title}</h3>
                            <p>{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Comparison Table */}
            <section className="home-comparison" id="comparison">
                <div className="home-section-header">
                    <span className="home-section-badge">Compare</span>
                    <h2 className="home-section-title">Why QS-VC Over the Competition?</h2>
                    <p className="home-section-sub">See how QS-VC stacks up against Zoom and Google Meet.</p>
                </div>
                <div className="home-comparison-table-wrap">
                    <table className="home-comparison-table">
                        <thead>
                            <tr>
                                <th>Feature</th>
                                <th className="home-comp-highlight">
                                    <span className="mi mi-sm" style={{ color: 'var(--accent-secondary)' }}>verified_user</span>
                                    QS-VC
                                </th>
                                <th>Zoom</th>
                                <th>Google Meet</th>
                            </tr>
                        </thead>
                        <tbody>
                            {comparisons.map((c, i) => (
                                <tr key={i}>
                                    <td>{c.feature}</td>
                                    <td className="home-comp-highlight">
                                        {c.qsvc ? <span className="mi mi-sm" style={{ color: 'var(--accent-success)' }}>check_circle</span> : <span className="mi mi-sm" style={{ color: 'var(--text-muted)' }}>cancel</span>}
                                    </td>
                                    <td>
                                        {c.zoom ? <span className="mi mi-sm" style={{ color: 'var(--accent-success)' }}>check_circle</span> : <span className="mi mi-sm" style={{ color: 'var(--text-muted)' }}>cancel</span>}
                                    </td>
                                    <td>
                                        {c.meet ? <span className="mi mi-sm" style={{ color: 'var(--accent-success)' }}>check_circle</span> : <span className="mi mi-sm" style={{ color: 'var(--text-muted)' }}>cancel</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Testimonials */}
            <section className="home-testimonials">
                <div className="home-section-header">
                    <span className="home-section-badge">Trusted By Leaders</span>
                    <h2 className="home-section-title">What Our Customers Say</h2>
                </div>
                <div className="home-testimonials-grid">
                    {testimonials.map((t, i) => (
                        <div className="home-testimonial-card" key={i}>
                            <div className="home-testimonial-quote">"{t.quote}"</div>
                            <div className="home-testimonial-author">
                                <div className="home-testimonial-avatar">{t.avatar}</div>
                                <div>
                                    <div className="home-testimonial-name">{t.name}</div>
                                    <div className="home-testimonial-role">{t.role}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* CTA Section */}
            <section className="home-cta">
                <div className="home-cta-inner">
                    <h2>Ready for Quantum-Safe Meetings?</h2>
                    <p>Start for free. No credit card. No setup. Just secure meetings.</p>
                    <div className="home-hero-actions">
                        <button className="btn-primary btn-lg" onClick={() => navigate('/app')}>
                            <span className="mi mi-sm">rocket_launch</span>
                            Get Started Free
                        </button>
                        <button className="btn-outline btn-lg" onClick={() => window.open('mailto:contact@qsvc.com')}>
                            <span className="mi mi-sm">mail</span>
                            Contact Sales
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="home-footer">
                <div className="home-footer-inner">
                    <div className="home-footer-brand">
                        <div className="home-nav-logo">
                            <span className="mi" style={{ color: 'var(--accent-secondary)', fontSize: 24 }}>verified_user</span>
                            <span className="home-brand">QS-VC</span>
                        </div>
                        <p>India's Quantum-Safe Video Conferencing Platform</p>
                    </div>
                    <div className="home-footer-links">
                        <div className="home-footer-col">
                            <h4>Product</h4>
                            <a href="#features">Features</a>
                            <button onClick={() => navigate('/pricing')}>Pricing</button>
                            <a href="#comparison">Compare</a>
                            <button onClick={() => navigate('/app')}>Web App</button>
                        </div>
                        <div className="home-footer-col">
                            <h4>Solutions</h4>
                            <a href="#features">Enterprise</a>
                            <a href="#features">Government</a>
                            <a href="#features">Education</a>
                            <a href="#features">Healthcare</a>
                        </div>
                        <div className="home-footer-col">
                            <h4>Company</h4>
                            <a href="mailto:contact@qsvc.com">Contact</a>
                            <a href="#hero">About</a>
                            <a href="#hero">Careers</a>
                            <a href="#hero">Blog</a>
                        </div>
                    </div>
                </div>
                <div className="home-footer-bottom">
                    <p>© 2026 QS-VC. All rights reserved. Made with ❤️ in India 🇮🇳</p>
                    <div className="home-footer-bottom-links">
                        <a href="#hero">Privacy Policy</a>
                        <a href="#hero">Terms of Service</a>
                        <a href="#hero">Security</a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
