import Signup from './pages/Signup';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Contact from './pages/Contact';
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import PricingPage from './pages/PricingPage';
import PaymentPage from './pages/PaymentPage';
import IntranetPage from './pages/IntranetPage';
import LegalPage from './pages/LegalPage';
import CookiePolicy from './pages/CookiePolicy';
import Landing from './pages/Landing';
import PreMeeting from './pages/PreMeeting';
import MeetingRoom from './pages/MeetingRoom';
import MeetingEnd from './pages/MeetingEnd';
import RecordingPlayback from './pages/RecordingPlayback';
import OrganisationSso from './pages/OrganisationSso';
import SsoComplete from './pages/SsoComplete';
import PersonalSignInComplete from './pages/PersonalSignInComplete';
import AdminDashboard from './pages/AdminDashboard';
import ScheduleMeeting from './pages/ScheduleMeeting';
import WebinarsPage from './pages/WebinarsPage';
import WebinarPreviewPage from './pages/WebinarPreviewPage';
import WebinarRegistrationPage from './pages/WebinarRegistrationPage';
import { EntitlementsProvider } from './lib/entitlements';
import { Gate, UpgradePromptListener } from './components/PlanAccess';

import { useSession } from './lib/use-session';

function OnPremAccess({ children }: { children: ReactNode }) {
    const session = useSession();
    const location = useLocation();
    if (import.meta.env.VITE_DEPLOYMENT !== 'onprem' || session.status === 'authenticated') return <>{children}</>;
    if (session.status === 'anonymous') {
        return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />;
    }
    return <main className="public-container service-page">
        <p role="status">{session.status === 'checking' ? 'Checking your sign-in…' : 'We couldn’t verify your sign-in.'}</p>
        {session.status === 'unavailable' && <button type="button" onClick={() => window.location.reload()}>Try again</button>}
    </main>;
}

export default function App() {
    useEffect(() => {
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const seen = new WeakSet<Element>();
        const played = new WeakSet<Element>();
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting || document.documentElement.classList.contains('qsvc-boot')) continue;
                const node = entry.target as HTMLElement;
                if (played.has(node)) { observer.unobserve(node); continue; }
                if (reduced.matches) continue;
                played.add(node);
                node.animate([
                    { opacity: .35, filter: 'blur(5px)', clipPath: 'inset(0 85% 0 0)' },
                    { opacity: 1, filter: 'blur(0)', clipPath: 'inset(0)' }
                ], { duration: 1100, easing: 'cubic-bezier(.16,1,.3,1)' });
                observer.unobserve(node);
            }
        }, { threshold: .15 });
        const scan = () => document.querySelectorAll('.app-theme h1,.app-theme h2,.app-theme h3,.app-theme h4,.app-theme h5,.app-theme h6').forEach(node => {
            if (!seen.has(node)) { seen.add(node); observer.observe(node); }
        });
        const mutations = new MutationObserver(scan);
        mutations.observe(document.getElementById('root')!, { childList: true, subtree: true });
        const boot = new MutationObserver(() => { scan(); document.querySelectorAll('.app-theme h1,.app-theme h2').forEach(node => { observer.unobserve(node); observer.observe(node); }); });
        boot.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        scan();
        return () => { observer.disconnect(); mutations.disconnect(); boot.disconnect(); };
    }, []);
    useEffect(() => {
        if (import.meta.env.VITE_DEPLOYMENT !== 'onprem') return;
        const controller = new AbortController();
        const check = async () => {
            try {
                const response = await fetch('/api/onprem/trial', { cache: 'no-store', signal: controller.signal });
                if (response.status === 403 && (await response.json()).code === 'ONPREM_TRIAL_EXPIRED') {
                    window.location.reload();
                }
            } catch {
                // The gateway enforces expiry even when a browser cannot poll it.
            }
        };
        void check();
        const timer = window.setInterval(check, 15_000);
        return () => { controller.abort(); window.clearInterval(timer); };
    }, []);
    useEffect(() => {
        let active = true;
        const faces = [
            document.fonts.load('400 16px "IBM Plex Sans"'),
            document.fonts.load('500 16px "IBM Plex Sans"'),
            document.fonts.load('600 16px "IBM Plex Sans"'),
            document.fonts.load('400 24px "Material Symbols Rounded"'),
        ];
        Promise.allSettled(faces).then(() => {
            if (active) window.dispatchEvent(new Event('qsvc:ready'));
        });
        return () => { active = false; };
    }, []);
    return (
        <div className="app-theme">
            <BrowserRouter>
            <EntitlementsProvider>
            <Routes>
                {/* Commercial website */}
                <Route path="/" element={<HomePage />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/request-demo" element={<Contact demo />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/payment" element={<PaymentPage />} />
                <Route path="/intranet" element={<IntranetPage />} />
                <Route path="/terms" element={<LegalPage kind="terms" />} />
                <Route path="/privacy" element={<LegalPage kind="privacy" />} />
                <Route path="/cookies" element={<CookiePolicy />} />

                {/* Application (meeting launcher) */}
                <Route path="/login" element={<Login />} /><Route path="/signup" element={<Signup />} />
                <Route path="/sso/personal/complete" element={<PersonalSignInComplete />} />
                <Route path="/sso/complete" element={<SsoComplete />} />
                <Route path="/organisation/sso" element={<OrganisationSso />} />
                <Route path="/app" element={<OnPremAccess><Landing /></OnPremAccess>} />
                <Route path="/webinars" element={<Gate feature="meeting_scheduling"><WebinarsPage /></Gate>} />
                <Route path="/webinars/:id/preview" element={<Gate feature="meeting_scheduling"><WebinarPreviewPage /></Gate>} />
                <Route path="/webinars/register/:publicId" element={<WebinarRegistrationPage />} />
                <Route path="/schedule" element={<ScheduleMeeting />} />
                <Route path="/meeting/:meetingCode/preview" element={<OnPremAccess><PreMeeting /></OnPremAccess>} />
                <Route path="/meeting/:meetingCode" element={<OnPremAccess><MeetingRoom /></OnPremAccess>} />
                <Route path="/meeting-end" element={<MeetingEnd />} />
                <Route path="/recordings" element={<RecordingPlayback />} />
                <Route path="/recordings/:meetingId" element={<RecordingPlayback />} />
                <Route path="/recordings/shared/:shareToken" element={<RecordingPlayback />} />
                <Route path="/admin" element={<AdminDashboard />} />
            </Routes>
            <UpgradePromptListener />
            </EntitlementsProvider>
            </BrowserRouter>
        </div>
    );
}
