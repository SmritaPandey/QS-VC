import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import IdentityOptions from '../components/IdentityOptions';
import ActionContents from '../components/ActionContents';
export default function Signup() {
    return <div className="public-site"><SiteNav /><main id="main-content" className="public-container public-auth-layout"><div className="public-auth-copy"><h1>Get started with QS-VC.</h1><p>Enterprise accounts require approval from your organisation. Ask your administrator for access or contact our team.</p><Link className="qsvc-action" to="/contact?interest=Enterprise"><ActionContents>Request an account</ActionContents></Link></div><section className="public-auth-form" aria-label="Sign-up options"><h2>Join your organisation</h2><IdentityOptions /><p>Already have an account? <Link to="/login">Sign in</Link></p></section></main><SiteFooter /></div>;
}
