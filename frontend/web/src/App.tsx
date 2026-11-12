import Signup from './pages/Signup';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import { EntitlementsProvider } from './lib/entitlements';
import { Gate, TrialEndedPrompt, UpgradePromptListener } from './components/PlanAccess';

export default function App() {
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
                <Route path="/app" element={<Landing />} />
                <Route path="/schedule" element={<Gate feature="meeting_scheduling"><ScheduleMeeting /></Gate>} />
                <Route path="/meeting/:meetingCode/preview" element={<PreMeeting />} />
                <Route path="/meeting/:meetingCode" element={<MeetingRoom />} />
                <Route path="/meeting-end" element={<MeetingEnd />} />
                <Route path="/recordings/:meetingId" element={<RecordingPlayback />} />
                <Route path="/recordings/shared/:shareToken" element={<RecordingPlayback />} />
                <Route path="/admin" element={<AdminDashboard />} />
            </Routes>
            <TrialEndedPrompt />
            <UpgradePromptListener />
            </EntitlementsProvider>
            </BrowserRouter>
        </div>
    );
}
