import { playbackFailure, type SpeechDiagnostic } from '../lib/translated-speech-status';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { signaling } from '../lib/signaling';
import { SpeechToTextEngine } from '../lib/speech-to-text';
import { ServerSpeechEngine } from '../lib/server-speech';
import { LANGUAGES, TextToSpeechEngine } from '../lib/realtime-translation';
import { captionLanguageOptions, downloadText, transcriptToSrt, transcriptToText, upsertCaption, type TranscriptEntry } from '../lib/caption-stream';
import CaptionOverlay, { type CaptionEntry } from './CaptionOverlay';

interface RoomCaption { id: string; peerId: string; displayName: string; text: string; language: string; isFinal: boolean; timestamp: number; source?: 'browser' | 'server' }
interface Translated { id: string; target: string; translatedText: string; sourceLanguage: string; peerId: string; displayName: string; timestamp: number }
interface Interim { id: string; peerId: string; displayName: string; text: string; language: string }
interface AsrCapabilities { configured: boolean; available?: boolean; languages?: { code: string; name: string }[]; autoDetect?: boolean; engine?: string; model?: string }
interface Capabilities { configured: boolean; languages: { code: string; name: string; targets?: string[] }[]; processing?: string; asr?: AsrCapabilities; minutes?: { configured: boolean }; transcript?: { saving: boolean } }
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
    /** The live microphone track the meeting sends (selected device, after noise suppression). */
    getMicTrack?: () => MediaStreamTrack | null;
    /** Host or co-host: can save the transcript and create minutes. */
    isHost?: boolean;
    meetingCode?: string;
}

const CONSENT_KEY = 'qsvc:caption-speech-consent';
export function hasCaptionConsent(): boolean { try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; } }
function rememberConsent(on: boolean) { try { if (on) localStorage.setItem(CONSENT_KEY, 'yes'); else localStorage.removeItem(CONSENT_KEY); } catch { /* per-device convenience only */ } }
const same = (a: string, b: string) => a === b || a.split('-')[0] === b.split('-')[0];

