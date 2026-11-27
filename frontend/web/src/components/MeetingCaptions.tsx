import { CAPTION_LANGUAGE_KEY, preferencesAllowed } from '../lib/storage-consent';
import { MeetingVoice } from '../lib/meeting-voice';
import { createPortal } from 'react-dom';
import SelectionInput from './SelectionInput';
import { playbackFailure, type SpeechDiagnostic } from '../lib/translated-speech-status';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { signaling } from '../lib/signaling';
import { SpeechToTextEngine } from '../lib/speech-to-text';
import { ServerSpeechEngine } from '../lib/server-speech';
import { LANGUAGES, TextToSpeechEngine } from '../lib/realtime-translation';
import { captionLanguageOptions, needsCaptionTranslation, supportedSpeechLanguage, downloadText, transcriptToSrt, transcriptToText, upsertCaption, type TranscriptEntry } from '../lib/caption-stream';
import MeetingToast from './MeetingToast';
import CaptionOverlay, { type CaptionEntry } from './CaptionOverlay';

interface RoomCaption { id: string; peerId: string; displayName: string; text: string; language: string; isFinal: boolean; timestamp: number; source?: 'browser' | 'server' }
interface Translated { id: string; target: string; translatedText: string; sourceLanguage: string; peerId: string; displayName: string; timestamp: number }
interface Interim { id: string; peerId: string; displayName: string; text: string; language: string }
interface AsrCapabilities { whisperFallback?: boolean; participants?: { peerId: string; displayName: string }[]; configured: boolean; available?: boolean; languages?: { code: string; name: string }[]; autoDetect?: boolean; engine?: string; model?: string }
interface Capabilities { translatedAudio?: boolean; temporarilyUnavailable?: boolean; configured: boolean; languages: { code: string; name: string; targets?: string[] }[]; processing?: string; asr?: AsrCapabilities; minutes?: { configured: boolean }; transcript?: { saving: boolean } }
interface Props {
    statusHost?: HTMLElement | null;
    open: boolean; onClose: () => void; connected: boolean; audioMuted: boolean; translatedSpeaking: boolean;
    summaryActive?: boolean;
    e2eeActive?: boolean;
    hasSavedSpeakingLanguage: boolean; speakingLanguage: string; onSpeakingLanguageChange: (code: string) => void; onUseDetectedLanguage: () => void; displayName: string; myPeerId: () => string;
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
    /** Guests can choose one caption output and cannot share speech or enable translated voice. */
    canShareSpeech: boolean;
    viewOnly?: boolean;
}

