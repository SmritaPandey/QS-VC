import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { signaling } from '../lib/signaling';
import { media, ConsumerInfo } from '../lib/media';
import { CameraCapture, watchCameraVisibility, watchCameraTrack, cameraAccessMessage } from '../lib/camera-capture';
import { watchMutedSpeech } from '../lib/muted-speech';
import { recordingManager, recordingRequest } from '../lib/recording';
import { getToken } from '../lib/session';
import { useSession } from '../lib/use-session';
import { hasFeature, useEntitlements } from '../lib/entitlements';
import type { NoiseSuppressor } from '../lib/noise-suppression';
import '../styles/recordings.css';
import { playSound } from '../lib/sounds';
import { haptic } from '../lib/haptics';
import { createMeetingComposite, type MeetingComposite } from '../lib/meeting-recorder';
import VideoGrid, { RemoteAudio, type ViewMode, type TilesPerPage } from '../components/VideoGrid';
import BackgroundEffects from '../components/BackgroundEffects';
import ReportProblem from '../components/ReportProblem';
import { hasCaptionConsent } from '../components/MeetingCaptions';
import { useSpeaking } from '../lib/speaking';
import { BackgroundProcessor, savedEffect, saveEffect, effectLabel, type BackgroundEffect } from '../lib/virtual-background';
import { SpeechToTextEngine } from '../lib/speech-to-text';
import { ServerSpeechEngine } from '../lib/server-speech';
import '../styles/meeting-stage.css';
import BrandLogo from '../components/BrandLogo';
import MeetingInformation from '../components/MeetingInformation';
import ControlBar from '../components/ControlBar';
import MeetingChat from '../components/MeetingChat';
import ParticipantsPanel from '../components/ParticipantsPanel';
import PrivateConversationPanel, { type ActivePrivateConversation, type PrivateConversationInvite } from '../components/PrivateConversationPanel';
import ReactionsOverlay, { MeetingReaction, REACTION_DURATION } from '../components/ReactionsOverlay';
import AIChatBot from '../components/AIChatBot';
import MeetingCaptions from '../components/MeetingCaptions';
import MeetingCollaboration from '../components/MeetingCollaboration';
import HostMeetingTools, { type RoomHostSettings } from '../components/HostMeetingTools';
import { WaitingAdmission, type WaitingMode } from '../components/WaitingRoom';
import { openMicrophone, startCameraWithFallback, microphoneMessage, deviceLabel } from '../lib/device-access';
import { initialMeetingLanguage, detectLanguage, setMeetingLanguage, clearSavedLanguage, findLanguage, LANGUAGE_EVENT, type MeetingLanguage } from '../lib/meeting-language';

const MEETING_API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const MAX_MEETING_TITLE_LENGTH = 52;

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    screenVideoTrack?: MediaStreamTrack;
    role?: string;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
    presenting?: boolean;
    onStage?: boolean;
}

interface ChatMessage {
    id: string;
    peerId: string;
    displayName: string;
    content: string;
    timestamp: string;
}

type MediaKind = 'audio' | 'video';

/**
 * Open audio independently so a camera-off choice never acquires the camera.
 * Each device is time-limited and falls back to the system default, so a stuck or unplugged
 * external device can never hold up joining. Returns notices to show the person.
 */
async function openLocalMedia(micId: string | undefined, cameraId: string | undefined, camera: CameraCapture, stream: MediaStream, isActive: () => boolean, wantsCamera: () => boolean, wantsMic: () => boolean): Promise<{ micNotice?: string; cameraNotice?: string }> {
    const notices: { micNotice?: string; cameraNotice?: string } = {};
    const micTask = (async () => {
        try {
            const { stream: audio, fellBack } = await openMicrophone(micId);
            if (!isActive()) { audio.getTracks().forEach(track => track.stop()); return; }
            audio.getTracks().forEach(track => stream.addTrack(track));
            if (fellBack) notices.micNotice = `Your chosen microphone was not available. Using ${deviceLabel(audio.getAudioTracks()[0])}.`;
        } catch (error) {
            // Joining without a microphone is allowed; say why only if the person wanted to talk.
            if (wantsMic()) notices.micNotice = microphoneMessage(error);
        }
    })();
    const cameraTask = (async () => {
        if (!wantsCamera()) return;
        try {
            const { track, fellBack } = await startCameraWithFallback(constraints => camera.start(constraints), cameraId);
            if (track && isActive()) stream.addTrack(track); else track?.stop();
            if (track && fellBack) notices.cameraNotice = `Your chosen camera was not available. Using ${deviceLabel(track)}.`;
        } catch (error) {
            // The camera can be retried explicitly after joining.
            notices.cameraNotice = cameraAccessMessage(error);
        }
    })();
    // Mic and camera start together: an external camera warming up no longer delays the microphone.
    await Promise.all([micTask, cameraTask]);
    return notices;
}

/** Errors that mean "you may not join (yet)", as opposed to a network problem worth retrying. */
const POLICY_ERRORS = /password|locked|full|cancelled|declined|denied|removed|ended|organiser|organizer|webinar|encryption|sign in/i;
type JoinFailure = { title: string; detail: string };

/**
 * Keeps people in the meeting through brief network drops (Wi-Fi switch, laptop sleep, server restart):
 * the meeting session is re-created up to three times before "Connection lost" is shown.
 */
export default function MeetingRoom() {
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const [attempt, setAttempt] = useState(0);
    const failures = useRef(0);
    const carried = useRef<{ audioMuted?: boolean; videoOff?: boolean }>({});
    const reconnect = useCallback((current: { audioMuted: boolean; videoOff: boolean }) => {
        if (failures.current >= 3) return false;
        failures.current++;
        carried.current = current;
        window.setTimeout(() => setAttempt(value => value + 1), 1200 * failures.current);
        return true;
    }, []);
    const connectedOk = useCallback(() => { failures.current = 0; }, []);
    return <MeetingRoomSession key={`${meetingCode}-${attempt}`} reconnecting={attempt > 0} carried={carried.current} onDropped={reconnect} onConnected={connectedOk} />;
}

interface SessionProps {
    reconnecting: boolean;
    carried: { audioMuted?: boolean; videoOff?: boolean };
    onDropped: (current: { audioMuted: boolean; videoOff: boolean }) => boolean;
    onConnected: () => void;
}

