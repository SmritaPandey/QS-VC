import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import { plans } from './PricingPage';
import '../styles/payment.css';

export default function PaymentPage() {
    const [params] = useSearchParams();
    const plan = plans.find(item => item.name === params.get('plan') && ['Starter', 'Pro'].includes(item.name));
    const [gateway, setGateway] = useState('Razorpay');
    return <div className="public-site"><SiteNav /><main id="main-content" className="public-container payment-page">
        <Link to="/pricing">← Back to plans</Link>
        <header className="public-page-intro"><h1>Your next step with QS-VC.</h1><p>Review your plan and choose your preferred payment gateway.</p></header>
        {!plan ? <section className="payment-summary"><h2>Choose a plan first.</h2><p>Select Starter or Pro to review payment options.</p><Link to="/pricing">View plans</Link></section> : <div className="payment-layout">
            <section className="payment-summary" aria-labelledby="order-title"><span className="payment-eyebrow">YOUR PLAN</span><h2 id="order-title">QS-VC {plan.name}</h2><p>{plan.desc}</p><p className="payment-price">{plan.price}<span>{plan.period}</span></p><p>One user · Monthly plan</p><p className="payment-note">Proposed rate. Final price, taxes and included features must be confirmed before payment.</p><Link to="/pricing">Change plan</Link></section>
            <section className="payment-options" aria-labelledby="gateway-title"><h2 id="gateway-title">Choose a payment gateway</h2><fieldset><legend className="sr-only">Payment gateway</legend>{['Razorpay', 'PayPal'].map(name => <label className={`payment-gateway${gateway === name ? ' is-selected' : ''}`} key={name}><input type="radio" name="gateway" value={name} checked={gateway === name} onChange={() => setGateway(name)} /><span><strong>{name}</strong><small>Provider-hosted secure checkout</small></span><span className="mi" aria-hidden="true">lock</span></label>)}</fieldset><p className="payment-note">Payment details will be entered directly with the connected provider, not on QS-VC.</p><div className="payment-status" role="status"><span className="mi" aria-hidden="true">info</span><p>Online payments are not enabled yet. No payment will be taken.</p></div><button className="btn-primary" type="button" disabled>Continue with {gateway}</button><Link className="payment-contact" to={`/contact?interest=${plan.name}`}>Contact us about this plan</Link></section>
        </div>}
    </main><SiteFooter /></div>;
}
