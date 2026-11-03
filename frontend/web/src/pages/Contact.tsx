import ActionContents from '../components/ActionContents';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import { AUTH_API } from '../lib/session';

export default function Contact({ demo = false }: { demo?: boolean }) {
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
        const payload = Object.fromEntries(['name', 'email', 'organisation', 'topic', 'message', 'website'].map(key => [key, fields.get(key) || '']));
        if (demo) {
            payload.topic = 'demo';
            payload.message = `${payload.message}\n\nPreferred timing / time zone: ${fields.get('timing') || 'Not specified'}`;
        }
        sending.current = true; setBusy(true); setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/contact`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
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
            <div className="public-auth-copy"><h1>{demo ? 'Request a demo' : 'Contact us'}</h1><p>{demo ? 'Request a walkthrough built around your team’s needs.' : 'Ask about QS-VC, plans or a deployment for your team.'}</p><p>{demo ? 'Explore meetings, languages and enterprise access. We’ll arrange a time that suits your team.' : 'Share your requirements here without opening an email app.'}</p><Link className="public-text-link qsvc-action qsvc-action--secondary" to="/pricing"><ActionContents>Explore the plans</ActionContents></Link>
                {!demo && <Link className="qsvc-action public-demo-link" to="/request-demo"><ActionContents>Request a demo</ActionContents></Link>}
                <dl className="public-contact-details">
                    <div><span className="mi" aria-hidden="true">mail</span><div><dt>Email</dt><dd><a href="mailto:contact@neurq.ai">contact@neurq.ai</a></dd></div></div>
                    <div><span className="mi" aria-hidden="true">location_on</span><div><dt>Headquarters</dt><dd>India</dd></div></div>
                    <div><span className="mi" aria-hidden="true">call</span><div><dt>Enterprise Support</dt><dd>Available for customers</dd></div></div>
                </dl>
            </div>
            {receipt ? <section className="public-contact-success" role="status"><span className="mi" aria-hidden="true">check_circle</span><h2>{demo ? 'Demo request received' : 'Enquiry received'}</h2><p>{demo ? 'Our team will contact you to confirm a time. Your session is not booked yet.' : 'Keep this reference for your enquiry.'}</p><p className="public-receipt">{receipt}</p><Link className="public-primary qsvc-action" to="/app"><ActionContents>Open meeting app</ActionContents></Link></section> : <form className="public-auth-form" onSubmit={submit} aria-busy={busy} aria-label={demo ? "Request a QS-VC demo" : "Contact QS-VC"}>
                <label htmlFor="contact-name">Your name</label><input id="contact-name" name="name" autoComplete="name" required maxLength={100} />
                <label htmlFor="contact-email">Email</label><input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={254} />
                <label htmlFor="contact-organisation">Organisation (optional)</label><input id="contact-organisation" name="organisation" autoComplete="organization" maxLength={150} />
                {!demo && <><label htmlFor="contact-topic">What can we help with?</label><select id="contact-topic" name="topic" defaultValue={interest ? 'pricing' : 'demo'}><option value="demo">Trying QS-VC</option><option value="pricing">Plans and pricing</option><option value="deployment">Organisation deployment</option><option value="support">Help with a meeting</option></select></>}
                {demo && <><label htmlFor="demo-timing">Preferred time (optional)</label><input id="demo-timing" name="timing" maxLength={200} placeholder="Weekday afternoons, IST" /></>}
                <label htmlFor="contact-message">{demo ? 'What would you like to explore?' : 'Your message'}</label><textarea id="contact-message" name="message" required minLength={10} maxLength={demo ? 3500 : 4000} rows={5} defaultValue={interest ? `I’d like to discuss the ${interest} plan.` : ''} />
                <div className="public-honeypot" aria-hidden="true"><label htmlFor="contact-website">Leave this field empty</label><input id="contact-website" name="website" tabIndex={-1} autoComplete="off" /></div>
                <p>We’ll use your details to respond to your request. Read our <Link to="/privacy">Privacy Policy</Link>.</p>
                <p>Include sample details only. Don’t send passwords or confidential meeting content.</p>
                {error && <p role="alert">{error}</p>}
                <button className="public-primary qsvc-action" disabled={busy}><ActionContents>{busy ? 'Sending…' : demo ? 'Request a demo' : 'Send enquiry'}</ActionContents></button>
            </form>}
        </main><SiteFooter /></div>;
}
