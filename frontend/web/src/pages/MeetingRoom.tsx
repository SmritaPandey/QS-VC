import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { signaling } from '../lib/signaling';
import { media, ConsumerInfo } from '../lib/media';
import { CameraCapture, watchCameraVisibility, watchCameraTrack, cameraAccessMessage } from '../lib/camera-capture';
import { watchMutedSpeech } from '../lib/muted-speech';
import { recordingManager } from '../lib/recording';
import { playSound } from '../lib/sounds';
import { type MeetingComposite } from '../lib/meeting-recorder';
import VideoGrid from '../components/VideoGrid';
import BrandLogo from '../components/BrandLogo';
import ControlBar from '../components/ControlBar';
import MeetingChat from '../components/MeetingChat';
import ParticipantsPanel from '../components/ParticipantsPanel';
import ReactionsOverlay, { MeetingReaction, REACTION_DURATION } from '../components/ReactionsOverlay';
import AIChatBot from '../components/AIChatBot';
import MeetingCaptions from '../components/MeetingCaptions';
import MeetingCollaboration from '../components/MeetingCollaboration';
import HostMeetingTools, { type RoomHostSettings } from '../components/HostMeetingTools';
import { WaitingAdmission } from '../components/WaitingRoom';
import { initialMeetingLanguage, detectLanguage, setMeetingLanguage, clearSavedLanguage, findLanguage, LANGUAGE_EVENT, type MeetingLanguage } from '../lib/meeting-language';

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    role?: string;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
}

interface ChatMessage {
    id: string;
    peerId: string;
    displayName: string;
    content: string;
    timestamp: string;
}

type MediaKind = 'audio' | 'video';

/** Open audio independently so a camera-off choice never acquires the camera. */
async function openLocalMedia(micId: string | undefined, cameraId: string | undefined, camera: CameraCapture, stream: MediaStream, isActive: () => boolean, wantsCamera: () => boolean): Promise<MediaStream> {
    try {
        const audio = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { ideal: micId } } : true, video: false });
        if (!isActive()) { audio.getTracks().forEach(track => track.stop()); return stream; }
        audio.getTracks().forEach(track => stream.addTrack(track));
    } catch { /* Joining without a microphone is allowed. */ }
    if (wantsCamera()) {
        try {
            const track = await camera.start({ width: 1280, height: 720, ...(cameraId ? { deviceId: { ideal: cameraId } } : {}) });
            if (track) stream.addTrack(track);
        } catch { /* The camera can be retried explicitly after joining. */ }
    }
    return stream;
}