function MeetingRoomSession({ reconnecting, carried, onDropped, onConnected }: SessionProps) {
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const session = useSession();
    const signedIn = session.status === 'authenticated' && Boolean(getToken());
    const entitlements = useEntitlements();
    const isPlatformAdmin = entitlements.isPlatformAdmin;
    const state = { ...((location.state as any) || {}), ...(reconnecting ? carried : {}) };
    const initialInviteToken = new URLSearchParams(location.search).get('invite') || '';
    const [meetingInviteToken, setMeetingInviteToken] = useState(initialInviteToken);
    const meetingPreviewPath = `/meeting/${meetingCode}/preview${meetingInviteToken ? `?invite=${encodeURIComponent(meetingInviteToken)}` : ''}`;
    const initialMeetingTitle = typeof state.title === 'string' ? state.title.trim() : '';
    const [meetingTitle, setMeetingTitle] = useState(initialMeetingTitle);
    useEffect(() => {
        if (!meetingCode || initialMeetingTitle) return;
        const controller = new AbortController();
        fetch(`${MEETING_API}/api/meetings/code/${encodeURIComponent(meetingCode)}`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(meeting => {
                if (typeof meeting?.title === 'string' && meeting.title.trim()) setMeetingTitle(meeting.title.trim());
            })
            .catch(() => { /* The room remains usable if its title is unavailable. */ });
        return () => controller.abort();
    }, [meetingCode, initialMeetingTitle]);
    const displayedMeetingTitle = meetingTitle.length > MAX_MEETING_TITLE_LENGTH
        ? `${meetingTitle.slice(0, MAX_MEETING_TITLE_LENGTH - 1).trimEnd()}…`
        : meetingTitle || 'Meeting';
    const meetingTitleLength = meetingTitle.length > 36 ? 'long' : meetingTitle.length > 20 ? 'medium' : 'short';
    const [clockNow, setClockNow] = useState(() => new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setClockNow(new Date()), 15_000);
        return () => window.clearInterval(timer);
    }, []);

    const myPeerIdRef = useRef('');
    const [myRole, setMyRole] = useState<string>('member');
    const [displayName] = useState(state.displayName || 'Guest');
    const [peers, setPeers] = useState<Map<string, PeerData>>(new Map());
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    // Mic / camera: the pre-join choice is the starting state; every later change goes through applyMute().
    const canPublishRef = useRef(false);
    const [audioMuted, setAudioMuted] = useState<boolean>(!!state.audioMuted);
    const [videoOff, setVideoOff] = useState(true);
    const [cameraNotice, setCameraNotice] = useState('');
    const [screenSharing, setScreenSharing] = useState(false);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [roomRecording, setRoomRecording] = useState<{ peerId: string; displayName: string } | null>(null);
    const [recordingStatus, setRecordingStatus] = useState(recordingManager.pending ? 'A recording is waiting to save. Retry before leaving.' : '');
    const pendingRecording = useRef(recordingManager.pending);
    const finalizingRecording = useRef<Promise<boolean> | null>(null);
    const finishRecordingRef = useRef<() => Promise<boolean>>(async () => true);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [privateInvite, setPrivateInvite] = useState<PrivateConversationInvite | null>(null);
    const [privateConversation, setPrivateConversation] = useState<ActivePrivateConversation | null>(null);
    const [privateAudioTrack, setPrivateAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [privateMicMuted, setPrivateMicMuted] = useState(false);
    const [focusPrivateAudio, setFocusPrivateAudio] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [incomingChatMessage, setIncomingChatMessage] = useState<ChatMessage | null>(null);
    const chatOpenRef = useRef(false);
    chatOpenRef.current = chatOpen;
    const [participantsOpen, setParticipantsOpen] = useState(false);
    const [activitiesOpen, setActivitiesOpen] = useState(false);
    const [hostToolsOpen, setHostToolsOpen] = useState(false);
    const [waitingAdmission, setWaitingAdmission] = useState<WaitingMode | null>(null);
    const waitingStatusRef = useRef<WaitingMode | null>(null);
    const [roomSettings, setRoomSettings] = useState<RoomHostSettings>({ locked: false, waitingRoomEnabled: true, muteOnEntry: false, allowScreenShare: true, allowChat: true, allowMicrophone: true, allowCamera: true, allowReactions: true });
    const [joinFailure, setJoinFailure] = useState<JoinFailure | null>(null);
    const [restoring, setRestoring] = useState(reconnecting);
    const [knocks, setKnocks] = useState<Array<{ peerId: string; displayName: string }>>([]);
    const notifiedKnocks = useRef(new Set<string>());
    const [leaveOpen, setLeaveOpen] = useState(false);
    const myRoleRef = useRef('member');
    myRoleRef.current = myRole;
    const isManagerNow = () => myRoleRef.current === 'host' || myRoleRef.current === 'co-host';
    const roomSettingsRef = useRef(roomSettings);
    roomSettingsRef.current = roomSettings;
    const [viewMode, setViewMode] = useState<ViewMode>(() => { try { const v = localStorage.getItem('qsvc:view'); return v === 'tiled' || v === 'spotlight' || v === 'sidebar' ? v : 'auto'; } catch { return 'auto'; } });
    const [tilesPerPage, setTilesPerPage] = useState<TilesPerPage>(() => { try { const v = Number(localStorage.getItem('qsvc:tiles')); return [4, 9, 16, 25, 49].includes(v) ? v as TilesPerPage : 'auto'; } catch { return 'auto'; } });
    const changeView = useCallback((view: ViewMode) => { setViewMode(view); try { localStorage.setItem('qsvc:view', view); } catch { /* convenience only */ } }, []);
    const changeTiles = useCallback((value: TilesPerPage) => { setTilesPerPage(value); try { localStorage.setItem('qsvc:tiles', String(value)); } catch { /* convenience only */ } }, []);
    const [pinnedId, setPinnedId] = useState<string | null>(null);
    const [spotlightId, setSpotlightId] = useState<string | null>(null);
    const [roomDevicesEnabled, setRoomDevicesEnabled] = useState(false);
    const [webinar, setWebinar] = useState(false);
    const [myOnStage, setMyOnStage] = useState(false);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [noiseMode, setNoiseMode] = useState<'off' | 'standard' | 'ai'>('standard');
    const [shareSpeech, setShareSpeech] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [effectsOpen, setEffectsOpen] = useState(false);
    const [effect, setEffect] = useState<BackgroundEffect>(savedEffect);
    const [effectStatus, setEffectStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [effectError, setEffectError] = useState('');
    const [processedTrack, setProcessedTrack] = useState<MediaStreamTrack | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const roomRef = useRef<HTMLDivElement>(null);
    const [connected, setConnected] = useState(false);
    const [pageVisible, setPageVisible] = useState(!document.hidden);
    const [mutedSpeechNotice, setMutedSpeechNotice] = useState(false);
    const [mutedSpeechPulse, setMutedSpeechPulse] = useState(0);
    const mutedSpeechTimer = useRef<number>();
    const [duration, setDuration] = useState(0);
    const [handRaised, setHandRaised] = useState(false);
    const [informationOpen, setInformationOpen] = useState(false);
    const [connectionLost, setConnectionLost] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [audioOutputId, setAudioOutputId] = useState('');
    const [audioOutputDevices, setAudioOutputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
    const [reactions, setReactions] = useState<MeetingReaction[]>([]);
    const [reactionsOpen, setReactionsOpen] = useState(false);
    // Speaking language for voice-to-text: saved choice, else the user's location.
    const [speechLanguage, setSpeechLanguage] = useState<MeetingLanguage>(() => initialMeetingLanguage());
    /** Guests read captions in the language of their location (time zone / region), fixed for the meeting. */
    const guestCaptionLanguage = useMemo(() => detectLanguage().code, []);
    const [translatedSpeaking, setTranslatedSpeaking] = useState(false);
    const getMyPeerId = useCallback(() => myPeerIdRef.current, []);
    /** Captions use the same microphone the meeting sends (noise-suppressed when that is on). */
    const getCaptionMicTrack = useCallback((): MediaStreamTrack | null => {
        const processed = processedAudioTrackRef.current;
        if (processed?.readyState === 'live') return processed;
        return localStreamRef.current?.getAudioTracks().find(track => track.readyState === 'live') || null;
    }, []);
    const [languageOpen, setLanguageOpen] = useState(false);

    // Refs mirror live state so async handlers and signaling callbacks never act on stale values.
    const audioMutedRef = useRef<boolean>(!!state.audioMuted);
    const privateConversationRef = useRef<ActivePrivateConversation | null>(null);
    const privateInviteRef = useRef<PrivateConversationInvite | null>(null);
    const privateMicMutedRef = useRef(false);
    const previousMeetingMicMutedRef = useRef<boolean | null>(null);
    const privateMicTrackRef = useRef<MediaStreamTrack | null>(null);
    const privateConsumerIdRef = useRef<string | null>(null);
    const videoOffRef = useRef<boolean>(!!state.videoOff || document.hidden);
    const localStreamRef = useRef<MediaStream | null>(null);
    const stopSpeechRecognition = useRef<() => void>(() => {});
    const handleTranslatedSpeaking = useCallback((speaking: boolean) => {
        if (speaking) stopSpeechRecognition.current();
        setTranslatedSpeaking(speaking);
    }, []);
    const cameraCapture = useRef(new CameraCapture());
    const sessionActive = useRef(false);
    const sessionRevision = useRef(0);
    const initializingRef = useRef(true);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const sharingRef = useRef(false);
    const recordingRef = useRef(false);
    const joinedRef = useRef(false);
    const busyRef = useRef<{ screen?: boolean; record?: boolean; camera?: boolean; mic?: boolean }>({});
    const noticeTimer = useRef<number>();
    const peersRef = useRef<Map<string, PeerData>>(new Map());
    const handRaisedRef = useRef(false);
    const stopScreenShareRef = useRef<() => Promise<void>>(async () => {});
    const processedTrackRef = useRef<MediaStreamTrack | null>(null);
    const noiseModeRef = useRef<'off' | 'standard' | 'ai'>('standard');
    const noiseSuppressorRef = useRef<NoiseSuppressor | null>(null);
    const processedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
    const processorRef = useRef<BackgroundProcessor | null>(null);
    const processorSourceRef = useRef<string>('');
    const videoAreaRef = useRef<HTMLDivElement>(null);
    const compositeRef = useRef<MeetingComposite | null>(null);
    privateConversationRef.current = privateConversation;
    privateInviteRef.current = privateInvite;
    privateMicMutedRef.current = privateMicMuted;
    useEffect(() => { peersRef.current = peers; }, [peers]);

    useEffect(() => {
        if (!incomingChatMessage) return;
        const timer = window.setTimeout(() => setIncomingChatMessage(null), 6000);
        return () => window.clearTimeout(timer);
    }, [incomingChatMessage]);

    const showNotice = useCallback((text: string) => {
        setNotice(text);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
    }, []);

    const audioOutputSupported = typeof HTMLAudioElement !== 'undefined'
        && typeof (HTMLAudioElement.prototype as HTMLAudioElement & { setSinkId?: unknown }).setSinkId === 'function';
    const audioOutputPickerSupported = audioOutputSupported && typeof navigator !== 'undefined'
        && typeof (navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown } | undefined)?.selectAudioOutput === 'function';

    useEffect(() => {
        let active = true;
        const refreshOutputs = async () => {
            if (!navigator.mediaDevices?.enumerateDevices) return;
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (!active) return;
                setAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput').map((device, index) => ({
                    deviceId: device.deviceId,
                    label: device.label || `Audio device ${index + 1}`,
                })));
            } catch { /* Device discovery is optional; system audio remains available. */ }
        };
        void refreshOutputs();
        navigator.mediaDevices?.addEventListener?.('devicechange', refreshOutputs);
        return () => {
            active = false;
            navigator.mediaDevices?.removeEventListener?.('devicechange', refreshOutputs);
        };
    }, []);

    const chooseAudioOutput = useCallback(async () => {
        const devices = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
        if (!devices.selectAudioOutput) return;
        try {
            const selected = await devices.selectAudioOutput();
            setAudioOutputDevices(current => current.some(device => device.deviceId === selected.deviceId)
                ? current
                : [...current, { deviceId: selected.deviceId, label: selected.label || 'Selected audio device' }]);
            setAudioOutputId(selected.deviceId);
        } catch (error) {
            if ((error as DOMException)?.name !== 'NotAllowedError') showNotice('Could not open the audio device picker.');
        }
    }, [showNotice]);

    const reportAudioOutputError = useCallback(() => {
        showNotice('Could not switch audio output. Your system default is still available.');
    }, [showNotice]);

    function pushReaction(emoji: string, name: string, mine: boolean) {
        const reaction: MeetingReaction = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            emoji, displayName: name, mine,
            x: 12 + Math.random() * 76,
            drift: Math.round((Math.random() - 0.5) * 80),
        };
        // Keep the stage readable during bursts.
        setReactions((prev) => [...prev.slice(-23), reaction]);
        // Fallback cleanup (animations are off under reduced motion).
        window.setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== reaction.id)), REACTION_DURATION + 400);
    }

    /** Update one remote peer without dropping fields set elsewhere (tracks, flags, name). */
    const patchPeer = useCallback((peerId: string, patch: Partial<PeerData>) => {
        setPeers((prev) => {
            const next = new Map(prev);
            const current = next.get(peerId) || { peerId, displayName: patch.displayName || 'Guest' };
            next.set(peerId, { ...current, ...patch });
            return next;
        });
    }, []);

    /**
     * The one place mic/camera state changes: local track, sent media (producer), the server, and the UI.
     * Keeps all four in step, so a choice made before joining carries into the meeting and later toggles work.
     */
    const applyMute = useCallback((kind: MediaKind, muted: boolean, announce = true) => {
        const stream = localStreamRef.current;
        if (kind === 'audio' && muted) stopSpeechRecognition.current();
        if (kind === 'video' && muted) cameraCapture.current.stop();
        stream?.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = !muted; });
        // While sharing, the video producer carries the screen, so camera-off must not pause it.
        media.setPaused(kind, muted, kind === 'audio' ? 'mic' : 'camera');
        if (kind === 'audio') { audioMutedRef.current = muted; setAudioMuted(muted); }
        else { videoOffRef.current = muted; setVideoOff(muted); }
        if (announce && joinedRef.current) signaling.request('muteStateChanged', { kind, muted }).catch((error: Error) => {
            // The host turned this permission off: go back to muted and say why.
            if (!muted && /host has turned off/i.test(error?.message || '')) {
                stream?.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = false; });
                media.setPaused(kind, true, kind === 'audio' ? 'mic' : 'camera');
                if (kind === 'audio') { audioMutedRef.current = true; setAudioMuted(true); }
                else { videoOffRef.current = true; setVideoOff(true); cameraCapture.current.stop(); }
                setNotice(error.message);
            }
        });
    }, []);

    const publishAudioTrack = useCallback(async (rawTrack: MediaStreamTrack, mode = noiseModeRef.current) => {
        const revision = sessionRevision.current;
        const previousMode = noiseModeRef.current;
        const previousSuppressor = noiseSuppressorRef.current;
        const previousProcessedTrack = processedAudioTrackRef.current;
        let nextSuppressor: NoiseSuppressor | null = null;
        let nextProcessedTrack: MediaStreamTrack | null = null;
        let effectiveMode = mode;
        let outgoingTrack = rawTrack;
        if (mode === 'ai') {
            await rawTrack.applyConstraints({ noiseSuppression: false }).catch(() => {});
            try {
                const { NoiseSuppressor: NoiseSuppressorImpl } = await import('../lib/noise-suppression');
                nextSuppressor = new NoiseSuppressorImpl();
                const processed = await nextSuppressor.start(new MediaStream([rawTrack]));
                const filteredTrack = processed.getAudioTracks()[0];
                if (!filteredTrack) throw new Error('The AI noise filter did not produce an audio track.');
                nextProcessedTrack = filteredTrack;
                outgoingTrack = filteredTrack;
            } catch (error) {
                nextSuppressor?.stop();
                nextSuppressor = null;
                await rawTrack.applyConstraints({ noiseSuppression: true }).catch(() => {});
                effectiveMode = 'standard';
                showNotice(error instanceof Error ? `${error.message} Using standard noise suppression.` : 'AI noise suppression could not start. Using standard noise suppression.');
            }
        } else {
            await rawTrack.applyConstraints({ noiseSuppression: mode === 'standard' }).catch(() => {});
        }

        if (!sessionActive.current || revision !== sessionRevision.current || rawTrack.readyState !== 'live') {
            nextSuppressor?.stop();
            throw new Error('The meeting disconnected before your microphone settings could be applied.');
        }

        try {
            if (media.canSend) {
                if (media.hasProducer('audio', 'mic')) await media.replaceTrack('audio', outgoingTrack, 'mic');
                else await media.produce(outgoingTrack, { source: 'mic' });
            }
            if (!sessionActive.current || revision !== sessionRevision.current) throw new Error('The meeting disconnected before your microphone settings could be applied.');
        } catch (error) {
            nextSuppressor?.stop();
            await rawTrack.applyConstraints({ noiseSuppression: previousMode === 'standard' }).catch(() => {});
            throw error;
        }

        if (previousSuppressor !== nextSuppressor) previousSuppressor?.stop();
        if (previousProcessedTrack !== nextProcessedTrack) previousProcessedTrack?.stop();
        noiseSuppressorRef.current = nextSuppressor;
        processedAudioTrackRef.current = nextProcessedTrack;
        if (effectiveMode !== mode) { noiseModeRef.current = effectiveMode; setNoiseMode(effectiveMode); }
        media.setPaused('audio', audioMutedRef.current, 'mic');
        return effectiveMode;
    }, [showNotice]);

    const publishPrivateAudio = useCallback(async () => {
        const conversation = privateConversationRef.current;
        const rawTrack = localStreamRef.current?.getAudioTracks().find(track => track.readyState === 'live');
        if (!conversation || !rawTrack || !media.canSend) return false;
        const sourceTrack = processedAudioTrackRef.current?.readyState === 'live' ? processedAudioTrackRef.current : rawTrack;
        const track = sourceTrack.clone();
        track.enabled = !privateMicMutedRef.current;
        privateMicTrackRef.current?.stop();
        privateMicTrackRef.current = track;
        try {
            await media.closeProducerBySource('private-audio');
            await media.produce(track, { source: 'private-audio', type: 'private-audio', conversationId: conversation.conversationId });
            media.setPaused('audio', privateMicMutedRef.current, 'private-audio');
            return true;
        } catch (error) {
            track.stop();
            privateMicTrackRef.current = null;
            console.warn('[MeetingRoom] Private audio could not start:', error);
            return false;
        }
    }, []);

    const finishPrivateConversationLocally = useCallback((conversationId?: string) => {
        const current = privateConversationRef.current;
        const invite = privateInviteRef.current;
        if (conversationId && current?.conversationId && current.conversationId !== conversationId) return;
        if (conversationId && invite?.conversationId && invite.conversationId !== conversationId) return;
        if (current) {
            void media.closeProducerBySource('private-audio').catch(() => {});
            privateMicTrackRef.current?.stop();
            privateMicTrackRef.current = null;
            privateConsumerIdRef.current = null;
            setPrivateAudioTrack(null);
            const wasMuted = previousMeetingMicMutedRef.current;
            if (wasMuted !== null) {
                media.setPaused('audio', wasMuted, 'mic');
                localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !wasMuted; });
                audioMutedRef.current = wasMuted;
                setAudioMuted(wasMuted);
                if (joinedRef.current) signaling.request('muteStateChanged', { kind: 'audio', muted: wasMuted }).catch(() => {});
            }
            previousMeetingMicMutedRef.current = null;
            privateMicMutedRef.current = false;
            setPrivateMicMuted(false);
            setFocusPrivateAudio(false);
            privateConversationRef.current = null;
            setPrivateConversation(null);
        }
        privateInviteRef.current = null;
        setPrivateInvite(null);
    }, []);

    const activatePrivateConversation = useCallback((details: any) => {
        const conversationId = String(details?.conversationId || '');
        if (!conversationId) return;
        const otherPeerId = String(details.peerId || '');
        const otherDisplayName = details.displayName || peersRef.current.get(otherPeerId)?.displayName || 'participant';
        const wasMuted = audioMutedRef.current;
        previousMeetingMicMutedRef.current = wasMuted;
        privateMicMutedRef.current = wasMuted;
        setPrivateMicMuted(wasMuted);
        // Pause the ordinary meeting producer; the separate producer is authorized to one peer only.
        media.setPaused('audio', true, 'mic');
        audioMutedRef.current = true;
        setAudioMuted(true);
        const active: ActivePrivateConversation = {
            conversationId,
            otherDisplayName,
            otherPeerId: otherPeerId || undefined,
            endsAt: details.expiresAt || null,
            durationMs: details.durationMs ?? null,
            otherMicrophoneMuted: !!details.peerMuted,
        };
        privateConversationRef.current = active;
        privateInviteRef.current = null;
        setPrivateConversation(active);
        setPrivateInvite(null);
        setFocusPrivateAudio(false);
        playSound('success');
        if (!wasMuted) void publishPrivateAudio().then(ok => { if (!ok) showNotice('The private conversation is connected, but your microphone could not be shared. Check microphone access and unmute the private mic to retry.'); });
        else showNotice(`Private conversation with ${otherDisplayName} started. Your meeting mic is muted; unmute the private mic when you’re ready to speak.`);
    }, [publishPrivateAudio, showNotice]);

    const requestPlanFeature = useCallback((feature: string) => {
        if (entitlements.isPlatformAdmin) return;
        if (entitlements.loading) { showNotice('Checking your plan…'); return; }
        const requiredPlan = entitlements.featureMinimumPlans[feature] || 'starter';
        window.dispatchEvent(new CustomEvent('qsvc:upgrade-required', { detail: { requiredPlan, feature, returnTo: `${location.pathname}${location.search}${location.hash}` } }));
    }, [entitlements.isPlatformAdmin, entitlements.loading, entitlements.featureMinimumPlans, location.hash, location.pathname, location.search, showNotice]);

    const changeNoiseMode = useCallback(async (mode: 'off' | 'standard' | 'ai') => {
        if (mode === 'ai') {
            if (!signedIn) { requestPlanFeature('ai_noise_suppression'); return; }
            if (!isPlatformAdmin && entitlements.loading) { showNotice('Checking your plan…'); return; }
            if (!hasFeature(entitlements, 'ai_noise_suppression')) { requestPlanFeature('ai_noise_suppression'); return; }
        }
        const track = localStreamRef.current?.getAudioTracks().find(candidate => candidate.readyState === 'live');
        if (!track) {
            noiseModeRef.current = mode;
            setNoiseMode(mode);
            return;
        }
        try {
            const appliedMode = await publishAudioTrack(track, mode);
            noiseModeRef.current = appliedMode;
            setNoiseMode(appliedMode);
        } catch (error) {
            showNotice(error instanceof Error ? error.message : 'Microphone noise settings could not be changed.');
            return;
        }
    }, [entitlements.features, entitlements.loading, isPlatformAdmin, publishAudioTrack, requestPlanFeature, showNotice, signedIn]);

    const stopLocalMedia = useCallback(() => {
        stopSpeechRecognition.current();
        noiseSuppressorRef.current?.stop();
        noiseSuppressorRef.current = null;
        processedAudioTrackRef.current = null;
        privateMicTrackRef.current?.stop();
        privateMicTrackRef.current = null;
        previousMeetingMicMutedRef.current = null;
        privateConversationRef.current = null;
        privateInviteRef.current = null;
        sessionActive.current = false;
        sessionRevision.current++;
        cameraCapture.current.stop();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        sharingRef.current = false;
    }, []);

    useEffect(() => {
        if (!connected) return;
        const timer = setInterval(() => setDuration((d) => d + 1), 1000);
        return () => clearInterval(timer);
    }, [connected]);

    useEffect(() => {
        let mounted = true;
        sessionActive.current = true;
        initializingRef.current = true;
        const alive = () => mounted && sessionActive.current;
        let receiveReady = false;
        const pendingProducers = new Map<string, string>();
        const consumingProducers = new Set<string>();
        const consumerRoutes = new Map<string, { peerId: string; kind: MediaKind; source: string }>();
        const presenterUpdates = new Map<string, boolean>();
        let peerSnapshotReady = false;
        const consumeProducer = async (peerId: string, producerId: string) => {
            if (!peerId || !producerId) return;
            if (!receiveReady) { pendingProducers.set(producerId, peerId); return; }
            if (consumingProducers.has(producerId)) return;
            consumingProducers.add(producerId);
            try { await media.consume(peerId, producerId); }
            catch (err) { consumingProducers.delete(producerId); console.error('Failed to consume:', err); }
        };
        let settleAdmission: ((outcome: { result?: any; error?: string; cancelled?: boolean }) => void) | undefined;
        const dropped = () => {
            const current = { audioMuted: audioMutedRef.current, videoOff: videoOffRef.current };
            stopLocalMedia(); media.close(); signaling.disconnect();
            setConnected(false); setLocalStream(null); setVideoOff(true); setAudioMuted(true);
            if (onDropped(current)) setRestoring(true); else { setRestoring(false); setConnectionLost(true); }
        };
        const unsubscribe: Array<() => void> = [signaling.on('disconnected', ({ code }: { code?: number }) => {
            settleAdmission?.({ cancelled: true });
            if (!alive()) return;
            const wasWaiting = !joinedRef.current;
            setWaitingAdmission(null);
            joinedRef.current = false;
            if (recordingRef.current) void finishRecordingRef.current();
            // Ended, removed or signed out: never reconnect automatically.
            if (code === 4000 || code === 4001 || code === 4003 || (wasWaiting && code === 1000)) {
                stopLocalMedia(); media.close(); signaling.disconnect();
                setConnected(false); setLocalStream(null); setVideoOff(true); setAudioMuted(true);
                setConnectionLost(true);
                return;
            }
            dropped();
        })];
        // Subscribe before joinRoom so a screen producer cannot arrive in the setup-listener gap.
        unsubscribe.push(
            signaling.on('newProducer', ({ peerId, producerId, appData }: any) => {
                if (appData?.type === 'screen' || appData?.source === 'screen') {
                    presenterUpdates.set(peerId, true);
                    if (peerSnapshotReady) patchPeer(peerId, { presenting: true });
                }
                void consumeProducer(peerId, producerId);
            }),
            signaling.on('privateConversationInvite', ({ conversationId, initiatorPeerId, displayName: from, durationMs }: any) => {
                if (!conversationId || privateConversationRef.current) return;
                setPrivateInvite({ conversationId, otherPeerId: initiatorPeerId, otherDisplayName: from || 'A host', direction: 'incoming', durationMs });
                playSound('notice');
            }),
            signaling.on('privateConversationState', ({ conversationId, status, targetPeerId, displayName: targetName, durationMs, peerId, muted }: any) => {
                if (status === 'invited' && conversationId) setPrivateInvite({ conversationId, otherPeerId: targetPeerId, otherDisplayName: targetName || 'participant', direction: 'outgoing', durationMs });
                if (status === 'active' && peerId && typeof muted === 'boolean') {
                    setPrivateConversation(current => {
                        if (!current || current.conversationId !== conversationId || current.otherPeerId !== peerId) return current;
                        const next = { ...current, otherMicrophoneMuted: muted };
                        privateConversationRef.current = next;
                        return next;
                    });
                }
            }),
            signaling.on('privateConversationStarted', (details: any) => activatePrivateConversation(details)),
            signaling.on('privateConversationEnded', ({ conversationId, reason }: any) => {
                const active = privateConversationRef.current?.conversationId === conversationId;
                const invited = privateInviteRef.current?.conversationId === conversationId;
                if (!active && !invited) return;
                finishPrivateConversationLocally(conversationId);
                if (active && reason && !['ended', 'cancelled', 'declined', 'participant-left', 'time-limit'].includes(reason)) showNotice('The private conversation ended.');
                else if (active && reason === 'time-limit') showNotice('Your private conversation time is up. Your meeting microphone is restored.');
                else if (active && reason === 'participant-left') showNotice('The private conversation ended because the other person left.');
            }),
            signaling.on('presenterChanged', ({ peerId, presenting }: any) => {
                if (peerId === myPeerIdRef.current) return;
                const isPresenting = !!presenting;
                presenterUpdates.set(peerId, isPresenting);
                if (peerSnapshotReady) patchPeer(peerId, { presenting: isPresenting });
                playSound(isPresenting ? 'success' : 'toggleOff');
            }),
        );
        async function init() {
            try {
                const stream = new MediaStream();
                localStreamRef.current = stream;
                await signaling.connect();
                if (!alive()) return;
                waitingStatusRef.current = null;
                const admission = new Promise<{ result?: any; error?: string; cancelled?: boolean }>(resolve => { settleAdmission = resolve; });
                const stopAdmitted = signaling.on('admitted', result => settleAdmission?.({ result }));
                const stopRejected = signaling.on('rejected', ({ reason }) => settleAdmission?.({ error: reason || 'The host declined your entry.' }));
                const stopWaitingStatus = signaling.on('waitingStatus', ({ status }) => {
                    if (!alive()) return;
                    const mode: WaitingMode = status === 'waitingForHost' ? 'host' : status === 'keptWaiting' ? 'seen' : 'knock';
                    waitingStatusRef.current = mode;
                    setWaitingAdmission(mode);
                });
                unsubscribe.push(stopAdmitted, stopRejected, stopWaitingStatus);
                let joinResult = await signaling.request('joinRoom', {
                    meetingCode, displayName, inviteToken: initialInviteToken || undefined,
                });
                if (joinResult.status === 'waiting' || joinResult.status === 'waitingForHost' || joinResult.status === 'keptWaiting') {
                    if (alive()) {
                        setRestoring(false);
                        setWaitingAdmission(waitingStatusRef.current || (joinResult.status === 'waitingForHost' ? 'host' : joinResult.status === 'keptWaiting' ? 'seen' : 'knock'));
                    }
                    const outcome = await admission;
                    if (!alive() || outcome.cancelled) return;
                    setWaitingAdmission(null);
                    if (outcome.error) throw new Error(outcome.error);
                    joinResult = outcome.result;
                    playSound('notice');
                }
                stopAdmitted(); stopRejected(); stopWaitingStatus(); settleAdmission = undefined;
                if (!alive()) return;
                if (typeof joinResult.inviteToken === 'string') setMeetingInviteToken(joinResult.inviteToken);
                myPeerIdRef.current = joinResult.peerId;
                canPublishRef.current = joinResult.canPublish !== false;
                setMyRole(joinResult.role || 'member');
                setRoomRecording(joinResult.recording || null);
                setRoomSettings(current => ({ ...current, ...joinResult.settings }));
                setRoomDevicesEnabled(joinResult.polyBridgeEnabled === true && joinResult.sfuAvailable === true);
                setWebinar(!!joinResult.settings?.webinar);
                setSpotlightId(joinResult.spotlightPeerId || null);
                joinedRef.current = true;
                if (joinResult.settings?.muteOnEntry && joinResult.role !== 'host' && !audioMutedRef.current) {
                    applyMute('audio', true, false);
                    showNotice('The host mutes participants on entry. Unmute when you are ready.');
                }

                // Listeners first, so nothing sent while we set up media is missed.
                unsubscribe.push(
                    signaling.on('recordingStateChanged', ({ recording }) => {
                        setRoomRecording(recording || null);
                        if (recordingRef.current && (!recording || recording.peerId !== myPeerIdRef.current)) void finishRecordingRef.current();
                    }),
                    signaling.on('settingsUpdated', ({ settings }) => {
                        setRoomSettings(current => ({ ...current, ...settings }));
                        roomSettingsRef.current = { ...roomSettingsRef.current, ...settings };
                        if (settings.allowScreenShare === false && sharingRef.current) { void stopScreenShare(); showNotice('Screen sharing was disabled by the host.'); }
                    }),
                    signaling.on('roleChanged', ({ peerId, role }) => {
                        if (peerId === myPeerIdRef.current) {
                            const before = myRoleRef.current;
                            setMyRole(role);
                            if (role !== 'host' && role !== 'co-host') { setHostToolsOpen(false); setKnocks([]); notifiedKnocks.current.clear(); }
                            if (role !== before) showNotice(role === 'host' ? 'You are now the host.' : role === 'co-host' ? 'You are now a co-host. You can admit people and manage the meeting.' : 'You are no longer a co-host.');
                        } else patchPeer(peerId, { role });
                    }),
                    signaling.on('spotlightChanged', ({ peerId, by }: any) => {
                        setSpotlightId(peerId || null);
                        if (peerId && peerId === myPeerIdRef.current) showNotice(`${by || 'The host'} put you in the spotlight. Everyone sees you large.`);
                    }),
                    signaling.on('stopPresenting', ({ by }: any) => { if (sharingRef.current) { void stopScreenShareRef.current(); showNotice(`${by || 'The host'} stopped your presentation.`); } }),
                    signaling.on('stageChanged', ({ peerId, onStage, canPublish, by }: any) => {
                        if (peerId !== myPeerIdRef.current) { patchPeer(peerId, { onStage: !!onStage }); return; }
                        setMyOnStage(!!onStage);
                        canPublishRef.current = canPublish !== false;
                        playSound('notice');
                        if (onStage) showNotice(`${by || 'The host'} invited you on stage. Turn on your mic and camera when you’re ready.`);
                        else { if (sharingRef.current) void stopScreenShareRef.current(); showNotice('You’re back in the audience. Your mic and camera are off.'); }
                    }),
                    signaling.on('hostLeft', () => showNotice('The host left. The meeting continues; host controls return when the host or a co-host is back.')),
                    signaling.on('waitingRoomPeer', ({ peerId, displayName: name }: any) => {
                        if (!isManagerNow()) return;
                        if (!notifiedKnocks.current.has(peerId)) {
                            notifiedKnocks.current.add(peerId);
                            haptic('notice');
                        }
                        setKnocks(current => current.some(k => k.peerId === peerId) ? current : [...current, { peerId, displayName: name || 'Guest' }]);
                    }),
                    signaling.on('newPeer', ({ peerId, displayName: name, role }: any) => {
                        notifiedKnocks.current.delete(peerId);
                        patchPeer(peerId, { displayName: name, role });
                        setKnocks(current => current.filter(k => k.peerId !== peerId));
                    }),
                    signaling.on('peerLeft', ({ peerId }: any) => { notifiedKnocks.current.delete(peerId); setKnocks(current => current.filter(k => k.peerId !== peerId)); setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; }); }),
                    signaling.on('peerKicked', ({ peerId }: any) => setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; })),
                    signaling.on('peerMuteChanged', ({ peerId, kind, muted }: any) => {
                        if (kind === 'audio') patchPeer(peerId, { audioMuted: !!muted });
                        if (kind === 'video') patchPeer(peerId, { videoOff: !!muted });
                    }),
                    signaling.on('handRaised', ({ peerId, raised, by }: any) => {
                        if (peerId === myPeerIdRef.current) {
                            if (!raised && handRaisedRef.current) { handRaisedRef.current = false; setHandRaised(false); if (by) showNotice(`${by} lowered your hand.`); }
                            return;
                        }
                        patchPeer(peerId, { handRaised: !!raised });
                    }),
                    signaling.on('forceMute', ({ kind, by, reason }: any) => {
                        const k: MediaKind = kind === 'video' ? 'video' : 'audio';
                        const wasOn = k === 'audio' ? !audioMutedRef.current : !videoOffRef.current;
                        applyMute(k, true);
                        if (reason === 'permission') { showNotice(`The host turned off ${k === 'audio' ? 'microphones' : 'cameras'} for participants.`); if (wasOn) playSound('notice'); return; }
                        playSound('notice');
                        showNotice(`${by || 'The host'} turned off your ${k === 'audio' ? 'microphone' : 'camera'}.`);
                    }),
                    signaling.on('kicked', async ({ reason }: any) => { const saved = await finishRecordingRef.current(); stopLocalMedia(); media.close(); signaling.disconnect(); setConnected(false); if (saved) navigate('/meeting-end', { replace: true, state: { meetingCode, reason: reason || 'You were removed from the meeting.', left: true, canRejoin: false } }); else showNotice('Meeting ended. Retry saving your recording before leaving.'); }),
                    signaling.on('meetingEnded', async ({ reason }: any) => { const saved = await finishRecordingRef.current(); stopLocalMedia(); media.close(); signaling.disconnect(); setConnected(false); if (saved) navigate('/meeting-end', { replace: true, state: { meetingCode, reason: reason || 'The meeting has ended.', left: false } }); else showNotice('Meeting ended. Retry saving your recording before leaving.'); }),
                    signaling.on('chatMessage', (msg: ChatMessage) => {
                        setChatMessages((prev) => [...prev, msg]);
                        if (msg.peerId !== myPeerIdRef.current && !chatOpenRef.current) setIncomingChatMessage(msg);
                    }),
                    signaling.on('reaction', ({ peerId, displayName: name, emoji }: any) => {
                        // The server echoes reactions to the sender too; ours is already on screen.
                        if (!emoji || peerId === myPeerIdRef.current) return;
                        pushReaction(emoji, name || 'Guest', false);
                    }),
                );

                // People already in the room, with their mic / camera / hand state.
                for (const p of joinResult.existingPeers || []) {
                    patchPeer(p.peerId, { displayName: p.displayName, role: p.role, audioMuted: !!p.audioMuted, videoOff: !!p.videoOff, handRaised: !!p.handRaised, presenting: !!p.screenSharing, onStage: !!p.onStage });
                }
                peerSnapshotReady = true;
                for (const [peerId, presenting] of presenterUpdates) patchPeer(peerId, { presenting });

                // Capture starts only after admission, never while waiting for a host.
                const manager = joinResult.role === 'host' || joinResult.role === 'co-host';
                if (!manager && joinResult.settings?.allowMicrophone === false && !audioMutedRef.current) { audioMutedRef.current = true; setAudioMuted(true); showNotice('The host has turned off microphones for participants.'); }
                if (!manager && joinResult.settings?.allowCamera === false) videoOffRef.current = true;
                const opened = canPublishRef.current
                    ? await openLocalMedia(state.micId, state.cameraId, cameraCapture.current, stream, alive, () => alive() && !videoOffRef.current, () => !audioMutedRef.current)
                    : {};
                if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
                const hasMic = stream.getAudioTracks().some(track => track.readyState === 'live');
                const hasCam = stream.getVideoTracks().some(track => track.readyState === 'live');
                setLocalStream(stream);
                if (opened.cameraNotice) setCameraNotice(opened.cameraNotice);
                if (!hasMic) { audioMutedRef.current = true; setAudioMuted(true); showNotice(!canPublishRef.current ? 'You are watching this webinar. Only the organiser can share media.' : opened.micNotice || 'No microphone available. You can still listen and chat.'); }
                else if (opened.micNotice) showNotice(opened.micNotice);
                if (!hasCam) videoOffRef.current = true;
                setVideoOff(videoOffRef.current);
                stream.getAudioTracks().forEach(track => { track.enabled = !audioMutedRef.current; watchMicrophone(track); });
                stream.getVideoTracks().forEach(track => { track.enabled = !videoOffRef.current; watchCamera(track); });

                // SFU-based media relay — only if SFU is available
                if (joinResult.routerRtpCapabilities && joinResult.sendTransport && joinResult.recvTransport) {
                    try {
                        await media.loadDevice(joinResult.routerRtpCapabilities);
                        if (!alive()) return;
                        await media.createSendTransport(joinResult.sendTransport);
                        if (!alive()) return;
                        await media.createRecvTransport(joinResult.recvTransport);
                        if (!alive()) return;
                        media.setConsumerCallbacks(
                            (info: ConsumerInfo) => {
                                const source = String(info.appData?.source || info.appData?.type || '');
                                consumerRoutes.set(info.id, { peerId: info.peerId, kind: info.kind, source });
                                if (source === 'private-audio' && info.kind === 'audio') {
                                    privateConsumerIdRef.current = info.id;
                                    setPrivateAudioTrack(info.track);
                                } else if (info.kind === 'video' && (source === 'screen' || info.appData?.type === 'screen')) {
                                    if (info.peerId !== myPeerIdRef.current) patchPeer(info.peerId, { screenVideoTrack: info.track, presenting: true });
                                } else if (info.peerId !== myPeerIdRef.current) {
                                    patchPeer(info.peerId, info.kind === 'audio' ? { audioTrack: info.track } : { videoTrack: info.track });
                                }
                            },
                            (consumerId: string) => {
                                const route = consumerRoutes.get(consumerId);
                                consumerRoutes.delete(consumerId);
                                if (!route) return;
                                if (route.source === 'private-audio') {
                                    if (privateConsumerIdRef.current === consumerId) { privateConsumerIdRef.current = null; setPrivateAudioTrack(null); }
                                } else if (route.peerId !== myPeerIdRef.current) {
                                    if (route.kind === 'video' && route.source === 'screen') patchPeer(route.peerId, { screenVideoTrack: undefined, presenting: false });
                                    else if (route.kind === 'video') patchPeer(route.peerId, { videoTrack: undefined });
                                    else patchPeer(route.peerId, { audioTrack: undefined });
                                }
                            }
                        );
                        receiveReady = true;
                        const audioTrack = stream?.getAudioTracks()[0];
                        const videoTrack = stream?.getVideoTracks()[0];
                        if (audioTrack?.readyState === 'live') await media.produce(audioTrack, { source: 'mic' });
                        if (!alive()) return;
                        if (videoTrack?.readyState === 'live' && !videoOffRef.current) await media.produce(videoTrack, { source: 'camera' });
                        if (!alive()) return;
                        // Producers start live; match them to the current (possibly muted) state.
                        media.setPaused('audio', audioMutedRef.current, 'mic');
                        media.setPaused('video', videoOffRef.current, 'camera');
                        const roomSnapshot = await signaling.request('getRoomInfo', {}).catch(() => null);
                        const peersForSync = new Map<string, any>((joinResult.existingPeers || []).map((peer: any) => [peer.peerId, peer]));
                        for (const participant of roomSnapshot?.participants || []) peersForSync.set(participant.peerId, participant);
                        for (const existingPeer of peersForSync.values()) {
                            if (existingPeer.peerId === myPeerIdRef.current) continue;
                            const presenting = presenterUpdates.has(existingPeer.peerId)
                                ? presenterUpdates.get(existingPeer.peerId)
                                : !!existingPeer.screenSharing;
                            patchPeer(existingPeer.peerId, { displayName: existingPeer.displayName, role: existingPeer.role, audioMuted: !!existingPeer.audioMuted, videoOff: !!existingPeer.videoOff, handRaised: !!existingPeer.handRaised, presenting, onStage: !!existingPeer.onStage });
                            for (const producer of existingPeer.producers || []) pendingProducers.set(producer.id, existingPeer.peerId);
                        }
                        for (const [producerId, producerPeerId] of pendingProducers) {
                            if (!alive()) return;
                            pendingProducers.delete(producerId);
                            await consumeProducer(producerPeerId, producerId);
                        }
                        if (joinResult.polyBridgeEnabled) {
                            let stopped = false;
                            let timer: ReturnType<typeof setTimeout>;
                            let knownPeers = new Set<string>();
                            const consumed = new Set<string>();
                            const syncPolyRoom = async () => {
                                try {
                                    const snapshot = await signaling.request('polySnapshot', {});
                                    if (stopped || !alive()) return;
                                    const currentPeers = new Set<string>();
                                    for (const member of snapshot.roster) {
                                        const id = `poly:${member.callId}`;
                                        currentPeers.add(id);
                                        patchPeer(id, { displayName: member.displayName, role: 'member', audioMuted: member.muted });
                                    }
                                    for (const producer of snapshot.producers) {
                                        currentPeers.add(producer.peerId);
                                        patchPeer(producer.peerId, { displayName: producer.displayName, role: 'member' });
                                        if (consumed.has(producer.producerId)) continue;
                                        try {
                                            await media.consume(producer.peerId, producer.producerId);
                                            consumed.add(producer.producerId);
                                        } catch { /* Retry on the next snapshot if the producer still exists. */ }
                                        if (stopped || !alive()) return;
                                    }
                                    const currentProducers = new Set(snapshot.producers.map((producer: { producerId: string }) => producer.producerId));
                                    for (const id of consumed) if (!currentProducers.has(id)) consumed.delete(id);
                                    const previousPeers = knownPeers;
                                    setPeers(previous => {
                                        const next = new Map(previous);
                                        for (const id of previousPeers) if (!currentPeers.has(id)) next.delete(id);
                                        return next;
                                    });
                                    knownPeers = currentPeers;
                                    setKnocks(current => [
                                        ...current.filter(knock => !knock.peerId.startsWith('poly:')),
                                        ...snapshot.lobby.map((entry: { callId: string; displayName: string }) => ({
                                            peerId: `poly:${entry.callId}`, displayName: entry.displayName,
                                        })),
                                    ]);
                                } catch { /* Keep the previous snapshot through temporary outages. */ }
                                finally { if (!stopped && alive()) timer = setTimeout(syncPolyRoom, 2000); }
                            };
                            unsubscribe.push(() => { stopped = true; clearTimeout(timer); });
                            void syncPolyRoom();
                        }
                    } catch (mediaErr) {
                        if (!alive()) return;
                        media.close();
                        console.warn('[MeetingRoom] SFU media setup failed, continuing in signaling-only mode:', mediaErr);
                    }
                } else {
                    console.info('[MeetingRoom] SFU not available — running in signaling-only mode (chat, reactions, presence work; video relay disabled)');
                }

                if (!alive()) return;
                // Tell everyone our starting mic / camera state.
                signaling.request('muteStateChanged', { kind: 'audio', muted: audioMutedRef.current }).catch(() => { });
                signaling.request('muteStateChanged', { kind: 'video', muted: videoOffRef.current }).catch(() => { });
                setConnected(true);
                setRestoring(false);
                onConnected();
                if (reconnecting) showNotice('You are back in the meeting.');
            } catch (err) {
                console.error('Failed to join meeting:', err);
                if (alive()) {
                    setWaitingAdmission(null);
                    const message = err instanceof Error ? err.message : 'Could not join the meeting.';
                    if (POLICY_ERRORS.test(message)) {
                        stopLocalMedia(); media.close(); signaling.disconnect();
                        setLocalStream(null); setVideoOff(true); setAudioMuted(true); setRestoring(false);
                        setJoinFailure({ title: /declined|denied/i.test(message) ? 'You were not let in' : 'You can’t join this meeting right now', detail: message });
                    } else {
                        // Network or server hiccup: try again automatically before giving up.
                        dropped();
                    }
                }
            } finally {
                if (alive()) initializingRef.current = false;
            }
        }
        init();
        return () => {
            mounted = false;
            settleAdmission?.({ cancelled: true });
            unsubscribe.forEach((off) => off());
            joinedRef.current = false;
            if (recordingRef.current) void finishRecordingRef.current();
            compositeRef.current?.stop();
            compositeRef.current = null;
            stopLocalMedia();
            media.close();
            signaling.request('leaveRoom', {}).catch(() => { });
            signaling.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meetingCode]);

    /** An external mic unplugged or a headset switched off: move to the default mic instead of going silent. */
    const watchMicrophone = useCallback((track: MediaStreamTrack) => {
        track.addEventListener('ended', async () => {
            if (!sessionActive.current || !localStreamRef.current?.getAudioTracks().includes(track)) return;
            const wasOn = !audioMutedRef.current;
            const revision = sessionRevision.current;
            try {
                const { stream: replacement } = await openMicrophone(undefined, 6000);
                const next = replacement.getAudioTracks()[0];
                const current = localStreamRef.current;
                if (!next || !current || !sessionActive.current || revision !== sessionRevision.current) { replacement.getTracks().forEach(t => t.stop()); return; }
                current.removeTrack(track);
                current.addTrack(next);
                next.enabled = wasOn;
                watchMicrophone(next);
                await publishAudioTrack(next);
                media.setPaused('audio', !wasOn, 'mic');
                setLocalStream(new MediaStream(current.getTracks()));
                showNotice(`Your microphone was disconnected. Switched to ${deviceLabel(next)}.`);
            } catch {
                if (sessionActive.current) { applyMute('audio', true); showNotice('Your microphone was disconnected. Connect one and press the mic button.'); }
            }
        }, { once: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applyMute, publishAudioTrack, showNotice]);

    const togglePrivateMicrophone = useCallback(async () => {
        const conversationId = privateConversationRef.current?.conversationId;
        if (!conversationId) return;
        const isSameConversation = () => privateConversationRef.current?.conversationId === conversationId;
        const nextMuted = !privateMicMutedRef.current;
        if (nextMuted) {
            privateMicMutedRef.current = true;
            setPrivateMicMuted(true);
            if (privateMicTrackRef.current) privateMicTrackRef.current.enabled = false;
            media.setPaused('audio', true, 'private-audio');
            try {
                await signaling.request('setPrivateConversationMuted', { conversationId, muted: true });
            } catch (error) {
                if (isSameConversation()) {
                    privateMicMutedRef.current = false;
                    setPrivateMicMuted(false);
                    if (privateMicTrackRef.current) privateMicTrackRef.current.enabled = true;
                    media.setPaused('audio', false, 'private-audio');
                }
                showNotice(error instanceof Error ? error.message : 'Your private microphone could not be muted.');
            }
            return;
        }

        if (!media.hasProducer('audio', 'private-audio')) {
            let source = localStreamRef.current?.getAudioTracks().find(track => track.readyState === 'live');
            if (!source) {
                if (initializingRef.current || busyRef.current.mic) { showNotice('Preparing your microphone. Try again in a moment.'); return; }
                busyRef.current.mic = true;
                try {
                    const acquired = (await openMicrophone(state.micId)).stream;
                    source = acquired.getAudioTracks()[0];
                    if (!source || !sessionActive.current || !isSameConversation()) { acquired.getTracks().forEach(track => track.stop()); return; }
                    const current = localStreamRef.current ?? new MediaStream();
                    current.getAudioTracks().forEach(old => { old.stop(); current.removeTrack(old); });
                    current.addTrack(source);
                    source.enabled = true;
                    localStreamRef.current = current;
                    watchMicrophone(source);
                    // Keep this track local as the source for the private producer. Do not
                    // publish it as a room microphone while this side conversation is active.
                    media.setPaused('audio', true, 'mic');
                    setLocalStream(new MediaStream(current.getTracks()));
                } catch (error) {
                    showNotice(microphoneMessage(error));
                    return;
                } finally { busyRef.current.mic = false; }
            }
            if (!isSameConversation()) return;
            try {
                privateMicMutedRef.current = false;
                setPrivateMicMuted(false);
                await signaling.request('setPrivateConversationMuted', { conversationId, muted: false });
                if (!isSameConversation()) return;
                const started = await publishPrivateAudio();
                if (!isSameConversation()) return;
                if (!started) throw new Error('Your private microphone could not start. Check browser microphone access and try again.');
            } catch (error) {
                if (isSameConversation()) {
                    privateMicMutedRef.current = true;
                    setPrivateMicMuted(true);
                    if (privateMicTrackRef.current) privateMicTrackRef.current.enabled = false;
                    media.setPaused('audio', true, 'private-audio');
                    signaling.request('setPrivateConversationMuted', { conversationId, muted: true }).catch(() => {});
                }
                showNotice(error instanceof Error ? error.message : 'Your private microphone could not be unmuted.');
            }
            return;
        }

        try {
            await signaling.request('setPrivateConversationMuted', { conversationId, muted: false });
            if (!isSameConversation()) return;
            privateMicMutedRef.current = false;
            setPrivateMicMuted(false);
            if (privateMicTrackRef.current) privateMicTrackRef.current.enabled = true;
            media.setPaused('audio', false, 'private-audio');
        } catch (error) {
            showNotice(error instanceof Error ? error.message : 'Your private microphone could not be unmuted.');
        }
    }, [publishPrivateAudio, showNotice, state.micId, watchMicrophone]);

    const handleToggleAudio = useCallback(async () => {
        if (!canPublishRef.current) { showNotice('Only the webinar organiser can share media.'); return; }
        if (!sessionActive.current) return;
        if (privateConversationRef.current) { await togglePrivateMicrophone(); return; }
        if (audioMutedRef.current && !roomSettingsRef.current.allowMicrophone && !isManagerNow()) { showNotice('The host has turned off microphones for participants. Raise your hand to ask to speak.'); return; }
        const current = localStreamRef.current ?? new MediaStream();
        const live = current.getAudioTracks().some(track => track.readyState === 'live');
        if (live) { applyMute('audio', !audioMutedRef.current); return; }
        if (initializingRef.current) { showNotice('Preparing your microphone. Try again once the meeting connects.'); return; }
        if (busyRef.current.mic) return;
        busyRef.current.mic = true;
        const revision = sessionRevision.current;
        let acquired: MediaStream | null = null;
        try {
            acquired = (await openMicrophone(state.micId)).stream;
            if (!sessionActive.current || revision !== sessionRevision.current) { acquired.getTracks().forEach(t => t.stop()); return; }
            const track = acquired.getAudioTracks()[0];
            current.getAudioTracks().forEach(old => { old.stop(); current.removeTrack(old); });
            current.addTrack(track);
            localStreamRef.current = current;
            watchMicrophone(track);
            await publishAudioTrack(track);
            if (!sessionActive.current || revision !== sessionRevision.current) { track.stop(); return; }
            setLocalStream(new MediaStream(current.getTracks()));
            applyMute('audio', false);
        } catch (error) {
            acquired?.getTracks().forEach(t => t.stop());
            if (!sessionActive.current || revision !== sessionRevision.current) return;
            applyMute('audio', true);
            showNotice(microphoneMessage(error));
        } finally { busyRef.current.mic = false; }
    }, [applyMute, publishAudioTrack, state.micId, showNotice, togglePrivateMicrophone, watchMicrophone]);

    useEffect(() => {
        window.clearTimeout(mutedSpeechTimer.current);
        setMutedSpeechNotice(false);
        const track = localStream?.getAudioTracks().find(t => t.readyState === 'live');
        if (!audioMuted || !pageVisible || !connected || !track || !sessionActive.current) return;
        const stop = watchMutedSpeech(track, () => {
            if (!sessionActive.current || !audioMutedRef.current || document.hidden) return;
            setMutedSpeechNotice(true);
            setMutedSpeechPulse(pulse => pulse + 1);
            window.clearTimeout(mutedSpeechTimer.current);
            mutedSpeechTimer.current = window.setTimeout(() => setMutedSpeechNotice(false), 5000);
        });
        return () => { stop(); window.clearTimeout(mutedSpeechTimer.current); };
    }, [audioMuted, localStream, pageVisible, connected]);

    const watchCamera = useCallback((track: MediaStreamTrack) => {
        const unavailable = () => {
            if (!sessionActive.current || !localStreamRef.current?.getVideoTracks().includes(track)) return;
            applyMute('video', true);
            setCameraNotice('Camera stopped by your browser or device. Start it when you are ready.');
        };
        watchCameraTrack(track, unavailable, interrupted => {
            if (!sessionActive.current || !localStreamRef.current?.getVideoTracks().includes(track)) return;
            setCameraNotice(current => interrupted ? 'Camera temporarily interrupted. Waiting for your browser.' : current.startsWith('Camera temporarily interrupted.') ? '' : current);
        });
    }, [applyMute]);

    const handleToggleVideo = useCallback(async () => {
        if (!canPublishRef.current) { showNotice('Only the webinar organiser can share media.'); return; }
        if (!sessionActive.current || document.hidden) return;
        if (!videoOffRef.current) { applyMute('video', true); setCameraNotice(''); return; }
        if (!roomSettingsRef.current.allowCamera && !isManagerNow()) { showNotice('The host has turned off cameras for participants.'); return; }
        if (initializingRef.current) { showNotice('Preparing your camera. Try again once the meeting connects.'); return; }
        if (busyRef.current.camera) return;
        busyRef.current.camera = true;
        const revision = sessionRevision.current;
        try {
            const { track, fellBack } = await startCameraWithFallback(constraints => cameraCapture.current.start(constraints), state.cameraId);
            if (!track || !sessionActive.current || revision !== sessionRevision.current) { track?.stop(); return; }
            if (fellBack) showNotice(`Your chosen camera was not available. Using ${deviceLabel(track)}.`);
            const current = localStreamRef.current ?? new MediaStream();
            current.getVideoTracks().forEach(old => { old.stop(); current.removeTrack(old); });
            current.addTrack(track);
            localStreamRef.current = current;
            watchCamera(track);
            let relayFailed = !media.canSend;
            if (media.canSend) {
                try {
                    if (media.hasProducer('video', 'camera')) await media.replaceTrack('video', track, 'camera');
                    else await media.produce(track, { source: 'camera' });
                } catch (error) {
                    console.warn('[MeetingRoom] Camera opened, but video relay failed:', error);
                    relayFailed = true;
                }
            }
            if (!sessionActive.current || revision !== sessionRevision.current || track.readyState !== 'live' || document.hidden) { track.stop(); return; }
            setLocalStream(new MediaStream(current.getTracks()));
            applyMute('video', false);
            setCameraNotice(relayFailed ? 'Camera is on locally. Rejoin the meeting to restore video sharing.' : track.muted ? 'Camera temporarily interrupted. Waiting for your browser.' : '');
        } catch (error) {
            if (!sessionActive.current || revision !== sessionRevision.current) return;
            console.warn('[MeetingRoom] Camera access failed:', error);
            applyMute('video', true);
            setCameraNotice(cameraAccessMessage(error));
        } finally { busyRef.current.camera = false; }
    }, [applyMute, state.cameraId, watchCamera, showNotice]);

    useEffect(() => {
        const onVisibility = () => setPageVisible(!document.hidden);
        document.addEventListener('visibilitychange', onVisibility);
        const stopWatchingVisibility = watchCameraVisibility(() => {
            applyMute('video', true);
            setCameraNotice('Camera off while you were away. Start it when you are ready.');
        });
        const onPageHide = () => {
            stopLocalMedia();
            media.close();
            if (recordingRef.current) void finishRecordingRef.current();
            compositeRef.current?.stop();
            compositeRef.current = null;
            setIsRecording(false);
            joinedRef.current = false;
            signaling.disconnect();
            setConnected(false);
            setAudioMuted(true);
            audioMutedRef.current = true;
            setVideoOff(true);
            videoOffRef.current = true;
            setCameraNotice('You left this meeting. Rejoin to use your camera and microphone.');
        };
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) navigate(meetingPreviewPath, { replace: true });
        };
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            stopWatchingVisibility();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, [applyMute, meetingPreviewPath, navigate, stopLocalMedia]);

    const stopScreenShare = useCallback(async () => {
        if (!sharingRef.current) return;
        const revision = sessionRevision.current;
        sharingRef.current = false;
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        setScreenStream(null);
        setScreenSharing(false);
        playSound('toggleOff');
        await media.closeProducerBySource('screen').catch(() => { });
        if (!sessionActive.current || revision !== sessionRevision.current) return;
        if (joinedRef.current) signaling.request('muteStateChanged', { kind: 'screen', muted: false, presenting: false }).catch(() => { });
    }, []);

    stopScreenShareRef.current = stopScreenShare;

    const startScreenShare = useCallback(async () => {
        if (!roomSettingsRef.current.allowScreenShare) { showNotice('Screen sharing is disabled by the host.'); return; }
        if (!sessionActive.current || sharingRef.current || busyRef.current.screen) return;
        if (initializingRef.current || !joinedRef.current || !media.canSend) { showNotice('Screen sharing needs an active media connection. Rejoin and try again.'); return; }
        busyRef.current.screen = true;
        const revision = sessionRevision.current;
        try {
            const display = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080, frameRate: 30 }, audio: true });
            if (!sessionActive.current || revision !== sessionRevision.current || !roomSettingsRef.current.allowScreenShare) { display.getTracks().forEach(t => t.stop()); return; }
            const screenTrack = display.getVideoTracks()[0];
            screenTrack.onended = () => { stopScreenShare(); };
            screenStreamRef.current = display;
            sharingRef.current = true;
            setScreenStream(display);
            setScreenSharing(true);
            if (media.canSend) {
                await media.produce(screenTrack, { source: 'screen', type: 'screen' });
            }
            if (!sessionActive.current || revision !== sessionRevision.current || !sharingRef.current || !roomSettingsRef.current.allowScreenShare || screenTrack.readyState !== 'live') { display.getTracks().forEach(t => t.stop()); return; }
            media.setPaused('video', false, 'screen'); // screen sharing is independent of camera state
            playSound('success');
            if (joinedRef.current) signaling.request('muteStateChanged', { kind: 'screen', muted: true, presenting: true }).catch(() => { });
        } catch (err) {
            if (!sessionActive.current || revision !== sessionRevision.current) return;
            if (sharingRef.current) await stopScreenShare();
            if (!sessionActive.current || revision !== sessionRevision.current) return;
            if (sessionActive.current && (err as DOMException)?.name !== 'NotAllowedError') showNotice('Screen sharing is not available.');
        } finally {
            busyRef.current.screen = false;
        }
    }, [stopScreenShare, showNotice]);

    const handleScreenShare = useCallback(() => {
        if (!canPublishRef.current) { showNotice('Only the webinar organiser can share media.'); return; }
        if (!sharingRef.current && !roomSettings.allowScreenShare) { showNotice('Screen sharing is disabled by the host.'); return; }
        if (sharingRef.current) stopScreenShare(); else startScreenShare();
    }, [startScreenShare, stopScreenShare, roomSettings.allowScreenShare, showNotice]);

    const savePendingRecording = useCallback(async () => {
        const pending = pendingRecording.current;
        if (!pending || !meetingCode || busyRef.current.record) return !pending;
        busyRef.current.record = true;
        setRecordingStatus('Saving recording privately… Keep this tab open.');
        try {
            await recordingManager.uploadRecording(pending.meetingCode, pending.blob, pending.id);
            pendingRecording.current = null; recordingManager.pending = null;
            setRecordingStatus('Recording saved.');
            return true;
        } catch (reason) {
            setRecordingStatus(reason instanceof Error ? reason.message : 'Upload failed. Retry before leaving.');
            return false;
        } finally { busyRef.current.record = false; }
    }, [meetingCode]);

    const finishRecording = useCallback((): Promise<boolean> => {
        if (finalizingRecording.current) return finalizingRecording.current;
        if (!recordingRef.current) return Promise.resolve(!pendingRecording.current);
        recordingRef.current = false;
        busyRef.current.record = true;
        setIsRecording(false);
        setRecordingStatus('Finishing recording… Keep this tab open.');
        if (joinedRef.current) void signaling.request('setRecordingState', { recording: false }).catch(() => {});
        const task = (async () => {
            try {
                const result = await recordingManager.stopRecording();
                pendingRecording.current = { blob: result.blob, format: result.format, meetingCode: meetingCode || '', id: crypto.randomUUID() };
                recordingManager.pending = pendingRecording.current;
            } catch (reason) {
                setRecordingStatus(reason instanceof Error ? reason.message : 'Recording could not be saved.');
                return false;
            } finally {
                compositeRef.current?.stop(); compositeRef.current = null;
                busyRef.current.record = false;
            }
            return savePendingRecording();
        })();
        finalizingRecording.current = task;
        void task.finally(() => { finalizingRecording.current = null; });
        return task;
    }, [savePendingRecording, meetingCode]);
    finishRecordingRef.current = finishRecording;

    const handleToggleRecording = useCallback(async () => {
        if (recordingRef.current) { await finishRecording(); return; }
        if (!isPlatformAdmin && entitlements.loading) { showNotice('Checking your plan…'); return; }
        if (!hasFeature(entitlements, 'cloud_recording')) {
            window.dispatchEvent(new CustomEvent('qsvc:upgrade-required', { detail: { requiredPlan: entitlements.featureMinimumPlans.cloud_recording || 'pro', feature: 'cloud_recording', returnTo: `${location.pathname}${location.search}${location.hash}` } }));
            return;
        }
        if (busyRef.current.record || pendingRecording.current) { showNotice('Finish saving the previous recording first.'); return; }
        if (myRole !== 'host' || !getToken()) { showNotice('Sign in as the meeting host to record.'); return; }
        if (!connected || !meetingCode) return;
        if (!window.confirm('Record this meeting? Everyone will see a recording indicator. This demo stops near 70 MB (roughly 7 minutes). Keep this tab open until the cloud save finishes.')) return;
        busyRef.current.record = true;
        try {
            // Validate cloud readiness before capturing; lists require authenticated ownership.
            await recordingRequest(`meeting/${encodeURIComponent(meetingCode)}`);
            await signaling.request('setRecordingState', { recording: true });
            if (!sessionActive.current || !joinedRef.current) throw new Error('The meeting has disconnected.');
            const composite = createMeetingComposite(() => videoAreaRef.current, () => [
                ...(privateConversationRef.current ? [] : localStreamRef.current?.getAudioTracks() || []),
                ...(screenStreamRef.current?.getAudioTracks() || []),
                ...Array.from(peersRef.current.values()).flatMap(peer => peer.audioTrack ? [peer.audioTrack] : []),
            ], `QS-VC ${meetingCode}`);
            compositeRef.current = composite;
            await recordingManager.startRecording(composite.stream, () => {
                if (!recordingRef.current) return;
                setRecordingStatus('Recording stopped. Saving…');
                void finishRecordingRef.current();
            });
            recordingRef.current = true;
            setIsRecording(true);
            setRecordingStatus('');
        } catch (reason) {
            compositeRef.current?.stop(); compositeRef.current = null;
            void signaling.request('setRecordingState', { recording: false }).catch(() => {});
            showNotice(reason instanceof Error ? reason.message : 'Recording could not start.');
        } finally { busyRef.current.record = false; }
    }, [finishRecording, meetingCode, myRole, connected, showNotice, entitlements.loading, entitlements.features, entitlements.featureMinimumPlans, isPlatformAdmin, location.hash, location.pathname, location.search]);

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (recordingRef.current || pendingRecording.current || busyRef.current.record) { event.preventDefault(); event.returnValue = ''; }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    const handleRaiseHand = useCallback(() => {
        const next = !handRaisedRef.current;
        handRaisedRef.current = next;
        setHandRaised(next);
        // Server method is 'raiseHand' (was sent as 'handRaise' and never reached others).
        signaling.request('raiseHand', { raised: next }).catch(() => { });
    }, []);
    const handleSendReaction = useCallback((emoji: string) => {
        if (!roomSettingsRef.current.allowReactions && !isManagerNow()) { showNotice('The host has turned off reactions.'); return; }
        pushReaction(emoji, displayName, true);
        signaling.request('reaction', { emoji }).catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayName, showNotice]);
    const expireReaction = useCallback((id: string) => setReactions((prev) => prev.filter((r) => r.id !== id)), []);
    const closeReactions = useCallback(() => setReactionsOpen(false), []);
    const closeLanguage = useCallback(() => {
        setLanguageOpen(false);
        document.querySelector<HTMLButtonElement>('[aria-controls="meeting-language-settings"]')?.focus();
    }, []);
    const chooseLanguage = useCallback((code: string) => {
        setMeetingLanguage(code);
        setSpeechLanguage({ code, source: 'saved' });
    }, []);
    const applyDetectedLanguage = useCallback(() => {
        clearSavedLanguage();
        const detected = detectLanguage();
        setSpeechLanguage(detected);
        window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { code: detected.code } }));
    }, []);
    // Announce the starting language so a speech-to-text engine can pick it up.
    useEffect(() => {
        window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { code: speechLanguage.code } }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const handleLeave = useCallback(async () => {
        if (busyRef.current.record) { showNotice('Wait until the recording finishes saving.'); return; }
        if (recordingRef.current && !await finishRecording()) return;
        if (pendingRecording.current) { showNotice('Retry saving, or open Recording actions to download or discard the unsaved copy.'); return; }
        stopLocalMedia();
        joinedRef.current = false;
        media.close();
        signaling.request('leaveRoom', {}).catch(() => { });
        signaling.disconnect();
        // Replace the meeting entry so browser Back does not drop people straight back into the call.
        if (connected) navigate('/meeting-end', { replace: true, state: { meetingCode, duration, participantCount: peersRef.current.size + 1, chatMessageCount: chatMessages.length, left: true } });
        else navigate('/app', { replace: true });
    }, [finishRecording, navigate, stopLocalMedia, showNotice, meetingCode, connected, duration, chatMessages.length]);
    const handleSendChat = useCallback((content: string) => { if (!roomSettings.allowChat && myRole !== 'host' && myRole !== 'co-host') { showNotice('Chat is disabled by the host.'); return; } signaling.request('chatMessage', { content, type: 'text' }).catch(() => { showNotice('Your message could not be sent.'); }); }, [roomSettings.allowChat, myRole, showNotice]);
    const closeChat = useCallback(() => {
        setChatOpen(false);
        document.querySelector<HTMLButtonElement>('[aria-controls="meeting-chat-panel"]')?.focus();
    }, []);

    const formatDuration = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
            : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };
    const localTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(clockNow);
    const localDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(clockNow);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
    const timeZoneLabel = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(clockNow).find(part => part.type === 'timeZoneName')?.value || timeZone;

    const answerKnock = useCallback((peerId: string, admit: boolean) => {
        setKnocks(current => current.filter(k => k.peerId !== peerId));
        signaling.request(admit ? 'admitPeer' : 'rejectPeer', { targetPeerId: peerId }).then(() => {
            if (!admit) notifiedKnocks.current.delete(peerId);
        }).catch((error: Error) => showNotice(error?.message || 'That request could not be answered.'));
    }, [showNotice]);
    const endForEveryone = useCallback(async () => {
        setLeaveOpen(false);
        try { await signaling.request('endMeeting', {}); } catch (error) { showNotice(error instanceof Error ? error.message : 'The meeting could not be ended.'); return; }
        void handleLeave();
    }, [handleLeave, showNotice]);
    const requestLeave = useCallback(() => {
        if (myRole === 'host' && connected && peers.size > 0) { setLeaveOpen(true); return; }
        void handleLeave();
    }, [myRole, connected, peers.size, handleLeave]);

    const privateConversationLimitMs = isPlatformAdmin ? null : entitlements.privateConversationLimitSeconds !== undefined
        ? (entitlements.privateConversationLimitSeconds === null ? null : entitlements.privateConversationLimitSeconds * 1000)
        : entitlements.plan === 'pro' || (entitlements.plan === 'enterprise' && entitlements.status === 'enterprise_approved')
            ? null
            : entitlements.plan === 'starter' || (entitlements.plan === 'starter_trial' && entitlements.status === 'trial_active')
                ? 30 * 60 * 1000 : 2 * 60 * 1000;
    const privateConversationLimitLabel = privateConversationLimitMs === null ? 'Unlimited' : `${Math.ceil(privateConversationLimitMs / 60_000)} min`;

    const startPrivateConversation = useCallback(async (targetPeerId: string) => {
        if (!signedIn || (myRoleRef.current !== 'host' && myRoleRef.current !== 'co-host')) { showNotice('Only a signed-in host or co-host can start a private conversation.'); return; }
        if (privateConversationRef.current || privateInviteRef.current) { showNotice('Finish the current private conversation first.'); return; }
        try {
            const targetName = peersRef.current.get(targetPeerId)?.displayName || 'participant';
            const result = await signaling.request('startPrivateConversation', { targetPeerId });
            setPrivateInvite({ conversationId: result.conversationId, otherPeerId: targetPeerId, otherDisplayName: targetName, direction: 'outgoing', durationMs: result.durationMs ?? privateConversationLimitMs });
        } catch (error) { showNotice(error instanceof Error ? error.message : 'The invitation could not be sent.'); }
    }, [privateConversationLimitMs, showNotice, signedIn]);

    const acceptPrivateConversation = useCallback(async () => {
        const invite = privateInviteRef.current;
        if (!invite || invite.direction !== 'incoming') return;
        try { await signaling.request('acceptPrivateConversation', { conversationId: invite.conversationId }); }
        catch (error) { showNotice(error instanceof Error ? error.message : 'The private invitation is no longer available.'); finishPrivateConversationLocally(invite.conversationId); }
    }, [finishPrivateConversationLocally, showNotice]);

    const declinePrivateConversation = useCallback(async () => {
        const invite = privateInviteRef.current;
        if (!invite || invite.direction !== 'incoming') return;
        try { await signaling.request('declinePrivateConversation', { conversationId: invite.conversationId }); }
        catch (error) { showNotice(error instanceof Error ? error.message : 'The invitation could not be declined.'); }
        finishPrivateConversationLocally(invite.conversationId);
    }, [finishPrivateConversationLocally, showNotice]);

    const cancelPrivateConversationInvite = useCallback(async () => {
        const invite = privateInviteRef.current;
        if (!invite || invite.direction !== 'outgoing') return;
        try { await signaling.request('cancelPrivateConversation', { conversationId: invite.conversationId }); }
        catch (error) { showNotice(error instanceof Error ? error.message : 'The invitation could not be cancelled.'); }
        finishPrivateConversationLocally(invite.conversationId);
    }, [finishPrivateConversationLocally, showNotice]);

    const endPrivateConversation = useCallback(async () => {
        const active = privateConversationRef.current;
        if (!active) return;
        try { await signaling.request('endPrivateConversation', { conversationId: active.conversationId }); }
        catch (error) { showNotice(error instanceof Error ? error.message : 'The private conversation could not be ended.'); }
        finishPrivateConversationLocally(active.conversationId);
    }, [finishPrivateConversationLocally, showNotice]);

    const togglePrivateFocusAudio = useCallback(() => setFocusPrivateAudio(value => !value), []);

    // ── Background effects: process the live camera track and send the processed one. ──
    const effectKey = JSON.stringify({ ...effect, src: effect.kind === 'image' ? effect.src?.length : undefined });
    useEffect(() => {
        const raw = localStream?.getVideoTracks().find(track => track.readyState === 'live');
        const sendTrack = (track: MediaStreamTrack) => { if (media.canSend && media.hasProducer('video', 'camera')) void media.replaceTrack('video', track, 'camera').catch(() => {}); };
        if (effect.kind === 'none' || videoOff || !raw) {
            processorRef.current?.stop(); processorSourceRef.current = '';
            processedTrackRef.current = null; setProcessedTrack(null); setEffectStatus('idle');
            if (raw && !videoOff) sendTrack(raw);
            return;
        }
        const processor = processorRef.current ??= new BackgroundProcessor();
        if (processorSourceRef.current === raw.id && processedTrackRef.current?.readyState === 'live') { void processor.setEffect(effect); return; }
        let cancelled = false;
        setEffectStatus('loading'); setEffectError('');
        processorSourceRef.current = raw.id;
        processor.stop();
        processor.start(raw, effect).then(track => {
            if (cancelled || raw.readyState !== 'live') { return; }
            processedTrackRef.current = track; setProcessedTrack(track); setEffectStatus('ready');
            sendTrack(track);
        }).catch((reason: Error) => {
            if (cancelled) return;
            processorSourceRef.current = ''; processedTrackRef.current = null; setProcessedTrack(null);
            setEffectStatus('error'); setEffectError(`${reason?.message || 'Background effects failed to start.'} Your normal camera is being shown.`);
            sendTrack(raw);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localStream, videoOff, effectKey]);
    useEffect(() => () => { processorRef.current?.dispose(); processorRef.current = null; }, []);
    const chooseEffect = useCallback((next: BackgroundEffect) => { setEffect(next); saveEffect(next); }, []);
    const displayedLocalStream = useMemo(() => {
        if (!processedTrack || !localStream) return localStream;
        return new MediaStream([processedTrack, ...localStream.getAudioTracks()]);
    }, [processedTrack, localStream]);

    const effectPreview = useMemo(() => processedTrack ? new MediaStream([processedTrack]) : localStream, [processedTrack, localStream]);

    // ── Captions (CC button) ──
    const toggleCaptions = useCallback(() => {
        if (captionsOn) { setCaptionsOn(false); setShareSpeech(false); stopSpeechRecognition.current(); return; }
        setCaptionsOn(true);
        if (!signedIn) {
            showNotice(`Captions are on in ${findLanguage(guestCaptionLanguage)?.name || 'your language'}, chosen from your location. Sign in to change the language or hear translated speech.`);
            return;
        }
        // Server recognition (any modern browser) or the browser's own recognizer.
        const supported = SpeechToTextEngine.isSupported() || ServerSpeechEngine.isSupported();
        if (!canPublishRef.current) { showNotice('Captions are on. You’ll see what the speakers say.'); return; }
        if (supported && hasCaptionConsent()) { setShareSpeech(true); showNotice('Captions are on, including your own speech.'); }
        else if (supported) { setLanguageOpen(true); setReactionsOpen(false); showNotice('Captions are on. To let others read what you say, turn on “Share my speech as captions”.'); }
        else showNotice('Captions are on. This browser can’t caption your own speech, but you’ll see what others say.');
    }, [captionsOn, showNotice, signedIn, guestCaptionLanguage]);
    const closePanels = useCallback(() => {
        setChatOpen(false); setParticipantsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); setEffectsOpen(false);
    }, []);
    const openInformation = useCallback(() => {
        closePanels(); setLanguageOpen(false); setReactionsOpen(false); setInformationOpen(true);
    }, [closePanels]);

    useEffect(() => {
        if (!signedIn || (entitlements.loading && !isPlatformAdmin)) return;
        let feature = '';
        try {
            feature = sessionStorage.getItem('qsvc:intended-feature') || '';
            if (feature) sessionStorage.removeItem('qsvc:intended-feature');
        } catch { return; }
        if (!feature) return;
        if (!hasFeature(entitlements, feature)) { requestPlanFeature(feature); return; }
        if (feature === 'ai_noise_suppression') void changeNoiseMode('ai');
        else if (feature === 'ai_captions') toggleCaptions();
        else if (feature === 'background_effects') { closePanels(); setEffectsOpen(true); }
    }, [signedIn, entitlements.loading, entitlements.features, isPlatformAdmin, requestPlanFeature, changeNoiseMode, toggleCaptions, closePanels]);

    // ── Full screen ──
    useEffect(() => {
        const sync = () => setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === roomRef.current);
        document.addEventListener('fullscreenchange', sync);
        return () => document.removeEventListener('fullscreenchange', sync);
    }, []);
    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenEnabled) { showNotice('Full screen isn’t available in this browser.'); return; }
        if (document.fullscreenElement) void document.exitFullscreen();
        else void roomRef.current?.requestFullscreen().catch(() => showNotice('Full screen was blocked by your browser.'));
    }, [showNotice]);

    // ── Spotlight & stage (host/co-host) ──
    const setSpotlightFor = useCallback((peerId: string | null) => {
        signaling.request('setSpotlight', { targetPeerId: peerId }).catch((error: Error) => showNotice(error?.message || 'Spotlight could not be changed.'));
    }, [showNotice]);
    const setStageFor = useCallback((peerId: string, onStage: boolean) => {
        signaling.request('setStage', { targetPeerId: peerId, onStage }).catch((error: Error) => showNotice(error?.message || 'The stage could not be changed.'));
    }, [showNotice]);

    // ── Who is speaking (grid highlight, People panel, active speaker on page 1) ──
    const speakingTracks = useMemo(() => [
        { id: myPeerIdRef.current || 'self', track: localStream?.getAudioTracks()[0], muted: audioMuted },
        ...Array.from(peers.values()).map(p => ({ id: p.peerId, track: p.audioTrack, muted: !!p.audioMuted })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [localStream, audioMuted, peers, connected]);
    const { speaking, activeSpeaker } = useSpeaking(speakingTracks);

    // ── Report a problem ──
    const collectDiagnostics = useCallback(async () => {
        const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
        const settings = (track?: MediaStreamTrack) => track ? { label: track.label, state: track.readyState, enabled: track.enabled, muted: track.muted, ...track.getSettings?.(), deviceId: undefined, groupId: undefined } : null;
        const connection = (navigator as any).connection;
        return {
            time: new Date().toISOString(), userAgent: navigator.userAgent, language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`, online: navigator.onLine,
            network: connection ? { type: connection.effectiveType, downlink: connection.downlink, rtt: connection.rtt } : undefined,
            meeting: { connected, reconnecting: restoring, role: myRole, participants: peers.size + 1, webinar, mediaRelay: media.canSend, sharing: screenSharing, captions: captionsOn, effect: effectLabel(effect), effectStatus },
            microphone: settings(localStreamRef.current?.getAudioTracks()[0]), camera: settings(localStreamRef.current?.getVideoTracks()[0]),
            devices: devices.slice(0, 20).map(d => ({ kind: d.kind, label: d.label || '(hidden until permission)' })),
            lastNotice: notice || cameraNotice || undefined,
        };
    }, [connected, restoring, myRole, peers.size, webinar, screenSharing, captionsOn, effect, effectStatus, notice, cameraNotice]);

    const sidePanelOpen = chatOpen || participantsOpen || activitiesOpen || hostToolsOpen || effectsOpen;
    const manager = myRole === 'host' || myRole === 'co-host';
    const closeActivityPanel = () => { setActivitiesOpen(false); setHostToolsOpen(false); document.querySelector<HTMLButtonElement>('[aria-label="More controls"]')?.focus(); };
    if (waitingAdmission) return <WaitingAdmission mode={waitingAdmission} meetingCode={meetingCode || ''} onLeave={handleLeave} />;
    if (joinFailure) return <main className="waiting-admission meeting-join-failure"><div>
        <span className="mi" aria-hidden="true">block</span>
        <h1>{joinFailure.title}</h1>
        <p role="alert">{joinFailure.detail}</p>
        <div className="waiting-admission-actions">
            <button type="button" onClick={() => navigate(meetingPreviewPath, { replace: true })}>Try again</button>
            <button type="button" className="btn-text" onClick={() => navigate('/app')}>Back to meetings</button>
        </div>
    </div></main>;

    return (
        <div className="meeting-room" ref={roomRef} data-fullscreen={isFullscreen || undefined}>
            <div className="meeting-top-bar">
                <div className="top-bar-left">
                    <BrandLogo meeting iconOnly />
                    <button type="button" className="meeting-info-trigger" onClick={openInformation} aria-label="Meeting information" aria-haspopup="dialog" aria-expanded={informationOpen} title="Meeting information">
                        <span className="mi" aria-hidden="true">info</span>
                    </button>
                    <div className="meeting-local-clock" title={`Your local time · ${timeZone}`} aria-label={`Your local time is ${localTime}, ${localDate}, ${timeZone}`}>
                        <time dateTime={clockNow.toISOString()}>{localTime}</time>
                        <span className="meeting-local-clock-meta"><span>{localDate}</span><span className="meeting-local-clock-zone">{timeZoneLabel}</span></span>
                    </div>
                </div>
                <div className="top-bar-center">
                    <h1 className="meeting-room-title" data-length={meetingTitleLength} title={meetingTitle || 'Meeting'} aria-label={meetingTitle || 'Meeting'}>{displayedMeetingTitle}</h1>
                    <span className="meeting-timer">{formatDuration(duration)}</span>
                    {roomRecording && <span className="recording-indicator" role="status"><span className="mi mi-sm" aria-hidden="true">fiber_manual_record</span> {roomRecording.displayName} is recording</span>}
                    {(() => {
                        const presenters = [...(screenSharing ? ['You'] : []), ...Array.from(peers.values()).filter(p => p.presenting).map(p => p.displayName)];
                        return presenters.length > 0 && <span className="qs-topchip" role="status"><span className="mi" aria-hidden="true">present_to_all</span>{presenters.length === 1 ? (presenters[0] === 'You' ? 'You are presenting' : `${presenters[0]} is presenting`) : `${presenters.join(', ')} are presenting`}</span>;
                    })()}
                    {spotlightId && <span className="qs-topchip qs-topchip--spot"><span className="mi" aria-hidden="true">star</span>Spotlight: {spotlightId === myPeerIdRef.current ? 'You' : peers.get(spotlightId)?.displayName || 'participant'}{manager && <button type="button" onClick={() => setSpotlightFor(null)}>Remove</button>}</span>}
                    {webinar && (() => {
                        const audience = (manager || myOnStage ? 0 : 1) + Array.from(peers.values()).filter(p => p.role !== 'host' && p.role !== 'co-host' && !p.onStage).length;
                        return <span className="qs-topchip qs-topchip--spot" title="Webinar"><span className="mi" aria-hidden="true">podium</span>{!manager && !myOnStage ? 'You’re in the audience' : myOnStage && !manager ? 'You’re on stage' : 'Webinar'}{audience > 0 ? ` · ${audience} watching` : ''}</span>;
                    })()}
                </div>
                <div className="top-bar-right">
                    <span className="participant-count"><span className="mi mi-sm">group</span> {peers.size + 1}</span>
                </div>
            </div>

            <div className="meeting-notices">
            {incomingChatMessage && <div className="meeting-chat-toast" role="status">
                <span className="mi mi-sm" aria-hidden="true">chat</span>
                <button type="button" className="meeting-chat-toast-open" onClick={() => {
                    setIncomingChatMessage(null);
                    setChatOpen(true);
                    setParticipantsOpen(false);
                    setActivitiesOpen(false);
                    setHostToolsOpen(false);
                    setEffectsOpen(false);
                }} aria-label={`Open chat message from ${incomingChatMessage.displayName}`}>
                    <strong>{incomingChatMessage.displayName}</strong>
                    <span>{incomingChatMessage.content}</span>
                </button>
                <button type="button" className="meeting-chat-toast-close" onClick={() => setIncomingChatMessage(null)} aria-label="Dismiss message notification">
                    <span className="mi mi-sm" aria-hidden="true">close</span>
                </button>
            </div>}
            {restoring && !connectionLost && <div className="meeting-notice" role="status"><span className="mi mi-sm meeting-spin" aria-hidden="true">progress_activity</span> Reconnecting… Hold on, we’re getting you back into the meeting.</div>}
            {connectionLost && <div className="meeting-notice" role="alert">Connection lost. Check your internet connection, then rejoin.
                <button className="btn-outline" onClick={() => navigate(meetingPreviewPath, { replace: true })}>Rejoin meeting</button>
            </div>}
            {knocks.length > 0 && (myRole === 'host' || myRole === 'co-host') && <div className="meeting-knock" role="alert">
                <span className="mi" aria-hidden="true">person_add</span>
                <p>{knocks.length === 1 ? <><strong>{knocks[0].displayName}</strong> wants to join</> : <><strong>{knocks.length} people</strong> want to join</>}</p>
                {knocks.length === 1 ? <>
                    <button type="button" className="btn-text" onClick={() => answerKnock(knocks[0].peerId, false)}>Deny</button>
                    <button type="button" className="btn-outline" onClick={() => answerKnock(knocks[0].peerId, true)}>Admit</button>
                </> : <button type="button" className="btn-outline" onClick={() => { setHostToolsOpen(true); setActivitiesOpen(false); setChatOpen(false); setParticipantsOpen(false); }}>View all</button>}
            </div>}
            {(cameraNotice || notice) && <div className="meeting-notice" role="status">
                {cameraNotice || notice}
                {cameraNotice && videoOff && sessionActive.current && <button type="button" className="btn-text" onClick={handleToggleVideo}>Start camera</button>}
            </div>}

            {mutedSpeechNotice && audioMuted && <div className="muted-speech-notice" role="status">
                <span>You’re speaking while muted.</span>
                <button type="button" className="btn-text" onClick={handleToggleAudio}>Unmute mic</button>
            </div>}

            </div>
            <div className="meeting-content">
                <div ref={videoAreaRef} className={`video-area ${sidePanelOpen ? 'with-panel' : ''}`}>
                    <VideoGrid localStream={displayedLocalStream} localScreenTrack={screenStream?.getVideoTracks()[0]} myPeerId={myPeerIdRef.current} myRole={myRole} myOnStage={myOnStage} peers={peers} displayName={displayName} videoOff={videoOff} audioMuted={audioMuted} handRaised={handRaised} sharing={screenSharing}
                        viewMode={viewMode} tilesPerPage={tilesPerPage} webinar={webinar} speaking={speaking} activeSpeaker={activeSpeaker} spotlightId={spotlightId} pinnedId={pinnedId}
                        canManage={manager} onPin={setPinnedId} onSpotlight={setSpotlightFor} onToggleStage={setStageFor} />
                    <RemoteAudio peers={peers} volume={privateConversation ? focusPrivateAudio ? 0 : 0.24 : translatedSpeaking ? 0.2 : 1} outputDeviceId={audioOutputId} onOutputError={reportAudioOutputError} />
                    {privateAudioTrack && <PrivateAudioPlayback track={privateAudioTrack} outputDeviceId={audioOutputId} onOutputError={reportAudioOutputError} />}
                    <PrivateConversationPanel invite={privateInvite} active={privateConversation} microphoneMuted={privateMicMuted} focusAudio={focusPrivateAudio}
                        onAccept={acceptPrivateConversation} onDecline={declinePrivateConversation} onCancel={cancelPrivateConversationInvite}
                        onEnd={endPrivateConversation} onToggleMicrophone={() => void togglePrivateMicrophone()} onToggleFocusAudio={togglePrivateFocusAudio} />
                    <ReactionsOverlay reactions={reactions} pickerOpen={reactionsOpen} onSendReaction={handleSendReaction} onClosePicker={closeReactions} onExpire={expireReaction} />
                    <MeetingCaptions translatedSpeaking={translatedSpeaking} stopRecognition={stopSpeechRecognition} open={languageOpen} onClose={closeLanguage} connected={connected} audioMuted={audioMuted} speakingLanguage={speechLanguage.code} onSpeakingLanguageChange={chooseLanguage} onUseDetectedLanguage={applyDetectedLanguage} displayName={displayName} myPeerId={getMyPeerId} onSpeakingChange={handleTranslatedSpeaking}
                        showCaptions={captionsOn} onShowCaptionsChange={setCaptionsOn} shareSpeech={shareSpeech} onShareSpeechChange={setShareSpeech}
                        getMicTrack={getCaptionMicTrack} isHost={manager} meetingCode={meetingCode}
                        viewOnly={!signedIn} viewerLanguage={guestCaptionLanguage} />
                </div>

                {chatOpen && <MeetingChat messages={chatMessages} onSend={handleSendChat} onClose={closeChat} />}

                {participantsOpen && (
                    <ParticipantsPanel peers={peers} displayName={displayName} myPeerId={myPeerIdRef.current || 'self'} myRole={myRole} myOnStage={myOnStage} audioMuted={audioMuted} videoOff={videoOff} handRaised={handRaised} presenting={screenSharing}
                        speaking={speaking} webinar={webinar} spotlightId={spotlightId} canManage={manager} onSpotlight={setSpotlightFor} onToggleStage={setStageFor}
                        canStartPrivateConversation={signedIn && manager && connected && (isPlatformAdmin || !entitlements.loading)} privateConversationLimitLabel={privateConversationLimitLabel}
                        privateConversationPeerId={privateConversation?.otherPeerId || privateInvite?.otherPeerId || null}
                        privateConversationStatus={privateConversation ? 'active' : privateInvite?.direction === 'outgoing' ? 'outgoing' : 'idle'}
                        onStartPrivateConversation={startPrivateConversation} onClose={() => setParticipantsOpen(false)} />
                )}
                <MeetingCollaboration key={meetingCode} open={activitiesOpen} connected={connected} role={myRole} myPeerId={myPeerIdRef.current} onClose={closeActivityPanel} />
                {effectsOpen && <BackgroundEffects effect={effect} onChange={chooseEffect} preview={effectPreview} cameraOn={!videoOff && !!localStream?.getVideoTracks().some(t => t.readyState === 'live')}
                    status={effectStatus} error={effectError} onStartCamera={handleToggleVideo} onClose={() => setEffectsOpen(false)} />}
                {hostToolsOpen && manager && <HostMeetingTools roomDevicesEnabled={roomDevicesEnabled && !webinar && Boolean(getToken())} role={myRole} myPeerId={myPeerIdRef.current} participants={[{ peerId: myPeerIdRef.current, displayName, role: myRole, audioMuted, videoOff, handRaised }, ...Array.from(peers.values()).map(peer => ({ ...peer, role: peer.role || 'member', videoOff: peer.videoOff ?? !peer.videoTrack }))]} settings={roomSettings} onClose={closeActivityPanel} onEndMeeting={() => setLeaveOpen(true)} />}
            </div>

            {recordingStatus && <div className="meeting-recording-status" role="status">{recordingStatus}
                {pendingRecording.current ? <details><summary>Recording actions</summary><button type="button" onClick={() => void savePendingRecording()}>Retry saving</button><button type="button" onClick={() => { const pending = pendingRecording.current; if (pending) recordingManager.downloadLocally(pending.blob, `QS-VC-${meetingCode}.${pending.format}`); }}>Download unsaved copy</button><button type="button" onClick={() => { if (window.confirm('Discard the unsaved recording? This copy cannot be recovered.')) { pendingRecording.current = null; recordingManager.pending = null; setRecordingStatus('Unsaved copy discarded. You can leave the meeting.'); } }}>Discard unsaved copy</button></details> : <a href={`/recordings/${encodeURIComponent(meetingCode || '')}`}>Manage recordings</a>}
            </div>}
            <ControlBar
                assistant={signedIn ? <AIChatBot onOpen={() => { setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }} closeSignal={chatOpen || participantsOpen || activitiesOpen || hostToolsOpen || informationOpen} /> : undefined}
                signedIn={signedIn}
                captionsLocked={signedIn && !isPlatformAdmin && (entitlements.loading || !hasFeature(entitlements, 'ai_captions'))}
                effectsLocked={!isPlatformAdmin && (entitlements.loading || !hasFeature(entitlements, 'background_effects'))}
                noiseMode={noiseMode}
                aiNoiseSuppressionLocked={!isPlatformAdmin && (entitlements.loading || !hasFeature(entitlements, 'ai_noise_suppression'))}
                onChangeNoiseMode={changeNoiseMode}
                onRequirePlanFeature={requestPlanFeature}
                onSignInForExtras={() => window.dispatchEvent(new CustomEvent('qsvc:upgrade-required', { detail: { requiredPlan: 'starter', returnTo: `${location.pathname}${location.search}${location.hash}` } }))}
                activitiesOpen={activitiesOpen} hostToolsOpen={hostToolsOpen}
                onToggleActivities={() => { setActivitiesOpen(value => !value); setHostToolsOpen(false); setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); setEffectsOpen(false); }}
                onToggleHostTools={manager ? () => { setHostToolsOpen(value => !value); setActivitiesOpen(false); setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); } : undefined}
                viewMode={viewMode} onChangeView={changeView} tilesPerPage={tilesPerPage} onChangeTilesPerPage={changeTiles} activitySignal={mutedSpeechPulse} keepSideVisible={mutedSpeechNotice}
                audioOutputId={audioOutputId} audioOutputDevices={audioOutputDevices} audioOutputSupported={audioOutputSupported}
                onAudioOutputChange={setAudioOutputId} onChooseAudioOutput={audioOutputPickerSupported ? chooseAudioOutput : undefined}
                captionsOn={captionsOn} onToggleCaptions={toggleCaptions}
                fullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
                effectsOn={effect.kind !== 'none'} onOpenEffects={() => { closePanels(); setEffectsOpen(true); setLanguageOpen(false); setReactionsOpen(false); }}
                onReportProblem={() => setReportOpen(true)}
                audioMuted={audioMuted} videoOff={videoOff} screenSharing={screenSharing}
                isRecording={isRecording} canRecord={myRole === 'host' && !!getToken()} recordingLocked={!isPlatformAdmin && (entitlements.loading || !hasFeature(entitlements, 'cloud_recording'))} chatOpen={chatOpen} participantsOpen={participantsOpen}
                handRaised={handRaised} reactionsOpen={reactionsOpen}
                onToggleReactions={() => { setReactionsOpen((open) => !open); setLanguageOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                languageOpen={languageOpen} languageLabel={findLanguage(signedIn ? speechLanguage.code : guestCaptionLanguage)?.name} languageCode={(signedIn ? speechLanguage.code : guestCaptionLanguage).split('-')[0].toUpperCase()}
                onToggleLanguage={signedIn ? () => { setLanguageOpen((open) => !open); setReactionsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); } : undefined}
                onToggleAudio={handleToggleAudio} onToggleVideo={handleToggleVideo}
                onToggleScreen={handleScreenShare} onToggleRecording={handleToggleRecording}
                onToggleChat={() => { if (!roomSettings.allowChat && !manager) { showNotice('Chat is disabled by the host.'); return; } setIncomingChatMessage(null); setChatOpen(!chatOpen); setParticipantsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); setEffectsOpen(false); }}
                onToggleParticipants={() => { setParticipantsOpen(!participantsOpen); setChatOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); setEffectsOpen(false); }}
                onRaiseHand={handleRaiseHand} onLeave={requestLeave}
            />
            <MeetingInformation open={informationOpen} meetingCode={meetingCode || ''} joinUrl={`${window.location.origin}${meetingPreviewPath}`} meetingTitle={meetingTitle} onClose={() => setInformationOpen(false)} />
            {reportOpen && <ReportProblem meetingCode={meetingCode || ''} displayName={displayName} diagnostics={collectDiagnostics} onClose={() => setReportOpen(false)} />}
            {leaveOpen && <div className="meeting-dialog-backdrop" onClick={() => setLeaveOpen(false)}>
                <div className="meeting-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setLeaveOpen(false); }}>
                    <h2 id="leave-title">Leave the meeting?</h2>
                    <p>You can leave and let the meeting continue, or end it for everyone.</p>
                    <div className="meeting-dialog-actions">
                        <button type="button" className="btn-text" autoFocus onClick={() => setLeaveOpen(false)}>Cancel</button>
                        <button type="button" className="btn-outline" onClick={() => { setLeaveOpen(false); void handleLeave(); }}>Just leave</button>
                        <button type="button" className="meeting-danger" onClick={() => { void endForEveryone(); }}>End for everyone</button>
                    </div>
                </div>
            </div>}

        </div>
    );
}

function PrivateAudioPlayback({ track, outputDeviceId, onOutputError }: { track: MediaStreamTrack; outputDeviceId: string; onOutputError: () => void }) {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.srcObject = new MediaStream([track]);
    }, [track]);
    useEffect(() => {
        const audio = ref.current as (HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
        if (!audio?.setSinkId) return;
        void audio.setSinkId(outputDeviceId || 'default').catch(onOutputError);
    }, [outputDeviceId, onOutputError, track]);
    return <audio ref={ref} className="qs-remote-audio qs-private-audio" autoPlay aria-label="Private conversation audio" />;
}
