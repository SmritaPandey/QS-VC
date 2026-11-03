import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { readStorageConsent, saveStorageConsent } from '../lib/storage-consent';
import '../styles/cookie-banner.css';

export default function CookieBanner() {
    const [visible, setVisible] = useState(() => readStorageConsent() === null);
    const [settings, setSettings] = useState(false);
    const [preferences, setPreferences] = useState(() => readStorageConsent() === true);
    const heading = useRef<HTMLHeadingElement>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const open = () => { returnFocus.current = document.activeElement as HTMLElement; setPreferences(readStorageConsent() === true); setVisible(true); setSettings(true); };
        window.addEventListener('qsvc:cookie-settings', open);
        return () => window.removeEventListener('qsvc:cookie-settings', open);
    }, []);
    useEffect(() => { if (settings && visible) heading.current?.focus(); }, [settings, visible]);
    if (!visible) return null;
    function choose(allow: boolean) {
        saveStorageConsent(allow); setVisible(false); setSettings(false);
        returnFocus.current?.focus();
    }
    return <section className="cookie-banner" aria-label="Cookies and browser storage"><div><h2 ref={heading} tabIndex={-1}>Your privacy, your choice.</h2><p>Essential storage supports sign-in. Allow optional storage to remember language and sound preferences. <Link to="/cookies">Read our cookie policy</Link>.</p>
        {settings && <div className="cookie-settings"><p><strong>Essential — always on</strong><br />Sign-in and your privacy choice.</p><label><input type="checkbox" checked={preferences} onChange={event => setPreferences(event.target.checked)} /> Remember language and sound preferences</label><p>Analytics and advertising: not used.</p><button type="button" onClick={() => choose(preferences)}>Save settings</button></div>}
    </div><div className="cookie-actions"><button type="button" onClick={() => choose(true)}>Accept</button><button type="button" onClick={() => choose(false)}>Deny</button><button type="button" aria-expanded={settings} onClick={() => setSettings(value => !value)}>Settings</button></div></section>;
}
