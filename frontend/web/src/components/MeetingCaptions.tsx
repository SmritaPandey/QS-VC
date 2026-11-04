import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { signaling } from '../lib/signaling';
import { SpeechToTextEngine } from '../lib/speech-to-text';
import { LANGUAGES, TextToSpeechEngine } from '../lib/realtime-translation';
import CaptionOverlay, { type CaptionEntry } from './CaptionOverlay';

interface RoomCaption { id: string; peerId: string; displayName: string; text: string; language: string; isFinal: boolean; timestamp: number }
interface Capabilities { configured: boolean; languages: { code: string; name: string; targets?: string[] }[]; processing?: string }
interface Props {
    open: boolean; onClose: () => void; connected: boolean; audioMuted: boolean; translatedSpeaking: boolean;
    speakingLanguage: string; onSpeakingLanguageChange: (code: string) => void; onUseDetectedLanguage: () => void; displayName: string; myPeerId: () => string;
    stopRecognition: MutableRefObject<() => void>;
    onSpeakingChange: (speaking: boolean) => void;
    /** Controlled from the CC button in the control bar. */
    showCaptions: boolean;
    onShowCaptionsChange: (on: boolean) => void;
    shareSpeech: boolean;
    onShareSpeechChange: (on: boolean) => void;
}

const CONSENT_KEY = 'qsvc:caption-speech-consent';
export function hasCaptionConsent(): boolean { try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; } }
function rememberConsent(on: boolean) { try { if (on) localStorage.setItem(CONSENT_KEY, 'yes'); else localStorage.removeItem(CONSENT_KEY); } catch { /* per-device convenience only */ } }

