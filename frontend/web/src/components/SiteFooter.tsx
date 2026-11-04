import ActionContents from './ActionContents';
import { refreshSession } from '../lib/session';
import { useSession } from '../lib/use-session';
import { Link } from 'react-router-dom';

export default function SiteFooter() {
    const session = useSession();
    return <footer className="site-footer">
        <div className="footer-grid">
            <nav className="footer-column" aria-label="Product links"><h3>Product</h3><ul className="footer-links"><li><Link to="/">Website</Link></li><li><Link to="/app">Meeting app</Link></li><li><Link to="/pricing">Plans</Link></li><li><Link to="/intranet">Intranet access</Link></li></ul></nav>
            <nav className="footer-column" aria-label="Meeting links"><h3>Meetings</h3><ul className="footer-links"><li><Link to="/app">Create or join</Link></li><li><Link to="/schedule">Schedule a meeting</Link></li></ul></nav>
            <nav className="footer-column" aria-label="Explore links"><h3>Contact</h3><ul className="footer-links"><li><Link to="/contact">Contact us</Link></li><li><Link to="/contact?interest=Enterprise">Discuss a deployment</Link></li><li><a href="/#public-faq-title">Questions</a></li><li>{session.status === 'authenticated' ? <Link to="/app">Your meetings</Link> : session.status === 'anonymous' ? <Link to="/login">Sign in</Link> : session.status === 'unavailable' ? <button type="button" onClick={() => void refreshSession()}>Retry account</button> : <span role="status">Checking account…</span>}</li></ul></nav>
            <div className="footer-brand"><h3>A place for your next conversation.</h3><p>Meet, share and follow along.</p><Link to="/app" className="qsvc-action"><ActionContents>Open meeting app</ActionContents></Link></div>
        </div>
        <div className="footer-meta"><p>© {new Date().getFullYear()} QS-VC. Owned by Neurq AI Private Limited. All rights reserved.</p><Link to="/terms">Terms and conditions</Link><Link to="/privacy">Privacy policy</Link><Link to="/cookies">Cookie policy</Link><button type="button" onClick={() => window.dispatchEvent(new Event('qsvc:cookie-settings'))}>Cookie settings</button><a href="#nav-top">Back to top <span className="mi mi-sm" aria-hidden="true">north</span></a></div>
        <div className="footer-wordmark-static"><Link to="/" aria-label="QS-VC home">QS-VC</Link></div>
    </footer>;
}
