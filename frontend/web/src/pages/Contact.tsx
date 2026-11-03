import ActionContents from '../components/ActionContents';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import { AUTH_API } from '../lib/session';

export default function Contact() {
    const [params] = useSearchParams();
    const interest = ['Free', 'Starter', 'Pro', 'Enterprise'].includes(params.get('interest') || '') ? params.get('interest')! : '';
    const [busy, setBusy] = useState(false);
    const sending = useRef(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState('');
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (sending.current) return;
        const fields = new FormData(event.currentTarget);
        sending.current = true; setBusy(true); setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/contact`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(['name', 'email', 'organisation', 'topic', 'message', 'website'].map(key => [key, fields.get(key) || '']))),
                signal: AbortSignal.timeout(15000),
            });
            const data = await response.json();
            if (response.status !== 201 || typeof data.id !== 'string') throw new Error();
            setReceipt(data.id);
        } catch { setError('Your enquiry could not be saved. Please try again.'); }
        finally { sending.current = false; setBusy(false); }
    }
    return <div className="public-site public-contact"><SiteNav />
        <main id="main-content" className="public-container public-auth-layout">
            <div className="public-auth-copy"><h1>Tell us what you need.</h1><p>Ask about QS-VC, plans or a deployment for your team.</p><p>Share your requirements here without opening an email app.</p><Link className="public-text-link qsvc-action qsvc-action--secondary" to="/pricing"><ActionContents>Explore the plans</ActionContents></Link></div>
            {receipt ? <section className="public-contact-success" role="status"><span className="mi" aria-hidden="true">check_circle</span><h2>Your enquiry has been saved.</h2><p>Keep this reference for your enquiry.</p><p className="public-receipt">{receipt}</p><Link className="public-primary qsvc-action" to="/app"><ActionContents>Open meeting app</ActionContents></Link></section> : <form className="public-auth-form" onSubmit={submit} aria-busy={busy} aria-label="Contact QS-VC">
                <label htmlFor="contact-name">Your name</label><input id="contact-name" name="name" autoComplete="name" required maxLength={100} />
                <label htmlFor="contact-email">Email</label><input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={254} />
                <label htmlFor="contact-organisation">Organisation (optional)</label><input id="contact-organisation" name="organisation" autoComplete="organization" maxLength={150} />
                <label htmlFor="contact-topic">What can we help with?</label><select id="contact-topic" name="topic" defaultValue={interest ? 'pricing' : 'demo'}><option value="demo">Trying QS-VC</option><option value="pricing">Plans and pricing</option><option value="deployment">Organisation deployment</option><option value="support">Help with a meeting</option></select>
                <label htmlFor="contact-message">Your message</label><textarea id="contact-message" name="message" required minLength={10} maxLength={4000} rows={5} defaultValue={interest ? `I’d like to discuss the ${interest} plan.` : ''} />
                <div className="public-honeypot" aria-hidden="true"><label htmlFor="contact-website">Leave this field empty</label><input id="contact-website" name="website" tabIndex={-1} autoComplete="off" /></div>
                <p>Include sample details only. Don’t send passwords or confidential meeting content.</p>
                {error && <p role="alert">{error}</p>}
                <button className="public-primary qsvc-action" disabled={busy}><ActionContents>{busy ? 'Sending enquiry…' : 'Send enquiry'}</ActionContents></button>
            </form>}
        </main><SiteFooter /></div>;
}
