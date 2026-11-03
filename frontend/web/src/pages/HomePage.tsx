import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ActionContents from '../components/ActionContents';
import StoryScroll from '../components/StoryScroll';
import MeetingScene from '../components/MeetingScene';
import Portrait from '../components/Portrait';
import SiteFooter from '../components/SiteFooter';
import HeroAmbient from '../components/HeroAmbient';
import SiteNav from '../components/SiteNav';
import '../styles/homepage.css';

const samples = {
    hi: { label: 'हिन्दी', language: 'hi', text: 'क्या सभी प्रस्ताव देख पा रहे हैं?' },
    en: { label: 'English', language: 'en', text: 'Can everyone see the proposal?' },
    te: { label: 'తెలుగు', language: 'te', text: 'అందరికీ ప్రతిపాదన కనిపిస్తోందా?' },
    ja: { label: '日本語', language: 'ja', text: '皆さん、提案書は見えていますか？' },
    es: { label: 'Español', language: 'es', text: '¿Todos pueden ver la propuesta?' },
    zh: { label: '中文', language: 'zh-Hans', text: '大家能看到提案吗？' },
};
export default function HomePage() {
    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [sample, setSample] = useState<keyof typeof samples>('en');
    const [manualSelection, setManualSelection] = useState(false);
    const [exampleHovered, setExampleHovered] = useState(false);
    const [exampleFocused, setExampleFocused] = useState(false);
    const cyclePaused = exampleHovered || exampleFocused;
    const caption = { ...samples[sample], announce: manualSelection };
    useEffect(() => {
        if (manualSelection) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
        let timer: ReturnType<typeof setInterval> | undefined;
        const sync = () => {
            clearInterval(timer);
            if (cyclePaused || document.hidden || reduced.matches || connection?.saveData) return;
            timer = setInterval(() => {
                const keys = Object.keys(samples) as (keyof typeof samples)[];
                setSample(current => keys[(keys.indexOf(current) + 1) % keys.length]);
            }, 3000);
        };
        sync();
        reduced.addEventListener('change', sync);
        connection?.addEventListener('change', sync);
        document.addEventListener('visibilitychange', sync);
        return () => {
            clearInterval(timer);
            reduced.removeEventListener('change', sync);
            connection?.removeEventListener('change', sync);
            document.removeEventListener('visibilitychange', sync);
        };
    }, [manualSelection, cyclePaused]);
    function join(event: FormEvent) {
        event.preventDefault();
        if (code.trim()) navigate(`/meeting/${encodeURIComponent(code.trim().toUpperCase())}/preview`);
    }
    return <div className="public-site public-home">
        <SiteNav />
        <main id="main-content">
            <div className="public-hero-wrap home-overview"><HeroAmbient />
                <section className="home-overview-layout public-container" aria-labelledby="public-home-title">
                    <div className="home-message">
                        <h1 id="public-home-title">One room.<br /><span>Your language.</span></h1>
                        <p className="public-lead">Meet QS-VC. Speak your language. Share your ideas. Stay quantum-safe.</p>
                        <Link className="qsvc-action" to="/app"><ActionContents>Open meeting app</ActionContents></Link>
                        <form className="public-join" onSubmit={join}>
                            <label htmlFor="home-meeting-code">Have an invitation?</label>
                            <div><input id="home-meeting-code" aria-label="Meeting code" placeholder="Enter meeting code" value={code} onChange={event => setCode(event.target.value)} maxLength={30} required /><button className="qsvc-action qsvc-action--secondary" type="submit" disabled={!code.trim()}><ActionContents>Join meeting</ActionContents></button></div>
                            <p>You’ll check your devices before entering.</p>
                        </form>
                    </div>
                    <figure className="home-upright-example" aria-label="Meeting and caption examples" onMouseEnter={() => setExampleHovered(true)} onMouseLeave={() => setExampleHovered(false)} onFocusCapture={() => setExampleFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExampleFocused(false); }}>
                        <MeetingScene variant="hero" upright caption={caption} />
                        <div className="public-sample-switch" role="group" aria-label="Caption example language">{(Object.keys(samples) as (keyof typeof samples)[]).map(key => <button type="button" key={key} lang={samples[key].language} aria-pressed={sample === key} onClick={() => { setManualSelection(true); setSample(key); }}>{samples[key].label}</button>)}</div>
                        <p className="home-example-note">Caption examples. Open Language in your meeting for available languages and voices.</p>
                    </figure>
                </section>
            </div>
            <section className="home-offer-intro public-container home-arrival" id="features" aria-labelledby="home-offer-title"><h2 id="home-offer-title">What QS-VC offers</h2><p>Video meetings, screen sharing, chat and language choices, together in one workspace.</p></section>
            <StoryScroll caption={caption} />
            <section className="home-collaboration public-container" aria-labelledby="collaboration-title">
                <h2 id="collaboration-title">Make room for ideas.</h2>
                <div className="home-collaboration-grid">
                    <article><span className="mi" aria-hidden="true">draw</span><h3>Sketch together</h3><p>Share a whiteboard, choose your pen colour and undo your strokes as ideas take shape.</p></article>
                    <article><span className="mi" aria-hidden="true">poll</span><h3>Hear from everyone</h3><p>Run polls, upvote questions and let hosts share answers without interrupting the conversation.</p></article>
                    <article><span className="mi" aria-hidden="true">edit_note</span><h3>Keep ideas together</h3><p>Write shared notes and exchange supported files up to 32 KB. Save what you need before the room closes.</p></article>
                </div>
            </section>
            <section className="home-expression public-container home-arrival" aria-labelledby="home-expression-title">
                <div className="home-expression-visual" aria-hidden="true"><div className="home-expression-portrait"><Portrait person={2} label="Mei" /><span>Mei</span></div><div className="home-expression-reactions"><span>👏</span><span>❤️</span><span>🎉</span><span className="home-expression-hand"><span className="mi">back_hand</span></span></div><div className="home-expression-sound"><span className="mi">music_note</span><span>Your reactions. Your sound.</span></div></div>
                <div className="home-expression-copy"><h2 id="home-expression-title">A little more expression.</h2><p>Applaud an idea, raise your hand or join in with chat and reactions.</p><p>Pick Chime, Pop or Sparkle, or keep sounds off. Only you hear your chosen sound.</p></div>
            </section>
            <section className="home-meeting-options public-container home-arrival" aria-labelledby="home-options-title">
                <div className="home-options-intro"><h2 id="home-options-title">More ways to meet.</h2><p>Language choices and hosting options for your team.</p></div>
                <div className="home-options-grid">
                    <article className="home-option">
                        <div className="home-option-visual home-option-language" aria-hidden="true"><div className="home-option-visual-top"><span className="mi">translate</span><span>Captions &amp; audio</span></div><div className="home-option-caption"><span>{caption.label}</span><p lang={caption.language}>{caption.text}</p></div><div className="home-option-voice"><span className="mi">volume_up</span><span className="home-option-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span><span>Your language</span></div></div>
                        <span className="home-option-badge">Language options</span><h3>Follow in your language</h3><p>Choose captions and translated audio. Languages and voices depend on your setup and device.</p>
                    </article>
                    <article className="home-option">
                        <div className="home-option-visual home-option-recording" aria-hidden="true"><div className="home-option-visual-top"><span className="mi">video_library</span><span>Meeting recordings</span></div><div className="home-option-record"><span className="mi">lock</span><span>Recording unavailable</span></div><div className="home-option-record-track"><span className="mi">fiber_manual_record</span><span /><span className="mi">lock</span></div></div>
                        <span className="home-option-badge">Paid option · planned</span><h3>Keep a record</h3><p>Recording is not currently available. Paid recording is planned.</p>
                    </article>
                    <article className="home-option">
                        <div className="home-option-visual home-option-network" aria-hidden="true"><div className="home-option-visual-top"><span className="mi">lan</span><span>Your organisation</span></div><div className="home-option-network-map"><span className="home-option-network-person"><span className="mi">person</span></span><span className="home-option-network-hub"><span className="mi">apartment</span></span><span className="home-option-network-person"><span className="mi">person</span></span></div><div className="home-option-network-labels"><span>Office team</span><span>Remote access</span></div></div>
                        <span className="home-option-badge">Organisation hosting</span><h3>Meet on your network</h3><p>Talk to us about private-network hosting and access for travelling colleagues.</p>
                    </article>
                </div>
                <Link className="qsvc-action" to="/pricing"><ActionContents>Explore plans</ActionContents></Link>
            </section>
            <section className="home-security public-container home-arrival" aria-labelledby="home-security-title">
                <div className="home-security-copy"><h2 id="home-security-title">Quantum-safe security</h2><p>Quantum-safe security is part of QS-VC’s design for the long-term privacy of sensitive conversations.</p><p>Check your devices before joining. Control your camera and microphone throughout.</p></div>
                <div className="home-security-visual" aria-hidden="true"><div className="home-security-portrait"><Portrait person={1} label="Arjun" /><span>Arjun</span></div><div className="home-security-choices"><div><span className="mi">videocam</span><span>Camera</span><span>Your choice</span></div><div><span className="mi">mic</span><span>Microphone</span><span>Your choice</span></div><div><span className="mi">translate</span><span>Language</span><span>Your preference</span></div></div></div>
            </section>
            <section className="public-rollout public-container home-arrival" aria-labelledby="rollout-title"><div><h2 id="rollout-title">Plan for your team.</h2><p>Choose online or organisation-hosted meetings. Review private-network access and security requirements with us.</p></div><Link className="qsvc-action qsvc-action--secondary" to="/pricing"><ActionContents>Review the options</ActionContents></Link></section>
            <section className="home-demo public-container home-arrival" aria-labelledby="home-demo-title">
                <div><h2 id="home-demo-title">See QS-VC in action.</h2><p>Explore meetings, language features and team collaboration in a walkthrough shaped around your needs.</p></div>
                <Link className="qsvc-action" to="/request-demo"><ActionContents>Request a demo</ActionContents></Link>
            </section>
            <section className="public-faq public-container" aria-labelledby="public-faq-title"><h2 id="public-faq-title">Before your first meeting.</h2><div><details><summary>Do I need an account?<span className="mi" aria-hidden="true">add</span></summary><p>Join as an invited guest, or sign in to your account.</p></details><details><summary>Which languages can I use?<span className="mi" aria-hidden="true">add</span></summary><p>Open Language for available captions and voices. Some languages offer captions without audio.</p></details><details><summary>Can I check my devices first?<span className="mi" aria-hidden="true">add</span></summary><p>Yes. Set your name and check your camera and microphone before joining.</p></details><details><summary>Can our organisation use an intranet?<span className="mi" aria-hidden="true">add</span></summary><p>Contact us about hosting and remote access. Offline operation needs separate validation.</p></details><details><summary>Can I record a meeting?<span className="mi" aria-hidden="true">add</span></summary><p>Recording is not currently available. Paid recording is planned.</p></details></div></section>
            <section className="public-closing public-container home-arrival"><h2>Your next conversation starts here.</h2><Link className="qsvc-action" to="/app"><ActionContents>Open meeting app</ActionContents></Link></section>
        </main>
        <SiteFooter />
    </div>;
}