export default function MeetingRoom() {
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const state = (location.state as any) || {};

    const myPeerIdRef = useRef('');
    const [myRole, setMyRole] = useState<string>('member');
    const [displayName] = useState(state.displayName || 'Guest');
    const [peers, setPeers] = useState<Map<string, PeerData>>(new Map());
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    // Mic / camera: the pre-join choice is the starting state; every later change goes through applyMute().
    const [audioMuted, setAudioMuted] = useState<boolean>(!!state.audioMuted);
    const [videoOff, setVideoOff] = useState(true);
    const [cameraNotice, setCameraNotice] = useState('');
    const [screenSharing, setScreenSharing] = useState(false);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatOpen, setChatOpen] = useState(false);
    const [participantsOpen, setParticipantsOpen] = useState(false);
    const [activitiesOpen, setActivitiesOpen] = useState(false);
    const [hostToolsOpen, setHostToolsOpen] = useState(false);
    const [waitingAdmission, setWaitingAdmission] = useState(false);
    const [roomSettings, setRoomSettings] = useState<RoomHostSettings>({ locked: false, waitingRoomEnabled: false, muteOnEntry: false, allowScreenShare: true, allowChat: true });
    const roomSettingsRef = useRef(roomSettings);
    roomSettingsRef.current = roomSettings;
    const [viewMode, setViewMode] = useState<'gallery' | 'focus' | 'sidebar' | 'filmstrip'>('gallery');
    const [connected, setConnected] = useState(false);
    const [pageVisible, setPageVisible] = useState(!document.hidden);
    const [mutedSpeechNotice, setMutedSpeechNotice] = useState(false);
    const [mutedSpeechPulse, setMutedSpeechPulse] = useState(0);
    const mutedSpeechTimer = useRef<number>();
    const [duration, setDuration] = useState(0);
    const [handRaised, setHandRaised] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [connectionLost, setConnectionLost] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [reactions, setReactions] = useState<MeetingReaction[]>([]);
    const [reactionsOpen, setReactionsOpen] = useState(false);
    // Speaking language for voice-to-text: saved choice, else the user's location.
    const [speechLanguage, setSpeechLanguage] = useState<MeetingLanguage>(() => initialMeetingLanguage());
    const [translatedSpeaking, setTranslatedSpeaking] = useState(false);
    const getMyPeerId = useCallback(() => myPeerIdRef.current, []);
    const [languageOpen, setLanguageOpen] = useState(false);

    // Refs mirror live state so async handlers and signaling callbacks never act on stale values.
    const audioMutedRef = useRef<boolean>(!!state.audioMuted);
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
    const videoAreaRef = useRef<HTMLDivElement>(null);
    const compositeRef = useRef<MeetingComposite | null>(null);
    useEffect(() => { peersRef.current = peers; }, [peers]);

    const showNotice = useCallback((text: string) => {
        setNotice(text);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
    }, []);

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
        media.setPaused(kind, kind === 'video' ? muted && !sharingRef.current : muted);
        if (kind === 'audio') { audioMutedRef.current = muted; setAudioMuted(muted); }
        else { videoOffRef.current = muted; setVideoOff(muted); }
        if (announce && joinedRef.current) signaling.request('muteStateChanged', { kind, muted }).catch(() => { });
    }, []);

    const stopLocalMedia = useCallback(() => {
        stopSpeechRecognition.current();
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
        let settleAdmission: ((outcome: { result?: any; error?: string; cancelled?: boolean }) => void) | undefined;
        const unsubscribe: Array<() => void> = [signaling.on('disconnected', () => {
            settleAdmission?.({ cancelled: true });
            if (!alive()) return;
            setWaitingAdmission(false);
            joinedRef.current = false;
            stopLocalMedia(); media.close(); signaling.disconnect();
            setConnected(false); setLocalStream(null); setVideoOff(true); setAudioMuted(true);
            setConnectionLost(true);
        })];
        async function init() {
            try {
                const stream = new MediaStream();
                localStreamRef.current = stream;
                await signaling.connect();
                if (!alive()) return;
                const admission = new Promise<{ result?: any; error?: string; cancelled?: boolean }>(resolve => { settleAdmission = resolve; });
                const stopAdmitted = signaling.on('admitted', result => settleAdmission?.({ result }));
                const stopRejected = signaling.on('rejected', ({ reason }) => settleAdmission?.({ error: reason || 'The host declined your entry.' }));
                unsubscribe.push(stopAdmitted, stopRejected);
                let joinResult = await signaling.request('joinRoom', {
                    meetingCode, displayName,
                });
                if (joinResult.status === 'waiting') {
                    if (alive()) setWaitingAdmission(true);
                    const outcome = await admission;
                    if (!alive() || outcome.cancelled) return;
                    setWaitingAdmission(false);
                    if (outcome.error) throw new Error(outcome.error);
                    joinResult = outcome.result;
                }
                stopAdmitted(); stopRejected(); settleAdmission = undefined;
                if (!alive()) return;
                myPeerIdRef.current = joinResult.peerId;
                setMyRole(joinResult.role || 'member');
                setRoomSettings(current => ({ ...current, ...joinResult.settings }));
                joinedRef.current = true;
                if (joinResult.settings?.muteOnEntry && joinResult.role !== 'host' && !audioMutedRef.current) {
                    applyMute('audio', true, false);
                    showNotice('The host mutes participants on entry. Unmute when you are ready.');
                }

                // Listeners first, so nothing sent while we set up media is missed.
                unsubscribe.push(
                    signaling.on('settingsUpdated', ({ settings }) => {
                        setRoomSettings(current => ({ ...current, ...settings }));
                        roomSettingsRef.current = { ...roomSettingsRef.current, ...settings };
                        if (settings.allowScreenShare === false && sharingRef.current) { void stopScreenShare(); showNotice('Screen sharing was disabled by the host.'); }
                    }),
                    signaling.on('roleChanged', ({ peerId, role }) => { if (peerId === myPeerIdRef.current) { setMyRole(role); if (role !== 'host' && role !== 'co-host') setHostToolsOpen(false); } else patchPeer(peerId, { role }); }),
                    signaling.on('newPeer', ({ peerId, displayName: name, role }: any) => patchPeer(peerId, { displayName: name, role })),
                    signaling.on('peerLeft', ({ peerId }: any) => setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; })),
                    signaling.on('peerKicked', ({ peerId }: any) => setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; })),
                    signaling.on('newProducer', async ({ peerId, producerId }: any) => {
                        try { await media.consume(peerId, producerId); } catch (err) { console.error('Failed to consume:', err); }
                    }),
                    signaling.on('peerMuteChanged', ({ peerId, kind, muted }: any) => {
                        if (kind === 'audio') patchPeer(peerId, { audioMuted: !!muted });
                        if (kind === 'video') patchPeer(peerId, { videoOff: !!muted });
                    }),
                    signaling.on('handRaised', ({ peerId, raised }: any) => {
                        if (peerId === myPeerIdRef.current) return;
                        patchPeer(peerId, { handRaised: !!raised });
                    }),
                    signaling.on('forceMute', ({ kind, by }: any) => {
                        const k: MediaKind = kind === 'video' ? 'video' : 'audio';
                        applyMute(k, true);
                        playSound('notice');
                        showNotice(`${by || 'The host'} turned off your ${k === 'audio' ? 'microphone' : 'camera'}.`);
                    }),
                    signaling.on('kicked', ({ reason }: any) => { stopLocalMedia(); media.close(); signaling.disconnect(); navigate('/', { state: { notice: reason || 'You were removed from the meeting.' } }); }),
                    signaling.on('meetingEnded', ({ reason }: any) => { stopLocalMedia(); media.close(); signaling.disconnect(); navigate('/', { state: { notice: reason || 'The meeting has ended.' } }); }),
                    signaling.on('chatMessage', (msg: ChatMessage) => { setChatMessages((prev) => [...prev, msg]); }),
                    signaling.on('reaction', ({ peerId, displayName: name, emoji }: any) => {
                        // The server echoes reactions to the sender too; ours is already on screen.
                        if (!emoji || peerId === myPeerIdRef.current) return;
                        pushReaction(emoji, name || 'Guest', false);
                    }),
                );

                // People already in the room, with their mic / camera / hand state.
                for (const p of joinResult.existingPeers || []) {
                    patchPeer(p.peerId, { displayName: p.displayName, role: p.role, audioMuted: !!p.audioMuted, videoOff: !!p.videoOff, handRaised: !!p.handRaised });
                }

                // Capture starts only after admission, never while waiting for a host.
                await openLocalMedia(state.micId, state.cameraId, cameraCapture.current, stream, alive, () => alive() && !videoOffRef.current);
                if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
                const hasMic = stream.getAudioTracks().some(track => track.readyState === 'live');
                const hasCam = stream.getVideoTracks().some(track => track.readyState === 'live');
                setLocalStream(stream);
                if (!hasMic) { audioMutedRef.current = true; setAudioMuted(true); showNotice('No microphone available. You can still listen and chat.'); }
                if (!hasCam) videoOffRef.current = true;
                setVideoOff(videoOffRef.current);
                stream.getAudioTracks().forEach(track => { track.enabled = !audioMutedRef.current; track.addEventListener('ended', () => { if (alive()) applyMute('audio', true); }); });
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
                            (info: ConsumerInfo) => patchPeer(info.peerId, info.kind === 'audio' ? { audioTrack: info.track } : { videoTrack: info.track }),
                            (_consumerId: string) => { }
                        );
                        const audioTrack = stream?.getAudioTracks()[0];
                        const videoTrack = stream?.getVideoTracks()[0];
                        if (audioTrack?.readyState === 'live') await media.produce(audioTrack, { source: 'mic' });
                        if (!alive()) return;
                        if (videoTrack?.readyState === 'live' && !videoOffRef.current) await media.produce(videoTrack, { source: 'camera' });
                        if (!alive()) return;
                        // Producers start live; match them to the current (possibly muted) state.
                        media.setPaused('audio', audioMutedRef.current);
                        media.setPaused('video', videoOffRef.current);
                        for (const existingPeer of joinResult.existingPeers || []) {
                            for (const producer of existingPeer.producers) {
                                if (!alive()) return;
                                try { await media.consume(existingPeer.peerId, producer.id); } catch (err) { console.error('Failed to consume:', err); }
                            }
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
            } catch (err) {
                console.error('Failed to join meeting:', err);
                if (alive()) {
                    setWaitingAdmission(false);
                    showNotice(err instanceof Error ? err.message : 'Could not join the meeting.');
                    stopLocalMedia(); media.close(); signaling.disconnect();
                    setLocalStream(null); setVideoOff(true); setAudioMuted(true); setConnectionLost(true);
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
            if (recordingRef.current) { recordingRef.current = false; recordingManager.stopRecording().catch(() => { }); }
            compositeRef.current?.stop();
            compositeRef.current = null;
            stopLocalMedia();
            media.close();
            signaling.request('leaveRoom', {}).catch(() => { });
            signaling.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meetingCode]);

    const handleToggleAudio = useCallback(async () => {
        if (!sessionActive.current) return;
        const current = localStreamRef.current ?? new MediaStream();
        const live = current.getAudioTracks().some(track => track.readyState === 'live');
        if (live) { applyMute('audio', !audioMutedRef.current); return; }
        if (initializingRef.current) { showNotice('Preparing your microphone. Try again once the meeting connects.'); return; }
        if (busyRef.current.mic) return;
        busyRef.current.mic = true;
        const revision = sessionRevision.current;
        let acquired: MediaStream | null = null;
        try {
            acquired = await navigator.mediaDevices.getUserMedia({ audio: state.micId ? { deviceId: { ideal: state.micId } } : true, video: false });
            if (!sessionActive.current || revision !== sessionRevision.current) { acquired.getTracks().forEach(t => t.stop()); return; }
            const track = acquired.getAudioTracks()[0];
            current.getAudioTracks().forEach(old => { old.stop(); current.removeTrack(old); });
            current.addTrack(track);
            localStreamRef.current = current;
            track.addEventListener('ended', () => {
                if (sessionActive.current && localStreamRef.current?.getAudioTracks().includes(track)) applyMute('audio', true);
            }, { once: true });
            if (media.canSend) {
                if (media.hasProducer('audio')) await media.replaceTrack('audio', track);
                else await media.produce(track, { source: 'mic' });
            }
            if (!sessionActive.current || revision !== sessionRevision.current) { track.stop(); return; }
            setLocalStream(new MediaStream(current.getTracks()));
            applyMute('audio', false);
        } catch {
            acquired?.getTracks().forEach(t => t.stop());
            if (!sessionActive.current || revision !== sessionRevision.current) return;
            applyMute('audio', true);
            showNotice('Microphone unavailable. Check browser permission and try again.');
        } finally { busyRef.current.mic = false; }
    }, [applyMute, state.micId, showNotice]);

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
        if (!sessionActive.current || document.hidden) return;
        if (!videoOffRef.current) { applyMute('video', true); setCameraNotice(''); return; }
        if (initializingRef.current) { showNotice('Preparing your camera. Try again once the meeting connects.'); return; }
        if (busyRef.current.camera) return;
        busyRef.current.camera = true;
        const revision = sessionRevision.current;
        try {
            const track = await cameraCapture.current.start({ width: 1280, height: 720, ...(state.cameraId ? { deviceId: { ideal: state.cameraId } } : {}) });
            if (!track || !sessionActive.current || revision !== sessionRevision.current) { track?.stop(); return; }
            const current = localStreamRef.current ?? new MediaStream();
            current.getVideoTracks().forEach(old => { old.stop(); current.removeTrack(old); });
            current.addTrack(track);
            localStreamRef.current = current;
            watchCamera(track);
            let relayFailed = !sharingRef.current && !media.canSend;
            if (!sharingRef.current && media.canSend) {
                try {
                    if (media.hasProducer('video')) await media.replaceTrack('video', track);
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
            if (recordingRef.current) { recordingRef.current = false; recordingManager.stopRecording().catch(() => { }); }
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
            if (event.persisted) navigate(`/meeting/${meetingCode}/preview`, { replace: true });
        };
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            stopWatchingVisibility();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, [applyMute, meetingCode, navigate, stopLocalMedia]);

    const stopScreenShare = useCallback(async () => {
        if (!sharingRef.current) return;
        const revision = sessionRevision.current;
        sharingRef.current = false;
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        setScreenStream(null);
        setScreenSharing(false);
        const camTrack = localStreamRef.current?.getVideoTracks()[0];
        if (camTrack?.readyState === 'live') await media.replaceTrack('video', camTrack).catch(() => { });
        if (!sessionActive.current || revision !== sessionRevision.current) return;
        // Back to the camera: respect camera-off again.
        media.setPaused('video', videoOffRef.current);
        if (joinedRef.current) signaling.request('muteStateChanged', { kind: 'screen', muted: false }).catch(() => { });
    }, []);

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
                if (media.hasProducer('video')) await media.replaceTrack('video', screenTrack);
                else await media.produce(screenTrack, { type: 'screen' });
            }
            if (!sessionActive.current || revision !== sessionRevision.current || !sharingRef.current || !roomSettingsRef.current.allowScreenShare || screenTrack.readyState !== 'live') { display.getTracks().forEach(t => t.stop()); return; }
            media.setPaused('video', false); // the screen is sent even if the camera is off
            if (joinedRef.current) signaling.request('muteStateChanged', { kind: 'screen', muted: true }).catch(() => { });
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
        if (!sharingRef.current && !roomSettings.allowScreenShare) { showNotice('Screen sharing is disabled by the host.'); return; }
        if (sharingRef.current) stopScreenShare(); else startScreenShare();
    }, [startScreenShare, stopScreenShare, roomSettings.allowScreenShare, showNotice]);

    const finishRecording = useCallback(async () => {
        if (!recordingRef.current) return; // guards double stop
        recordingRef.current = false;
        setIsRecording(false);
        try {
            const result = await recordingManager.stopRecording();
            recordingManager.downloadLocally(result.blob, `QS-VC-${meetingCode}-${Date.now()}.${result.format}`);
        } catch (err) { console.error('Failed to stop recording:', err); }
        compositeRef.current?.stop();
        compositeRef.current = null;
    }, [meetingCode]);

    /**
     * Record the meeting itself: the tiles on screen + everyone's audio.
     * (Screen sharing is the one that asks which screen or window to use; recording no longer does.)
     */
    const handleToggleRecording = useCallback(async () => {
        showNotice('Recording is disabled for this demo.');
    }, [finishRecording, meetingCode, showNotice]);

    const handRaisedRef = useRef(false);
    const handleRaiseHand = useCallback(() => {
        const next = !handRaisedRef.current;
        handRaisedRef.current = next;
        setHandRaised(next);
        // Server method is 'raiseHand' (was sent as 'handRaise' and never reached others).
        signaling.request('raiseHand', { raised: next }).catch(() => { });
    }, []);
    const handleSendReaction = useCallback((emoji: string) => {
        pushReaction(emoji, displayName, true);
        signaling.request('reaction', { emoji }).catch(() => { });
    }, [displayName]);
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
    const handleLeave = useCallback(() => {
        if (recordingRef.current) finishRecording();
        stopLocalMedia();
        joinedRef.current = false;
        media.close();
        signaling.request('leaveRoom', {}).catch(() => { });
        signaling.disconnect();
        navigate('/');
    }, [finishRecording, navigate, stopLocalMedia]);
    const handleSendChat = useCallback((content: string) => { if (!roomSettings.allowChat && myRole !== 'host' && myRole !== 'co-host') { showNotice('Chat is disabled by the host.'); return; } signaling.request('chatMessage', { content, type: 'text' }).catch(() => { showNotice('Your message could not be sent.'); }); }, [roomSettings.allowChat, myRole, showNotice]);
    const closeChat = useCallback(() => {
        setChatOpen(false);
        document.querySelector<HTMLButtonElement>('[aria-controls="meeting-chat-panel"]')?.focus();
    }, []);

    const handleCopyLink = useCallback(() => {
        const url = `${window.location.origin}/meeting/${meetingCode}/preview`;
        navigator.clipboard.writeText(url).then(() => {
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        }).catch(() => {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        });
    }, [meetingCode]);

    const formatDuration = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
            : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    const sidePanelOpen = chatOpen || participantsOpen || activitiesOpen || hostToolsOpen;
    const manager = myRole === 'host' || myRole === 'co-host';
    const closeActivityPanel = () => { setActivitiesOpen(false); setHostToolsOpen(false); document.querySelector<HTMLButtonElement>('[aria-label="More controls"]')?.focus(); };
    if (waitingAdmission) return <WaitingAdmission meetingCode={meetingCode || ''} onLeave={handleLeave} />;

    return (
        <div className="meeting-room">
            <div className="meeting-top-bar">
                <div className="top-bar-left">
                    <BrandLogo meeting iconOnly />
                    <button className="share-link-btn" onClick={handleCopyLink} title="Copy invite link">
                        <span className="meeting-code-display">{meetingCode}</span>
                        <span className="mi mi-sm share-copy-icon">{linkCopied ? 'check' : 'content_copy'}</span>
                        {linkCopied && <span className="copied-tooltip">Link copied!</span>}
                    </button>
                </div>
                <div className="top-bar-center">
                    <span className="meeting-timer">{formatDuration(duration)}</span>
                    {isRecording && <span className="recording-indicator"><span className="mi mi-sm">fiber_manual_record</span> REC</span>}
                    {screenSharing && <span className="sharing-indicator"><span className="mi mi-sm">screen_share</span> Sharing</span>}
                </div>
                <div className="top-bar-right">
                    <span className="participant-count"><span className="mi mi-sm">group</span> {peers.size + 1}</span>
                </div>
            </div>

            <div className="meeting-notices">
            {connectionLost && <div className="meeting-notice" role="alert">Connection lost. Your camera and microphone are off.
                <button className="btn-outline" onClick={() => navigate(`/meeting/${meetingCode}/preview`, { replace: true })}>Rejoin meeting</button>
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
                    <VideoGrid remoteVolume={translatedSpeaking ? 0.2 : 1} localStream={screenSharing ? screenStream : localStream} peers={peers} displayName={displayName} videoOff={screenSharing ? false : videoOff} audioMuted={audioMuted} handRaised={handRaised} sharing={screenSharing} viewMode={viewMode} />
                    <ReactionsOverlay reactions={reactions} pickerOpen={reactionsOpen} onSendReaction={handleSendReaction} onClosePicker={closeReactions} onExpire={expireReaction} />
                    <MeetingCaptions translatedSpeaking={translatedSpeaking} stopRecognition={stopSpeechRecognition} open={languageOpen} onClose={closeLanguage} connected={connected} audioMuted={audioMuted} speakingLanguage={speechLanguage.code} onSpeakingLanguageChange={chooseLanguage} onUseDetectedLanguage={applyDetectedLanguage} displayName={displayName} myPeerId={getMyPeerId} onSpeakingChange={handleTranslatedSpeaking} />
                </div>

                {chatOpen && <MeetingChat messages={chatMessages} onSend={handleSendChat} onClose={closeChat} />}

                {participantsOpen && (
                    <ParticipantsPanel peers={peers} displayName={displayName} myRole={myRole} audioMuted={audioMuted} videoOff={videoOff} handRaised={handRaised} onClose={() => setParticipantsOpen(false)} />
                )}
                <MeetingCollaboration key={meetingCode} open={activitiesOpen} connected={connected} role={myRole} myPeerId={myPeerIdRef.current} onClose={closeActivityPanel} />
                {hostToolsOpen && manager && <HostMeetingTools role={myRole} myPeerId={myPeerIdRef.current} participants={[{ peerId: myPeerIdRef.current, displayName, role: myRole, audioMuted }, ...Array.from(peers.values()).map(peer => ({ ...peer, role: peer.role || 'member' }))]} settings={roomSettings} onClose={closeActivityPanel} />}
            </div>

            <ControlBar
                assistant={<AIChatBot onOpen={() => { setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }} closeSignal={chatOpen || participantsOpen || activitiesOpen || hostToolsOpen} />}
                activitiesOpen={activitiesOpen} hostToolsOpen={hostToolsOpen}
                onToggleActivities={() => { setActivitiesOpen(value => !value); setHostToolsOpen(false); setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); }}
                onToggleHostTools={manager ? () => { setHostToolsOpen(value => !value); setActivitiesOpen(false); setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); } : undefined}
                viewMode={viewMode} onChangeView={setViewMode} activitySignal={mutedSpeechPulse} keepSideVisible={mutedSpeechNotice}
                audioMuted={audioMuted} videoOff={videoOff} screenSharing={screenSharing}
                isRecording={isRecording} chatOpen={chatOpen} participantsOpen={participantsOpen}
                handRaised={handRaised} reactionsOpen={reactionsOpen}
                onToggleReactions={() => { setReactionsOpen((open) => !open); setLanguageOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                languageOpen={languageOpen} languageLabel={findLanguage(speechLanguage.code)?.name} languageCode={speechLanguage.code.split('-')[0].toUpperCase()}
                onToggleLanguage={() => { setLanguageOpen((open) => !open); setReactionsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                onToggleAudio={handleToggleAudio} onToggleVideo={handleToggleVideo}
                onToggleScreen={handleScreenShare} onToggleRecording={handleToggleRecording}
                onToggleChat={() => { if (!roomSettings.allowChat && !manager) { showNotice('Chat is disabled by the host.'); return; } setChatOpen(!chatOpen); setParticipantsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                onToggleParticipants={() => { setParticipantsOpen(!participantsOpen); setChatOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                onRaiseHand={handleRaiseHand} onLeave={handleLeave}
            />

        </div>
    );
}