/** Explicit browser recognition consent and independent listener preferences. No provider fallback. */
export default function MeetingCaptions({ open, onClose, connected, audioMuted, speakingLanguage, displayName, myPeerId, onSpeakingChange, stopRecognition, translatedSpeaking, onSpeakingLanguageChange, onUseDetectedLanguage, showCaptions, onShowCaptionsChange: setShowCaptions, shareSpeech, onShareSpeechChange }: Props) {
    const setShareSpeech = (on: boolean) => { rememberConsent(on); onShareSpeechChange(on); };
    const [captionLanguage, setCaptionLanguage] = useState('original');
    const [hearLanguage, setHearLanguage] = useState('');
    const [voiceEnabled, setVoiceEnabled] = useState(false);
    const [voices, setVoices] = useState<string[]>([]);
    const [capabilities, setCapabilities] = useState<Capabilities>({ configured: false, languages: [] });
    const [allowGoogleTranslation, setAllowGoogleTranslation] = useState(false);
    const [capabilityError, setCapabilityError] = useState('');
    const [status, setStatus] = useState('');
    const [captions, setCaptions] = useState<CaptionEntry[]>([]);
    const panelRef = useRef<HTMLElement>(null);
    const recognitionSupported = SpeechToTextEngine.isSupported();
    const generation = useRef(0);

    useEffect(() => {
        const update = () => setVoices(typeof window.speechSynthesis === 'undefined' ? [] : window.speechSynthesis.getVoices().map(voice => voice.lang));
        update(); window.speechSynthesis?.addEventListener('voiceschanged', update);
        return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
    }, []);
    useEffect(() => {
        if (open) panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, [open]);
    useEffect(() => {
        if (!open || !connected) return;
        let active = true;
        setCapabilityError('Checking translation server…');
        signaling.request('translationCapabilities').then((result: Capabilities) => {
            if (!active) return;
            setCapabilities(result);
            setCapabilityError(result.configured ? '' : 'Translation server is not configured. Original captions are available.');
        }).catch(() => { if (active) setCapabilityError('Translation server is unavailable. Original captions are available.'); });
        return () => { active = false; };
    }, [open, connected]);

    useEffect(() => {
        if (!connected || !shareSpeech || audioMuted || translatedSpeaking) return;
        let active = true;
        const engine = new SpeechToTextEngine(displayName, {
            language: speakingLanguage, interimResults: false,
            onCaption: (caption) => {
                if (!active || !caption.isFinal) return;
                signaling.request('captionPublish', { id: caption.id, text: caption.text, language: speakingLanguage, isFinal: true, allowGoogleTranslation: capabilities.processing === 'google-cloud' && allowGoogleTranslation })
                    .catch(() => { if (active) setStatus('Could not share that caption. Speech is not being saved.'); });
            },
            onError: (message) => { if (active) { setStatus(message); onShareSpeechChange(false); } },
        });
        setStatus('Sharing speech captions. Your browser may process microphone audio remotely.');
        const stop = () => { active = false; engine.stop(); };
        stopRecognition.current = stop;
        engine.start();
        return () => { stop(); if (stopRecognition.current === stop) stopRecognition.current = () => {}; };
    }, [connected, shareSpeech, audioMuted, speakingLanguage, displayName, stopRecognition, translatedSpeaking, capabilities.processing, allowGoogleTranslation]);

    useEffect(() => {
        if (!connected) { onShareSpeechChange(false); setVoiceEnabled(false); setAllowGoogleTranslation(false); setCaptions([]); }
    }, [connected]);

    useEffect(() => {
        const revision = ++generation.current;
        let stopped = false;
        let running = false;
        const queue: RoomCaption[] = [];
        const seen = new Set<string>();
        const tts = voiceEnabled ? new TextToSpeechEngine({ language: hearLanguage, onSpeakingChange }) : null;
        tts?.start();
        const current = () => !stopped && revision === generation.current;
        const translate = async (caption: RoomCaption, target: string): Promise<string> => {
            if (target === 'original' || target === caption.language || target.split('-')[0] === caption.language.split('-')[0]) return caption.text;
            const result = await signaling.request('translateCaption', { id: caption.id, target });
            if (typeof result.translatedText !== 'string' || !result.translatedText.trim()) throw new Error('Translation unavailable');
            return result.translatedText;
        };
        const process = async () => {
            if (running) return;
            running = true;
            while (current() && queue.length) {
                const caption = queue.shift()!;
                let text = caption.text;
                let language = caption.language;
                let label = 'Original';
                const results = new Map<string, Promise<string>>();
                const output = (target: string) => {
                    if (!results.has(target)) results.set(target, translate(caption, target));
                    return results.get(target)!;
                };
                if (showCaptions) {
                    try { text = await output(captionLanguage); language = captionLanguage === 'original' ? caption.language : captionLanguage; label = text === caption.text ? 'Original' : 'Translated'; }
                    catch { label = 'Original · translation unavailable'; }
                    if (!current()) break;
                    setCaptions(previous => [...previous.slice(-39), { id: caption.id, speakerName: caption.displayName, text, isFinal: true, timestamp: caption.timestamp, language, label }]);
                }
                if (tts && caption.peerId !== myPeerId() && hearLanguage.split('-')[0] !== caption.language.split('-')[0]) {
                    try {
                        const spoken = await output(hearLanguage);
                        if (current() && !tts.speak(spoken, hearLanguage)) setStatus('No matching voice is available. Original audio stays on.');
                    } catch { if (current()) setStatus('Translated audio is unavailable. Original audio stays on.'); }
                }
            }
            running = false;
        };
        const unsubscribe = signaling.on('captionReceived', (caption: RoomCaption) => {
            if (!current() || (!showCaptions && !voiceEnabled) || !caption.isFinal || seen.has(caption.id)) return;
            seen.add(caption.id); if (seen.size > 100) seen.delete(seen.values().next().value!);
            if (queue.length >= 6) { queue.shift(); setStatus('Captions are catching up. An older segment was skipped.'); }
            queue.push(caption); void process();
        });
        return () => { stopped = true; queue.length = 0; unsubscribe(); tts?.dispose(); onSpeakingChange(false); };
    }, [connected, showCaptions, captionLanguage, voiceEnabled, hearLanguage, myPeerId, onSpeakingChange]);

    const outputs = capabilities.configured ? capabilities.languages : [];
    const hasVoice = (code: string) => voices.some(lang => lang === code || lang.split('-')[0] === code.split('-')[0]);
    const name = (code: string, fallback: string) => LANGUAGES.find(item => item.code === code)?.name || LANGUAGES.find(item => item.code.split('-')[0] === code)?.name || fallback;
    return <>
        <CaptionOverlay enabled={showCaptions} captions={captions} fontSize="large" />
        {open && <section ref={panelRef} className="meeting-language-settings" id="meeting-language-settings" role="dialog" aria-labelledby="caption-settings-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
            <div className="caption-settings-head"><h2 id="caption-settings-title">Captions & language</h2><button type="button" className="neu-icon-btn" aria-label="Close language settings" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></div>
            <label htmlFor="meeting-speaking-language">I speak</label>
            <select id="meeting-speaking-language" value={speakingLanguage} onChange={event => onSpeakingLanguageChange(event.target.value)}>{LANGUAGES.map(lang => <option value={lang.code} key={lang.code}>{lang.nativeName} · {lang.name}</option>)}</select>
            <button type="button" className="btn-text" onClick={onUseDetectedLanguage}>Use browser or region suggestion</button>
            <p>Browser speech recognition may send audio to your browser’s provider. It uses the browser’s microphone, which may differ from your selected meeting device. Only enable it if you agree. Captions are shared with this meeting and aren’t saved by QS-VC.</p>
            <label className="caption-toggle"><input type="checkbox" checked={shareSpeech} disabled={!connected || !recognitionSupported} onChange={event => { if (!event.target.checked) stopRecognition.current(); setShareSpeech(event.target.checked); setStatus(''); }} />Share my speech as captions</label>
            {capabilities.processing === 'google-cloud' && capabilities.configured && <label className="caption-toggle"><input type="checkbox" checked={allowGoogleTranslation} onChange={event => setAllowGoogleTranslation(event.target.checked)} />Allow Google Cloud to translate my shared caption text</label>}
            <p className="caption-settings-note">{!recognitionSupported ? 'Speech recognition is unavailable in this browser. You can still receive captions.' : audioMuted && shareSpeech ? 'Recognition is paused while your microphone is muted.' : translatedSpeaking && shareSpeech ? 'Recognition is paused while translated audio plays.' : `Speaking: ${name(speakingLanguage, speakingLanguage)}. Recognition support depends on your browser.`}</p>
            <label className="caption-toggle"><input type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} />Show meeting captions</label>
            <label htmlFor="caption-output-language">Caption language</label>
            <select id="caption-output-language" value={captionLanguage} onChange={event => { setCaptionLanguage(event.target.value); setCaptions([]); }}><option value="original">Original language</option>{outputs.map(lang => <option value={lang.code} key={lang.code}>{name(lang.code, lang.name)}</option>)}</select>
            <p className="caption-settings-note">Translation uses the configured meeting server. Other speakers must enable speech sharing.</p>
            <label htmlFor="heard-output-language">Hear translated audio in</label>
            <select id="heard-output-language" value={hearLanguage} onChange={event => { setVoiceEnabled(false); setHearLanguage(event.target.value); }}><option value="">Choose a language</option>{outputs.map(lang => <option value={lang.code} key={lang.code} disabled={!hasVoice(lang.code)}>{name(lang.code, lang.name)}{hasVoice(lang.code) ? '' : ' · no device voice'}</option>)}</select>
            <label className="caption-toggle"><input type="checkbox" checked={voiceEnabled} disabled={!connected || !hearLanguage || !hasVoice(hearLanguage)} onChange={event => { setVoiceEnabled(event.target.checked); setStatus(''); }} />Listen to translated speech</label>
            <p className="caption-settings-note">Device voices may use a remote service. Original audio lowers only while translated speech plays. Use headphones.</p>
            <div role="status" className="caption-settings-status">{status || capabilityError}</div>
        </section>}
    </>;
}
