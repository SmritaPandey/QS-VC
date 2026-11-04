import { useSession } from '../lib/use-session';
import { refreshSession } from '../lib/session';
import ThemeSelect from './ThemeSelect';
import ActionContents from './ActionContents';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/public.css';
import BrandLogo from './BrandLogo';
import PublicHelp from './PublicHelp';
import CookieBanner from './CookieBanner';
import useScrollReveal from '../lib/scroll-reveal';

const quickLinks = [
    { to: '/#features', label: 'Meetings', icon: 'videocam' },
    { to: '/pricing', label: 'Plans', icon: 'view_agenda' },
    { to: '/intranet', label: 'Intranet', icon: 'domain' },
    { to: '/contact', label: 'Contact us', icon: 'mail' },
    { to: '/app', label: 'Open meeting app', icon: 'arrow_outward' },
];

export default function SiteNav({ accountAction }: { accountAction?: ReactNode }) {
    const session = useSession();
    const [formVisible, setFormVisible] = useState(false);
    const [open, setOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [dockOpen, setDockOpen] = useState(false);
    const headerRef = useRef<HTMLElement>(null);
    const dockRef = useRef<HTMLElement>(null);
    const dockButton = useRef<HTMLButtonElement>(null);
    const { pathname } = useLocation();
    useScrollReveal(headerRef, pathname);
    useEffect(() => {
        const forms = document.querySelectorAll('.public-auth-form');
        const visible = new Set<Element>();
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
            setFormVisible(visible.size > 0 && window.matchMedia('(max-width:767px)').matches);
        });
        forms.forEach(form => observer.observe(form));
        return () => { observer.disconnect(); setFormVisible(false); };
    }, [pathname]);

    useEffect(() => {
        const header = headerRef.current;
        if (!header || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(([entry]) => {
            setScrolled(!entry.isIntersecting);
            if (entry.isIntersecting) setDockOpen(false);
        });
        observer.observe(header);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setOpen(false); setDockOpen(false);
        if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, [pathname]);
    useEffect(() => {
        if (!dockOpen) return;
        const closeOutside = (event: PointerEvent) => {
            if (!dockRef.current?.contains(event.target as Node)) setDockOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [dockOpen]);
    return <>
        <header ref={headerRef} className="public-header" id="nav-top">
            <a className="public-skip" href="#main-content">Skip to content</a>
            <nav className="public-nav" aria-label="Main navigation">
                <Link className="public-brand" to="/" aria-label="QS-VC home"><BrandLogo /></Link>
                <button className="public-menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="public-nav-links" onClick={() => setOpen(value => !value)}><span className="mi" aria-hidden="true">{open ? 'close' : 'menu'}</span></button>
                <div className="public-nav-links" id="public-nav-links" data-open={open} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); document.querySelector<HTMLButtonElement>('.public-menu-toggle')?.focus(); } }}>
                    <a href="/#features" onClick={() => setOpen(false)}>Meetings</a>
                    <Link to="/pricing" aria-current={pathname === '/pricing' ? 'page' : undefined} onClick={() => setOpen(false)}>Plans</Link>
                    <Link to="/intranet" aria-current={pathname === '/intranet' ? 'page' : undefined} onClick={() => setOpen(false)}>Intranet</Link>
                    <Link to="/contact" aria-current={pathname === '/contact' ? 'page' : undefined} onClick={() => setOpen(false)}>Contact us</Link>
                    <Link className="public-mobile-app" to="/app" onClick={() => setOpen(false)}>Open meeting app <span className="mi" aria-hidden="true">arrow_forward</span></Link>
                    {session.status === 'checking' ? <span role="status">Checking account…</span> : session.status === 'unavailable' ? <button type="button" onClick={() => void refreshSession()}>Retry account</button> : session.status === 'authenticated' ? <Link to="/app" onClick={() => setOpen(false)}>Your meetings</Link> : accountAction || <Link to="/login" aria-current={pathname === '/login' ? 'page' : undefined} onClick={() => setOpen(false)}>Sign in</Link>}
                </div>
                <ThemeSelect />
                <Link className="public-primary public-nav-cta qsvc-action" to="/app"><ActionContents>Open meeting app</ActionContents></Link>
            </nav>
        </header>
        <CookieBanner />
        {scrolled && !formVisible && <aside className="public-floating-nav" ref={dockRef} aria-label="Quick navigation" data-open={dockOpen} onKeyDown={event => { if (event.key === 'Escape') { setDockOpen(false); dockButton.current?.focus(); } }}>
            <div className="public-floating-nav-inner">
                <button className="public-dock-toggle" ref={dockButton} type="button" aria-label={dockOpen ? 'Close quick navigation' : 'Open quick navigation'} aria-expanded={dockOpen} aria-controls="public-dock-links" onClick={() => setDockOpen(value => !value)}><span className="mi" aria-hidden="true">{dockOpen ? 'close' : 'menu'}</span></button>
                <nav id="public-dock-links" aria-label="Page shortcuts">{quickLinks.map(link => link.to.includes('#') ? <a href={link.to} key={link.to} aria-label={link.label} onClick={() => setDockOpen(false)}><span className="mi" aria-hidden="true">{link.icon}</span><span className="public-dock-label">{link.label}</span></a> : <Link to={link.to} key={link.to} aria-label={link.label} aria-current={pathname === link.to ? 'page' : undefined} onClick={() => setDockOpen(false)}><span className="mi" aria-hidden="true">{link.icon}</span><span className="public-dock-label">{link.label}</span></Link>)}
                    <a href="#nav-top" aria-label="Back to top" onClick={() => { setDockOpen(false); requestAnimationFrame(() => headerRef.current?.querySelector<HTMLAnchorElement>('.public-brand')?.focus()); }}><span className="mi" aria-hidden="true">north</span><span className="public-dock-label">Back to top</span></a>
                </nav>
            </div>
        </aside>}
        <PublicHelp key={pathname} navigationOpen={dockOpen || open || formVisible} />
    </>;
}