/** Captions: speech → server (or browser) recognition → room; translations pushed by the server per chosen language. */
export default function MeetingCaptions({ open, onClose, connected, audioMuted, speakingLanguage, displayName, myPeerId, onSpeakingChange, stopRecognition, translatedSpeaking, onSpeakingLanguageChange, onUseDetectedLanguage, showCaptions, onShowCaptionsChange: setShowCaptions, shareSpeech, onShareSpeechChange, getMicTrack, isHost = false, meetingCode = 'meeting' }: Props) {
    const setShareSpeech = (on: boolean) => { rememberConsent(on); onShareSpeechChange(on); };
    const [captionLanguage, setCaptionLanguage] = useState('original');
    const [hearLanguage, setHearLanguage] = useState('');
    const [voiceEnabled, setVoiceEnabled] = useState(false);
    const [voices, setVoices] = useState<string[]>([]);
    const [capabilities, setCapabilities] = useState<Capabilities>({ configured: false, languages: [] });
    const [allowGoogleTranslation, setAllowGoogleTranslation] = useState(false);
    const [capabilityError, setCapabilityError] = useState('');
    const [status, setStatus] = useState('');
    const [voiceDiagnostic, setVoiceDiagnostic] = useState<SpeechDiagnostic | null>(null);
    const [captions, setCaptions] = useState<CaptionEntry[]>([]);
    const [autoDetect, setAutoDetect] = useState(false);
    const [transcriptSaving, setTranscriptSaving] = useState(false);
    const [minutes, setMinutes] = useState('');
    const [minutesBusy, setMinutesBusy] = useState(false);
    /** False when the meeting server is an older build without transcripts / pushed translations. */
    const [serverUpToDate, setServerUpToDate] = useState(true);
    const panelRef = useRef<HTMLElement>(null);
    const serverAsr = Boolean(capabilities.asr?.available) && ServerSpeechEngine.isSupported() && Boolean(getMicTrack);
    const recognitionSupported = serverAsr || SpeechToTextEngine.isSupported();
    const ttsRef = useRef<TextToSpeechEngine | null>(null);
    const prefs = useRef({ captionLanguage, hearLanguage, voiceEnabled, showCaptions });
    prefs.current = { captionLanguage, hearLanguage, voiceEnabled, showCaptions };

    useEffect(() => {
        const update = () => setVoices(typeof window.speechSynthesis === 'undefined' ? [] : window.speechSynthesis.getVoices().map(voice => voice.lang));
        update(); window.speechSynthesis?.addEventListener('voiceschanged', update);
        return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
    }, []);
    useEffect(() => {
        if (open) panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, [open]);
    useEffect(() => {
        if (!connected) return;
        let active = true;
        setCapabilityError('Checking translation server…');
        signaling.request('translationCapabilities').then((result: Capabilities) => {
            if (!active) return;
            setCapabilities(result);
            setServerUpToDate(Boolean(result.transcript));
            setTranscriptSaving(Boolean(result.transcript?.saving));
            setCapabilityError(result.configured ? '' : 'Translation server is not configured. Original captions are available.');
        }).catch(() => { if (active) setCapabilityError('Translation server is unavailable. Original captions are available.'); });
        const offTranscript = signaling.on('transcriptStateChanged', (params: { saving: boolean }) => setTranscriptSaving(Boolean(params?.saving)));
        return () => { active = false; offTranscript(); };
    }, [connected]);

    // Speech language for server recognition: the meeting's language if the service knows it, else auto.
    const asrLanguages = capabilities.asr?.languages || [];
    const asrLanguage = autoDetect && capabilities.asr?.autoDetect !== false ? 'auto'
        : asrLanguages.find(item => same(item.code, speakingLanguage))?.code || (capabilities.asr?.autoDetect !== false ? 'auto' : speakingLanguage.split('-')[0]);

    // ── Speaking: share my speech ───────────────────────────────────────
    useEffect(() => {
        if (!connected || !shareSpeech || audioMuted || translatedSpeaking) return;
        let active = true;
        if (serverAsr) {
            const engine = new ServerSpeechEngine({
                language: asrLanguage, getTrack: () => getMicTrack?.() || null,
                onError: message => { if (active) { setStatus(message); onShareSpeechChange(false); } },
            });
            setStatus('Sharing speech captions. Audio is processed by your organisation’s QS-VC speech server.');
            const stop = () => { active = false; engine.stop(); };
            stopRecognition.current = stop;
            void engine.start();
            return () => { stop(); if (stopRecognition.current === stop) stopRecognition.current = () => {}; };
        }
        const engine = new SpeechToTextEngine(displayName, {
            language: speakingLanguage, interimResults: true,
            onCaption: (caption) => {
                if (!active) return;
                if (!caption.isFinal) {
                    signaling.request('captionInterim', { id: caption.id, text: caption.text.slice(0, 500), language: speakingLanguage }).catch(() => {});
                    if (prefs.current.showCaptions) setCaptions(previous => upsertCaption(previous, { ...caption, id: `${myPeerId()}:${caption.id}`, isFinal: false, label: 'You' }));
                    return;
                }
                const recognizedAt = performance.now();
                signaling.request('captionPublish', { id: caption.id, text: caption.text, language: speakingLanguage, isFinal: true, allowGoogleTranslation: capabilities.processing === 'google-cloud' && allowGoogleTranslation })
                    .then(() => { performance.measure('qsvc:caption:recognition-to-ack', { start: recognizedAt, end: performance.now() }); })
                    .catch(() => { if (active) setStatus('Could not share that caption. Speech is not being saved.'); });
            },
            onError: (message) => { if (active) { setStatus(message); onShareSpeechChange(false); } },
        });
        setStatus('Sharing speech captions. Your browser may process microphone audio remotely.');
        const stop = () => { active = false; engine.stop(); };
        stopRecognition.current = stop;
        engine.start();
        return () => { stop(); if (stopRecognition.current === stop) stopRecognition.current = () => {}; };
    }, [connected, shareSpeech, audioMuted, speakingLanguage, displayName, stopRecognition, translatedSpeaking, capabilities.processing, allowGoogleTranslation, serverAsr, asrLanguage, getMicTrack, myPeerId]);

    useEffect(() => {
        if (!connected) { onShareSpeechChange(false); setVoiceEnabled(false); setAllowGoogleTranslation(false); setCaptions([]); }
    }, [connected]);

    // ── Listening: tell the server which languages I want ─────────────
    useEffect(() => {
        if (!connected) return;
        const targets = [...new Set([showCaptions ? captionLanguage : 'original', voiceEnabled && hearLanguage ? hearLanguage : 'original'])].filter(target => target !== 'original');
        if (!serverUpToDate) return;
        signaling.request('captionSubscribe', { targets, ...(capabilities.processing === 'google-cloud' ? { allowGoogleTranslation } : {}) })
            .catch(() => setStatus('Could not set your caption language. Original captions are still shown.'));
    }, [connected, showCaptions, captionLanguage, voiceEnabled, hearLanguage, capabilities.processing, allowGoogleTranslation, serverUpToDate]);

    // Translated speech voice.
    useEffect(() => {
        if (!voiceEnabled || !hearLanguage) { ttsRef.current = null; return; }
        setVoiceDiagnostic({ gate: 'sharing', message: 'Waiting for shared speech in a different language. Speakers must enable speech sharing.' });
        const tts = new TextToSpeechEngine({
            language: hearLanguage,
            onSpeakingChange: speaking => { onSpeakingChange(speaking); if (speaking) setVoiceDiagnostic(null); },
            onPlaybackError: code => setVoiceDiagnostic(playbackFailure(code)),
        });
        tts.start(); ttsRef.current = tts;
        return () => { if (ttsRef.current === tts) ttsRef.current = null; tts.dispose(); onSpeakingChange(false); };
    }, [voiceEnabled, hearLanguage, onSpeakingChange]);

    // ── Incoming captions ────────────────────────────────────────────
    useEffect(() => {
        if (!connected) return;
        const show = (entry: CaptionEntry) => { if (prefs.current.showCaptions) setCaptions(previous => upsertCaption(previous, entry)); };
        const offInterim = signaling.on('captionInterim', (caption: Interim) => {
            show({ id: caption.id, speakerName: caption.displayName, text: caption.text, isFinal: false, timestamp: Date.now(), language: caption.language });
        });
        const offFinal = signaling.on('captionReceived', (caption: RoomCaption) => {
            const { captionLanguage: target } = prefs.current;
            const needsTranslation = target !== 'original' && !same(target, caption.language) && capabilities.configured;
            show({ id: caption.id, speakerName: caption.displayName, text: caption.text, isFinal: !needsTranslation, timestamp: caption.timestamp, language: caption.language, label: needsTranslation ? 'Translating…' : 'Original' });
        });
        const offTranslated = signaling.on('captionTranslated', (result: Translated) => {
            const { captionLanguage: target, hearLanguage: voice, voiceEnabled: speak } = prefs.current;
            if (same(result.target, target)) show({ id: result.id, speakerName: result.displayName, text: result.translatedText, isFinal: true, timestamp: result.timestamp, language: result.target, label: 'Translated' });
            if (speak && voice && same(result.target, voice) && result.peerId !== myPeerId()) {
                const tts = ttsRef.current;
                if (!tts?.getBestVoice(voice)) setVoiceDiagnostic({ gate: 'voice', message: 'No device voice matches your selected language.' });
                else tts.speak(result.translatedText, voice);
            }
        });
        const offFailed = signaling.on('captionTranslationFailed', (result: { id: string; target: string; reason: string }) => {
            if (!same(result.target, prefs.current.captionLanguage)) return;
            setCaptions(previous => previous.map(entry => entry.id === result.id ? { ...entry, isFinal: true, label: 'Original · translation unavailable' } : entry));
            setStatus(result.reason === 'busy' ? 'Translation is busy. Some lines are shown in the original language.' : result.reason === 'consent' ? 'The speaker has not allowed this translation provider.' : 'Translation unavailable for the selected caption language.');
        });
        return () => { offInterim(); offFinal(); offTranslated(); offFailed(); };
    }, [connected, capabilities.configured, myPeerId]);

    // ── Transcript and minutes ───────────────────────────────────────
    const toggleTranscript = (enabled: boolean) => {
        signaling.request('setTranscriptSaving', { enabled }).then(result => setTranscriptSaving(Boolean(result?.saving)))
            .catch((error: Error) => {
                if (/method not found/i.test(error.message || '')) { setServerUpToDate(false); setStatus('The meeting server needs the latest update before transcripts can be saved.'); return; }
                setStatus(error.message || 'Could not change transcript saving.');
            });
    };
    const download = async (format: 'txt' | 'srt') => {
        try {
            const result = await signaling.request('getTranscript') as { saving: boolean; entries: TranscriptEntry[] };
            if (!result.entries.length) { setStatus(result.saving ? 'Nothing has been said yet.' : 'The host has not turned on transcript saving.'); return; }
            downloadText(`${meetingCode}-transcript.${format}`, format === 'srt' ? transcriptToSrt(result.entries) : transcriptToText(result.entries, minutes));
        } catch { setStatus('Could not download the transcript.'); }
    };
    const createMinutes = async () => {
        setMinutesBusy(true); setStatus('Writing meeting minutes…');
        try {
            const result = await signaling.request('generateMinutes', {}) as { minutes: string };
            setMinutes(result.minutes); setStatus('Minutes are ready. They are saved with the transcript.');
        } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create minutes.'); }
        finally { setMinutesBusy(false); }
    };

    const outputs = capabilities.configured ? capabilities.languages : [];
    const hasVoice = (code: string) => voices.some(lang => lang === code || lang.split('-')[0] === code.split('-')[0]);
    const name = (code: string, fallback: string) => LANGUAGES.find(item => item.code === code)?.name || LANGUAGES.find(item => item.code.split('-')[0] === code)?.name || fallback;
    const speakOptions = captionLanguageOptions(serverAsr ? asrLanguages : null, speakingLanguage);
    return <>
        {voiceEnabled && voiceDiagnostic && !open && <div className="meeting-notice" role="status" data-speech-gate={voiceDiagnostic.gate}>
            {voiceDiagnostic.message} Original meeting audio stays on.
        </div>}
        {transcriptSaving && <div className="transcript-indicator" role="status"><span className="mi" aria-hidden="true">article</span>Transcript is being saved</div>}
        <CaptionOverlay enabled={showCaptions} captions={captions} fontSize="large" />
        {open && <section ref={panelRef} className="meeting-language-settings" id="meeting-language-settings" role="dialog" aria-labelledby="caption-settings-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
            <div className="caption-settings-head"><h2 id="caption-settings-title">Captions & language</h2><button type="button" className="neu-icon-btn" aria-label="Close language settings" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></div>
            <label htmlFor="meeting-speaking-language">I speak</label>
            <select id="meeting-speaking-language" value={speakingLanguage} onChange={event => onSpeakingLanguageChange(event.target.value)}>{speakOptions.map(lang => <option value={lang.code} key={lang.code}>{lang.label}</option>)}</select>
            {serverAsr && capabilities.asr?.autoDetect !== false && <label className="caption-toggle"><input type="checkbox" checked={autoDetect} onChange={event => setAutoDetect(event.target.checked)} />Detect my language automatically (for mixed-language speech)</label>}
            {!serverAsr && <button type="button" className="btn-text" onClick={onUseDetectedLanguage}>Use browser or region suggestion</button>}
            <p>{serverAsr
                ? 'Your meeting microphone is sent to your organisation’s QS-VC speech server for captions. It is not sent to an outside company.'
                : 'Browser speech recognition may send audio to your browser’s provider. It uses the browser’s microphone, which may differ from your selected meeting device. Only enable it if you agree.'} Captions are shared with this meeting{transcriptSaving ? ' and the host is saving a transcript.' : ' and aren’t saved by QS-VC.'}</p>
            <label className="caption-toggle"><input type="checkbox" checked={shareSpeech} disabled={!connected || !recognitionSupported} onChange={event => { if (!event.target.checked) stopRecognition.current(); setShareSpeech(event.target.checked); setStatus(''); }} />Share my speech as captions</label>
            {capabilities.processing === 'google-cloud' && capabilities.configured && <label className="caption-toggle"><input type="checkbox" checked={allowGoogleTranslation} onChange={event => setAllowGoogleTranslation(event.target.checked)} />Allow Google Cloud to translate my shared caption text</label>}
            <p className="caption-settings-note">{!recognitionSupported ? 'Speech recognition is unavailable in this browser. You can still receive captions.' : audioMuted && shareSpeech ? 'Recognition is paused while your microphone is muted.' : translatedSpeaking && shareSpeech ? 'Recognition is paused while translated audio plays.' : serverAsr ? `Speaking: ${asrLanguage === 'auto' ? 'detected automatically' : name(asrLanguage, asrLanguage)} · server recognition${capabilities.asr?.model ? ` (${capabilities.asr.model})` : ''}.` : `Speaking: ${name(speakingLanguage, speakingLanguage)}. Recognition support depends on your browser.`}</p>
            <label className="caption-toggle"><input type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} />Show meeting captions</label>
            <label htmlFor="caption-output-language">Caption language</label>
            <select id="caption-output-language" value={captionLanguage} onChange={event => { setCaptionLanguage(event.target.value); setCaptions([]); }}><option value="original">Original language</option>{outputs.map(lang => <option value={lang.code} key={lang.code}>{name(lang.code, lang.name)}</option>)}</select>
            <p className="caption-settings-note">Each line is translated once on the meeting server and sent to everyone who chose that language.</p>
            <label htmlFor="heard-output-language">Hear translated audio in</label>
            <select id="heard-output-language" value={hearLanguage} onChange={event => { setVoiceEnabled(false); setHearLanguage(event.target.value); }}><option value="">Choose a language</option>{outputs.map(lang => <option value={lang.code} key={lang.code} disabled={!hasVoice(lang.code)}>{name(lang.code, lang.name)}{hasVoice(lang.code) ? '' : ' · no device voice'}</option>)}</select>
            <label className="caption-toggle"><input type="checkbox" checked={voiceEnabled} disabled={!connected || !hearLanguage || !hasVoice(hearLanguage)} onChange={event => { setVoiceEnabled(event.target.checked); setStatus(''); }} />Listen to translated speech</label>
            <p className="caption-settings-note">Device voices use the browser’s default audio output and may use a remote service. Original audio lowers only while translated speech plays.</p>
            {voiceEnabled && voiceDiagnostic && <div role="status" className="caption-settings-status" data-speech-gate={voiceDiagnostic.gate}>
                {voiceDiagnostic.message} Original meeting audio stays on.
            </div>}
            <h3 className="caption-settings-subhead">Transcript</h3>
            {!serverUpToDate && <p className="caption-settings-note" role="status">This meeting server is running an older version. Transcripts, minutes and translated captions need the updated signaling service — ask your administrator to restart or redeploy it.</p>}
            {serverUpToDate && isHost && <label className="caption-toggle"><input type="checkbox" checked={transcriptSaving} disabled={!connected} onChange={event => toggleTranscript(event.target.checked)} />Save transcript of this meeting (everyone is told)</label>}
            {serverUpToDate && !isHost && <p className="caption-settings-note">{transcriptSaving ? 'The host is saving a transcript of shared captions.' : 'The host can save a transcript of shared captions.'}</p>}
            {transcriptSaving && <div className="caption-actions">
                <button type="button" className="btn-outline" onClick={() => download('txt')}>Download .txt</button>
                <button type="button" className="btn-outline" onClick={() => download('srt')}>Download .srt</button>
                {isHost && capabilities.minutes?.configured && <button type="button" className="btn-outline" disabled={minutesBusy} onClick={createMinutes}>{minutesBusy ? 'Writing minutes…' : 'Create minutes'}</button>}
            </div>}
            {minutes && <div className="caption-minutes"><pre>{minutes}</pre><button type="button" className="btn-text" onClick={() => downloadText(`${meetingCode}-minutes.md`, minutes)}>Download minutes</button></div>}
            <div role="status" className="caption-settings-status">{status || capabilityError}</div>
        </section>}
    </>;
}