/** Captions: speech → server (or browser) recognition → room; translations pushed by the server per chosen language. */
export default function MeetingCaptions({ statusHost, summaryActive = false, open, onClose, connected, audioMuted, speakingLanguage, hasSavedSpeakingLanguage, displayName, myPeerId, onSpeakingChange, stopRecognition, translatedSpeaking, e2eeActive = false, onSpeakingLanguageChange, onUseDetectedLanguage, showCaptions, onShowCaptionsChange: setShowCaptions, shareSpeech, onShareSpeechChange, getMicTrack, isHost = false, meetingCode = 'meeting', canShareSpeech, viewOnly = false }: Props) {
    const [preferredCaptionLanguage, setPreferredCaptionLanguage] = useState(() => {
        try {
            return (preferencesAllowed() && localStorage.getItem(CAPTION_LANGUAGE_KEY)) || 'original';
        } catch { return 'original'; }
    });
    const [hearLanguage, setHearLanguage] = useState('');
    const [voiceEnabled, setVoiceEnabled] = useState(false);
    const meetingVoice = useRef<MeetingVoice | null>(null);
    const [capabilities, setCapabilities] = useState<Capabilities>({ configured: false, languages: [] });
    const offeredLanguages = capabilities.configured ? capabilities.languages : [];
    const captionLanguage = supportedSpeechLanguage(offeredLanguages, preferredCaptionLanguage) ?? 'original';
    const chooseCaptionLanguage = (language: string) => {
        setPreferredCaptionLanguage(language);
        if (preferencesAllowed()) {
            try { localStorage.setItem(CAPTION_LANGUAGE_KEY, language); } catch { /* Use the choice for this meeting. */ }
        }
        setCaptions([]);
        setShowCaptions(true);
    };
    const [allowServerTranscription, setAllowServerTranscription] = useState(false);
    const [processorParticipants, setProcessorParticipants] = useState<{ peerId: string; displayName: string }[]>([]);
    const [allowGoogleTranslation, setAllowGoogleTranslation] = useState(false);
    const [capabilityError, setCapabilityError] = useState('');
    const [status, setStatus] = useState('');
    const [fallbackNotice, setFallbackNotice] = useState('');
    const fallbackEpisodes = useRef(new Map<string, string>());
    const notifyFallback = useCallback((kind: string, message: string) => {
        if (fallbackEpisodes.current.get(kind) === message) return;
        fallbackEpisodes.current.set(kind, message);
        setFallbackNotice(message);
    }, []);
    useEffect(() => {
        if (!connected || !showCaptions) {
            fallbackEpisodes.current.clear();
            setFallbackNotice('');
        }
    }, [connected, showCaptions]);
    const [voiceDiagnostic, setVoiceDiagnostic] = useState<SpeechDiagnostic | null>(null);
    const [dismissedVoiceDiagnostics, setDismissedVoiceDiagnostics] = useState<Set<string>>(() => new Set());
    const voiceDiagnosticKey = voiceDiagnostic ? `${voiceDiagnostic.gate}:${voiceDiagnostic.message}` : '';
    const dismissVoiceDiagnostic = useCallback(() => {
        setDismissedVoiceDiagnostics(previous => new Set(previous).add(voiceDiagnosticKey));
    }, [voiceDiagnosticKey]);
    const [captions, setCaptions] = useState<CaptionEntry[]>([]);
    const [autoDetect, setAutoDetect] = useState(!hasSavedSpeakingLanguage);
    const [hadTranscript, setHadTranscript] = useState(false);
    const [transcriptSaving, setTranscriptSaving] = useState(false);
    const [transcriptNoticeDismissed, setTranscriptNoticeDismissed] = useState(false);
    useEffect(() => {
        if (transcriptSaving) {
            setHadTranscript(true);
        } else {
            setTranscriptNoticeDismissed(false);
        }
    }, [transcriptSaving]);
    const [minutes, setMinutes] = useState('');
    const [minutesBusy, setMinutesBusy] = useState(false);
    /** False when the meeting server is an older build without transcripts / pushed translations. */
    const [serverUpToDate, setServerUpToDate] = useState(true);
    const panelRef = useRef<HTMLElement>(null);
    const [preferBrowser, setPreferBrowser] = useState(false);
    const [allowBrowser, setAllowBrowser] = useState(false);
    const serverAvailable = Boolean(capabilities.asr?.available) && ServerSpeechEngine.isSupported() && Boolean(getMicTrack);
    const serverAsr = serverAvailable && !preferBrowser;
    const summaryDefaultsApplied = useRef(false);
    const declinedSpeech = useRef(false);
    useEffect(() => {
        if (!connected || !summaryActive) {
            summaryDefaultsApplied.current = false;
            return;
        }
        if (viewOnly || !capabilities.transcript || summaryDefaultsApplied.current) return;
        summaryDefaultsApplied.current = true;
        setShowCaptions(true);
        if (canShareSpeech && serverAsr && allowServerTranscription && !declinedSpeech.current) onShareSpeechChange(true);
    }, [summaryActive, connected, viewOnly, capabilities.transcript, serverAsr, capabilities.asr, allowServerTranscription, canShareSpeech, setShowCaptions, onShareSpeechChange]);
    const recognitionSupported = serverAsr || SpeechToTextEngine.isSupported();
    const ttsRef = useRef<TextToSpeechEngine | null>(null);
    const prefs = useRef({ captionLanguage, hearLanguage, voiceEnabled, showCaptions });
    prefs.current = { captionLanguage, hearLanguage, voiceEnabled, showCaptions };

    useEffect(() => {
        if (open) panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, [open]);
    useEffect(() => {
        if (!connected) return;
        let active = true;
        let processorStateReceived = false;
        setCapabilityError('Checking available caption languages…');
        let retry: number | undefined;
        let delay = 12000;
        const retryLater = () => {
            retry = window.setTimeout(load, delay);
            delay = Math.min(delay * 2, 60000);
        };
        async function load() {
            try {
                const result: Capabilities = await signaling.request('translationCapabilities');
                if (!active) return;
                setCapabilities(result);
                if (!processorStateReceived) setProcessorParticipants(result.asr?.participants || []);
                setServerUpToDate(Boolean(result.transcript));
                setTranscriptSaving(Boolean(result.transcript?.saving));
                setCapabilityError(result.configured ? '' : result.temporarilyUnavailable
                    ? 'Translation is temporarily unavailable. Retrying automatically.'
                    : 'Translated captions are unavailable. You can still view original captions.');
                if (result.temporarilyUnavailable || (result.asr?.configured && !result.asr.available)) retryLater();
            } catch {
                if (!active) return;
                setCapabilityError('Translated captions are unavailable. Retrying automatically.');
                retryLater();
            }
        }
        void load();
        const offProcessor = signaling.on('captionProcessorState', (params: { participants: { peerId: string; displayName: string }[] }) => {
            processorStateReceived = true;
            setProcessorParticipants(params.participants);
        });
        const offTranscript = signaling.on('transcriptStateChanged', (params: { saving: boolean }) => setTranscriptSaving(Boolean(params?.saving)));
        return () => { active = false; window.clearTimeout(retry); offTranscript(); offProcessor(); };
    }, [connected]);

    // Keep the speaker's original language until this listener requests translation.
    useEffect(() => {
        if (capabilities.temporarilyUnavailable || !capabilities.transcript) return;
        const offered = capabilities.configured ? capabilities.languages : [];
        if (preferredCaptionLanguage !== 'original' && captionLanguage === 'original') {
            if (showCaptions) notifyFallback('language', `Captions in ${preferredCaptionLanguage} are unavailable. Showing the original speech.`);
        }
        if (!capabilities.translatedAudio || (hearLanguage && !offered.some(item => item.code === hearLanguage))) {
            setVoiceEnabled(false);
            setHearLanguage('');
        }
    }, [viewOnly, capabilities, preferredCaptionLanguage, captionLanguage, hearLanguage, showCaptions, notifyFallback]);

    // A new connection or encryption transition requires a fresh processor permission.
    useEffect(() => {
        stopRecognition.current();
        setAllowServerTranscription(false);
        setAllowBrowser(false);
        onShareSpeechChange(false);
        if (!connected) setProcessorParticipants([]);
    }, [connected, e2eeActive]);

    useEffect(() => {
        if (!canShareSpeech) {
            onShareSpeechChange(false);
            setAllowServerTranscription(false);
        }
    }, [canShareSpeech, onShareSpeechChange]);

    // Speech language for server recognition: the meeting's language if the service knows it, else auto.
    const asrLanguages = capabilities.asr?.languages || [];
    const asrLanguage = autoDetect && capabilities.asr?.autoDetect !== false ? 'auto'
        : supportedSpeechLanguage(asrLanguages, speakingLanguage);

    // ── Speaking: share my speech & display local captions ────────────────
    useEffect(() => {
        if (!connected || !shareSpeech || !canShareSpeech || audioMuted || translatedSpeaking) return;
        let active = true;
        if (serverAsr && allowServerTranscription && canShareSpeech) {
            if (!asrLanguage) {
                setStatus('Choose an available spoken language to share your speech.');
                onShareSpeechChange(false);
                return;
            }
            if (capabilities.asr?.whisperFallback) {
                notifyFallback('recognition', 'The Indic speech model is unavailable. Whisper is providing captions.');
            } else fallbackEpisodes.current.delete('recognition');
            const engine = new ServerSpeechEngine({
                processorConsent: allowServerTranscription, language: asrLanguage, getTrack: () => getMicTrack?.() || null,
                onError: message => { if (active) { setStatus(message); onShareSpeechChange(false); } },
            });
            setStatus('Your microphone audio is being sent to the transcription processor. Shared captions are readable by the meeting service.');
            const stop = () => { active = false; engine.stop(); };
            stopRecognition.current = stop;
            void engine.start();
            return () => { stop(); if (stopRecognition.current === stop) stopRecognition.current = () => {}; };
        }
        if (!serverAsr && allowBrowser && SpeechToTextEngine.isSupported()) {
            if (!preferBrowser && capabilities.asr?.configured) notifyFallback('recognition', 'Captions are using browser speech recognition. Your browser may send microphone audio to its speech provider.');
            const engine = new SpeechToTextEngine(displayName, {
                language: speakingLanguage, interimResults: true,
                onCaption: (caption) => {
                    if (!active) return;
                    if (prefs.current.showCaptions && !needsCaptionTranslation(speakingLanguage, prefs.current.captionLanguage)) {
                        const peerId = myPeerId();
                        const localCaption = { ...caption, id: `${peerId}:${caption.id}`, peerId, speakerName: `${displayName} (You)`, language: speakingLanguage, receivedAt: Date.now() };
                        setCaptions(previous => upsertCaption(previous, localCaption));
                    }
                    if (!canShareSpeech) return;
                    if (!caption.isFinal) {
                        signaling.request('captionInterim', { id: caption.id, text: caption.text.slice(0, 500), language: speakingLanguage }).catch(() => {});
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
        }
    }, [canShareSpeech, connected, shareSpeech, audioMuted, speakingLanguage, displayName, stopRecognition, translatedSpeaking, capabilities.processing, capabilities.asr?.configured, capabilities.asr?.whisperFallback, notifyFallback, allowGoogleTranslation, allowServerTranscription, allowBrowser, preferBrowser, serverAsr, asrLanguage, getMicTrack, myPeerId]);

    useEffect(() => {
        if (!connected) {
            onShareSpeechChange(false); setVoiceEnabled(false); setAllowGoogleTranslation(false); setCaptions([]);
            setCapabilities({ configured: false, languages: [] });
            setTranscriptSaving(false); setHadTranscript(false); setMinutes(''); setStatus('');
        }
    }, [connected]);

    // ── Listening: tell the server which languages I want ─────────────
    useEffect(() => {
        if (!connected) return;
        const targets = [...new Set([showCaptions ? captionLanguage : 'original', capabilities.translatedAudio && voiceEnabled && hearLanguage ? hearLanguage : 'original'])].filter(target => target !== 'original');
        if (!serverUpToDate) return;
        let current = true;
        signaling.request('captionSubscribe', { targets, ...(capabilities.processing === 'google-cloud' ? { allowGoogleTranslation } : {}) })
            .then(() => { if (current) fallbackEpisodes.current.delete('subscription'); })
            .catch(() => {
                if (!current) return;
                const message = 'Could not connect to caption translation. Showing the original speech.';
                setStatus(message);
                if (showCaptions && captionLanguage !== 'original') notifyFallback('subscription', message);
            });
        return () => { current = false; };
    }, [connected, showCaptions, captionLanguage, voiceEnabled, hearLanguage, capabilities.processing, allowGoogleTranslation, serverUpToDate, capabilities.translatedAudio]);

    // Translated speech voice.
    useEffect(() => {
        if (!capabilities.translatedAudio || !voiceEnabled || !hearLanguage) { ttsRef.current = null; return; }
        setVoiceDiagnostic({ gate: 'sharing', message: 'Waiting for shared speech in a different language. Speakers must enable speech sharing.' });
        const tts = new TextToSpeechEngine({
            language: hearLanguage,
            onSpeakingChange: speaking => { onSpeakingChange(speaking); if (speaking) setVoiceDiagnostic(null); },
            onPlaybackError: code => setVoiceDiagnostic(playbackFailure(code)),
        });
        tts.start(); ttsRef.current = tts;
        return () => { if (ttsRef.current === tts) ttsRef.current = null; tts.dispose(); onSpeakingChange(false); };
    }, [capabilities.translatedAudio, voiceEnabled, hearLanguage, onSpeakingChange]);

    useEffect(() => () => {
        meetingVoice.current?.stop();
        meetingVoice.current = null;
    }, [connected, hearLanguage, viewOnly]);

    const listenToTranslation = (enabled: boolean) => {
        meetingVoice.current?.stop();
        meetingVoice.current = null;
        setStatus('');
        if (enabled && typeof AudioContext !== 'undefined') {
            const voice = new MeetingVoice();
            meetingVoice.current = voice;
            void voice.unlock().catch(() => {
                if (meetingVoice.current === voice) setStatus('Allow audio playback to hear the meeting voice.');
            });
        }
        setVoiceEnabled(enabled);
    };

    // ── Incoming captions ────────────────────────────────────────────
    useEffect(() => {
        if (!connected) return;
        const show = (entry: CaptionEntry) => {
            if (prefs.current.showCaptions) setCaptions(previous => upsertCaption(previous, {
                ...entry, receivedAt: Date.now(),
                speakerName: entry.peerId === myPeerId() ? `${displayName} (You)` : entry.speakerName || 'Participant',
            }));
        };
        const offInterim = signaling.on('captionInterim', (caption: Interim) => {
            if (needsCaptionTranslation(caption.language, prefs.current.captionLanguage)) return;
            show({ id: caption.id, peerId: caption.peerId, speakerName: caption.displayName, text: caption.text, isFinal: false, timestamp: Date.now(), language: caption.language });
        });
        const pending = new Map<string, { target: string; entry: CaptionEntry }>();
        const offFinal = signaling.on('captionReceived', (caption: RoomCaption) => {
            const { captionLanguage: target, showCaptions: visible } = prefs.current;
            if (!visible) return;
            const entry = { id: caption.id, peerId: caption.peerId, speakerName: caption.displayName,
                text: caption.text, isFinal: true, timestamp: caption.timestamp, language: caption.language };
            if (needsCaptionTranslation(caption.language, target)) {
                if (capabilities.configured && !fallbackEpisodes.current.has('subscription')) {
                    pending.set(caption.id, { target, entry });
                    if (pending.size > 40) pending.delete(pending.keys().next().value!);
                    return;
                }
                show({ ...entry, label: 'Original · translation unavailable' });
            } else show({ ...entry, label: 'Original' });
        });
        const offTranslated = signaling.on('captionTranslated', (result: Translated) => {
            const { captionLanguage: target, hearLanguage: voice, voiceEnabled: speak } = prefs.current;
            if (result.target === target) { pending.delete(result.id); fallbackEpisodes.current.delete('translation'); }
            if (result.target === target) show({ id: result.id, peerId: result.peerId, speakerName: result.displayName, text: result.translatedText, isFinal: true, timestamp: result.timestamp, language: result.target, label: 'Translated' });
            if (speak && voice && result.target === voice && result.peerId !== myPeerId()) {
                const tts = ttsRef.current;
                if (tts?.getBestVoice(voice)) tts.speak(result.translatedText, voice);
                else {
                    const unavailable = () => setVoiceDiagnostic({ gate: 'voice', message: 'The meeting voice is unavailable for this language. Translated captions are still available.' });
                    if (meetingVoice.current) meetingVoice.current.enqueue(result.id, voice, active => {
                        onSpeakingChange(active);
                        if (active) setVoiceDiagnostic(null);
                    }, unavailable);
                    else unavailable();
                }
            }
        });
        const offFailed = signaling.on('captionTranslationFailed', (result: { id: string; target: string; reason: string }) => {
            if (result.target !== prefs.current.captionLanguage) return;
            const original = pending.get(result.id);
            if (original?.target === result.target) { pending.delete(result.id); show({ ...original.entry, label: 'Original · translation unavailable' }); }
            const reason = result.reason === 'busy' ? 'Translation is busy.' : result.reason === 'consent' ? 'The speaker has not allowed translation.' : 'Translation is unavailable.';
            const message = reason + ' Showing the original speech.';
            setStatus(message);
            if (prefs.current.showCaptions) notifyFallback('translation', message);
        });
        return () => { offInterim(); offFinal(); offTranslated(); offFailed(); };
    }, [connected, capabilities.configured, myPeerId, displayName, onSpeakingChange]);

    // ── Transcript and minutes ───────────────────────────────────────
    const toggleTranscript = (enabled: boolean) => {
        signaling.request('setTranscriptSaving', { enabled }).then(result => setTranscriptSaving(Boolean(result?.saving)))
            .catch((error: Error) => {
                if (/method not found/i.test(error.message || '')) { setServerUpToDate(false); setStatus('Transcript saving is unavailable in this meeting.'); return; }
                setStatus('Could not change transcript saving. Try again.');
            });
    };
    const download = async (format: 'txt' | 'srt') => {
        try {
            const result = await signaling.request('getTranscript') as { saving: boolean; entries: TranscriptEntry[] };
            if (!result.entries.length) { setStatus(result.saving ? 'No shared speech yet. An eligible speaker must enable speech sharing and unmute.' : 'There is no saved transcript in this room yet.'); return; }
            downloadText(`${meetingCode}-transcript.${format}`, format === 'srt' ? transcriptToSrt(result.entries) : transcriptToText(result.entries, minutes));
            setStatus('Transcript download requested.');
        } catch { setStatus('Could not download the transcript.'); }
    };
    const shareMySpeech = (enabled: boolean) => {
        declinedSpeech.current = !enabled;
        if (!enabled) stopRecognition.current();
        if (serverAsr) setAllowServerTranscription(enabled);
        else setAllowBrowser(enabled);
        onShareSpeechChange(enabled);
        setStatus('');
    };
    const createMinutes = async () => {
        setMinutesBusy(true); setStatus('Writing meeting minutes…');
        try {
            const result = await signaling.request('generateMinutes', {}) as { minutes: string };
            setMinutes(result.minutes); setStatus('Minutes are ready. They are saved with the transcript.');
        } catch { setStatus('AI temporarily unavailable. Your meeting can continue.'); }
        finally { setMinutesBusy(false); }
    };

    const outputs = capabilities.configured ? capabilities.languages : [];
    const name = (code: string, fallback: string) => LANGUAGES.find(item => item.code === code)?.name || fallback;
    const speakOptions = captionLanguageOptions(serverAsr ? asrLanguages : null, speakingLanguage, outputs);
    return <>
        <div className="meeting-caption-notices">
        <span className="collaboration-sr" role="status">{processorParticipants.length > 0 ? 'Live transcription is active.' : ''}</span>
        {fallbackNotice && <MeetingToast key={fallbackNotice} onDismiss={() => setFallbackNotice('')}>{fallbackNotice}</MeetingToast>}
        {voiceEnabled && voiceDiagnostic && !open && !dismissedVoiceDiagnostics.has(voiceDiagnosticKey) && <MeetingToast key={voiceDiagnosticKey} className="meeting-caption-diagnostic" onDismiss={dismissVoiceDiagnostic}>
            <span data-speech-gate={voiceDiagnostic.gate}>{voiceDiagnostic.message} Original meeting audio stays on.</span>
        </MeetingToast>}
        {transcriptSaving && !transcriptNoticeDismissed && <MeetingToast className="meeting-caption-diagnostic" duration={5000} onDismiss={() => setTranscriptNoticeDismissed(true)}>Transcript is being saved.</MeetingToast>}
        </div>
        {statusHost && processorParticipants.length > 0 && createPortal(
            <details className="meeting-processor-disclosure" onKeyDown={event => {
                if (event.key === 'Escape' && event.currentTarget.open) {
                    event.stopPropagation();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                }
            }}>
                <summary><span className="mi" aria-hidden="true">mic</span>Live transcription<span className="mi processor-chevron" aria-hidden="true">expand_more</span></summary>
                <div className="meeting-processor-detail"><p>The transcription processor is receiving microphone audio from</p>
                    <ul>{processorParticipants.map(peer => <li key={peer.peerId}>{peer.displayName}</li>)}</ul>
                </div>
            </details>, statusHost)}
        <CaptionOverlay enabled={showCaptions} captions={captions} fontSize="large" />
        {open && <section ref={panelRef} className="meeting-language-settings" id="meeting-language-settings" role="dialog" aria-labelledby="caption-settings-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
            <div className="caption-settings-head"><h2 id="caption-settings-title">Captions & language</h2><button type="button" className="neu-icon-btn" aria-label="Close language settings" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></div>
            {!viewOnly && summaryActive && <div className="caption-settings-group">
                <p>AI summary is on. You can change your caption and language settings at any time.</p>
                {canShareSpeech && recognitionSupported && <label className="caption-toggle"><SelectionInput type="checkbox" checked={shareSpeech} disabled={!shareSpeech && !connected} onChange={event => {
                    shareMySpeech(event.target.checked);
                }} />{serverAsr ? 'Allow the transcription service to receive my mic audio and include my shared captions' : 'Allow browser speech recognition to include my shared captions'}</label>}
            </div>}
            <label className="caption-toggle"><SelectionInput type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} />Show meeting captions</label>
            <label htmlFor="caption-output-language">Read captions in</label>
            <select aria-describedby="caption-translation-help" disabled={!outputs.length} id="caption-output-language" value={captionLanguage === 'original' ? preferredCaptionLanguage : captionLanguage} onChange={event => chooseCaptionLanguage(event.target.value)}><option value="original">Speaker’s original language</option>{captionLanguage === 'original' && preferredCaptionLanguage !== 'original' && <option disabled value={preferredCaptionLanguage}>{preferredCaptionLanguage} · {capabilities.transcript ? 'unavailable' : 'checking availability'}</option>}{outputs.map(lang => <option value={lang.code} key={lang.code}>{name(lang.code, lang.name)}</option>)}</select>

            <p id="caption-translation-help" className="caption-settings-note">Choose the language you want to read. You can speak a different language.</p>
            {canShareSpeech && <details className="caption-settings-group"><summary>Your microphone</summary>
            {serverAvailable && SpeechToTextEngine.isSupported() && <>
                <label htmlFor="caption-recognition-source">Recognize speech using</label>
                <select id="caption-recognition-source" value={preferBrowser ? 'browser' : 'server'} onChange={event => {
                    stopRecognition.current();
                    onShareSpeechChange(false);
                    setAllowBrowser(false);
                    setAllowServerTranscription(false);
                    setPreferBrowser(event.target.value === 'browser');
                }}>
                    <option value="server">Meeting transcription service</option>
                    <option value="browser">This browser</option>
                </select>
            </>}
            <label htmlFor="meeting-speaking-language">Language I speak</label>
            <select id="meeting-speaking-language" value={speakingLanguage} onChange={event => { setAutoDetect(false); onSpeakingLanguageChange(event.target.value); }}>{speakOptions.map(lang => <option value={lang.code} key={lang.code}>{lang.label}</option>)}</select>
            {serverAsr && capabilities.asr?.autoDetect !== false && <label className="caption-toggle"><SelectionInput type="checkbox" checked={autoDetect} onChange={event => setAutoDetect(event.target.checked)} />Detect my spoken language</label>}
            {!serverAsr && <button type="button" className="btn-text" onClick={onUseDetectedLanguage}>Use browser or region suggestion</button>}
            <details className="caption-privacy"><summary>How transcription uses audio</summary><p>{serverAsr
                ? 'The configured transcription processor receives a copy of your microphone audio. The meeting service can read shared captions and translation text.'
                : 'Browser speech recognition may send audio to your browser’s provider. It uses the browser’s microphone, which may differ from your selected meeting device. Only enable it if you agree.'} Captions are shared with this meeting{transcriptSaving ? ' and the host is saving a transcript.' : '. When AI summary is on, shared captions are used to create the recap.'}</p>
            {serverAsr && <p>{e2eeActive ? 'Meeting audio, video and screen sharing remain end-to-end encrypted. Transcription separately shares your microphone audio with the processor.' : 'Transcription shares your microphone audio with the configured processor.'} Turning this permission off stops further audio sharing and discards pending results. Previously shared captions remain visible.</p>}
            </details>
            {serverAsr && <>
                <label className="caption-toggle"><SelectionInput type="checkbox" checked={allowServerTranscription} disabled={!allowServerTranscription && !connected} onChange={event => {
                    stopRecognition.current();
                    onShareSpeechChange(false);
                    declinedSpeech.current = !event.target.checked;
                    setAllowServerTranscription(event.target.checked);
                    setStatus('');
                }} />Allow the transcription service to receive my mic audio for this connection</label>
            </>}
            {!serverAsr && <p className="caption-settings-note">Your browser may send mic audio to its speech provider.</p>}
            <label className="caption-toggle"><SelectionInput type="checkbox" checked={shareSpeech} disabled={!shareSpeech && (!connected || !recognitionSupported || (serverAsr && !allowServerTranscription))} onChange={event => { shareMySpeech(event.target.checked); }} />{serverAsr ? 'Share my speech as captions' : 'Share captions using browser speech recognition'}</label>
            {capabilities.processing === 'google-cloud' && capabilities.configured && <label className="caption-toggle"><SelectionInput type="checkbox" checked={allowGoogleTranslation} onChange={event => setAllowGoogleTranslation(event.target.checked)} />Allow Google Cloud to translate my shared caption text</label>}
            <p className="caption-settings-note">{!recognitionSupported ? 'Speech recognition is unavailable in this browser. You can still receive captions.' : audioMuted && shareSpeech ? 'Recognition is paused while your microphone is muted.' : translatedSpeaking && shareSpeech ? 'Recognition is paused while translated audio plays.' : serverAsr && !asrLanguage ? 'Choose an available spoken language.' : serverAsr && asrLanguage ? `Speaking: ${asrLanguage === 'auto' ? 'detected automatically' : name(asrLanguage, asrLanguage)}.` : `Speaking: ${name(speakingLanguage, speakingLanguage)}. Recognition support depends on your browser.`}</p>
            </details>}
            {capabilities.translatedAudio && <details className="caption-settings-group"><summary>Translated audio</summary>
            <label htmlFor="heard-output-language">Listen in</label>
            <select disabled={!outputs.length} id="heard-output-language" value={hearLanguage} onChange={event => { setVoiceEnabled(false); setHearLanguage(event.target.value); }}><option value="">Choose a language</option>{outputs.map(lang => <option value={lang.code} key={lang.code}>{name(lang.code, lang.name)}</option>)}</select>
            <label className="caption-toggle"><SelectionInput type="checkbox" checked={voiceEnabled} disabled={!connected || !hearLanguage} onChange={event => listenToTranslation(event.target.checked)} />Listen to translated speech</label>
            <p className="caption-settings-note">If your device has no matching voice, QS-VC reads the translation using a meeting voice. Device voices may use a remote service.</p>
            {voiceEnabled && voiceDiagnostic && <div role="status" className="caption-settings-status" data-speech-gate={voiceDiagnostic.gate}>
                {voiceDiagnostic.message} Original meeting audio stays on.
            </div>}
            </details>}
            {!viewOnly && <><details className="caption-settings-group"><summary>Transcript</summary>
            {!serverUpToDate && <p className="caption-settings-note" role="status">Transcript saving is unavailable in this meeting.</p>}
            {serverUpToDate && isHost && <label className="caption-toggle"><SelectionInput type="checkbox" checked={transcriptSaving} disabled={!connected} onChange={event => toggleTranscript(event.target.checked)} />Save transcript and notify everyone</label>}
            {serverUpToDate && !isHost && <p className="caption-settings-note">{transcriptSaving ? 'The host is saving a transcript of shared captions.' : 'The host can save a transcript of shared captions.'}</p>}
            {(transcriptSaving || hadTranscript) && <div className="caption-actions">
                <button type="button" className="btn-outline" onClick={() => download('txt')}>Download .txt</button>
                <button type="button" className="btn-outline" onClick={() => download('srt')}>Download .srt</button>
                {transcriptSaving && isHost && capabilities.minutes?.configured && <>
                    <button type="button" className="btn-outline" disabled={minutesBusy} onClick={createMinutes}>{minutesBusy ? 'Writing minutes…' : 'Create AI minutes'}</button>
                </>}
            </div>}
            {minutes && <div className="caption-minutes"><pre>{minutes}</pre><button type="button" className="btn-text" onClick={() => downloadText(`${meetingCode}-minutes.md`, minutes)}>Download minutes</button></div>}
            </details>
            </>}
            <div role="status" className="caption-settings-status">{status || capabilityError}</div>
        </section>}
    </>;
}
