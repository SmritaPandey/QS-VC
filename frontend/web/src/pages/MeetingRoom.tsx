import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { signaling } from '../lib/signaling';
import { media, ConsumerInfo } from '../lib/media';
import { CameraCapture, watchCameraVisibility, watchCameraTrack, cameraAccessMessage } from '../lib/camera-capture';
import { watchMutedSpeech } from '../lib/muted-speech';
import { recordingManager, recordingRequest } from '../lib/recording';
import { getToken } from '../lib/session';
import '../styles/recordings.css';
import { playSound } from '../lib/sounds';
import { createMeetingComposite, type MeetingComposite } from '../lib/meeting-recorder';
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
import { WaitingAdmission, type WaitingMode } from '../components/WaitingRoom';
import { openMicrophone, startCameraWithFallback, microphoneMessage, deviceLabel } from '../lib/device-access';
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
    const state = { ...((location.state as any) || {}), ...(reconnecting ? carried : {}) };

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
    const [chatOpen, setChatOpen] = useState(false);
    const [participantsOpen, setParticipantsOpen] = useState(false);
    const [activitiesOpen, setActivitiesOpen] = useState(false);
    const [hostToolsOpen, setHostToolsOpen] = useState(false);
    const [waitingAdmission, setWaitingAdmission] = useState<WaitingMode | null>(null);
    const [roomSettings, setRoomSettings] = useState<RoomHostSettings>({ locked: false, waitingRoomEnabled: false, muteOnEntry: false, allowScreenShare: true, allowChat: true, allowMicrophone: true, allowCamera: true, allowReactions: true });
    const [joinFailure, setJoinFailure] = useState<JoinFailure | null>(null);
    const [restoring, setRestoring] = useState(reconnecting);
    const [knocks, setKnocks] = useState<Array<{ peerId: string; displayName: string }>>([]);
    const [leaveOpen, setLeaveOpen] = useState(false);
    const myRoleRef = useRef('member');
    myRoleRef.current = myRole;
    const isManagerNow = () => myRoleRef.current === 'host' || myRoleRef.current === 'co-host';
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
    const handRaisedRef = useRef(false);
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
        if (announce && joinedRef.current) signaling.request('muteStateChanged', { kind, muted }).catch((error: Error) => {
            // The host turned this permission off: go back to muted and say why.
            if (!muted && /host has turned off/i.test(error?.message || '')) {
                stream?.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = false; });
                media.setPaused(kind, kind === 'video' ? !sharingRef.current : true);
                if (kind === 'audio') { audioMutedRef.current = true; setAudioMuted(true); }
                else { videoOffRef.current = true; setVideoOff(true); cameraCapture.current.stop(); }
                setNotice(error.message);
            }
        });
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
        async function init() {
            try {
                const stream = new MediaStream();
                localStreamRef.current = stream;
                await signaling.connect();
                if (!alive()) return;
                const admission = new Promise<{ result?: any; error?: string; cancelled?: boolean }>(resolve => { settleAdmission = resolve; });
                const stopAdmitted = signaling.on('admitted', result => settleAdmission?.({ result }));
                const stopRejected = signaling.on('rejected', ({ reason }) => settleAdmission?.({ error: reason || 'The host declined your entry.' }));
                const stopWaitingStatus = signaling.on('waitingStatus', ({ status }) => { if (alive()) setWaitingAdmission(status === 'waitingForHost' ? 'host' : 'knock'); });
                unsubscribe.push(stopAdmitted, stopRejected, stopWaitingStatus);
                let joinResult = await signaling.request('joinRoom', {
                    meetingCode, displayName,
                });
                if (joinResult.status === 'waiting' || joinResult.status === 'waitingForHost') {
                    if (alive()) { setRestoring(false); setWaitingAdmission(joinResult.status === 'waitingForHost' ? 'host' : 'knock'); }
                    const outcome = await admission;
                    if (!alive() || outcome.cancelled) return;
                    setWaitingAdmission(null);
                    if (outcome.error) throw new Error(outcome.error);
                    joinResult = outcome.result;
                    playSound('notice');
                }
                stopAdmitted(); stopRejected(); stopWaitingStatus(); settleAdmission = undefined;
                if (!alive()) return;
                myPeerIdRef.current = joinResult.peerId;
                canPublishRef.current = joinResult.canPublish !== false;
                setMyRole(joinResult.role || 'member');
                setRoomRecording(joinResult.recording || null);
                setRoomSettings(current => ({ ...current, ...joinResult.settings }));
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
                            if (role !== 'host' && role !== 'co-host') { setHostToolsOpen(false); setKnocks([]); }
                            if (role !== before) showNotice(role === 'host' ? 'You are now the host.' : role === 'co-host' ? 'You are now a co-host. You can admit people and manage the meeting.' : 'You are no longer a co-host.');
                        } else patchPeer(peerId, { role });
                    }),
                    signaling.on('hostLeft', () => showNotice('The host left. The meeting continues; host controls return when the host or a co-host is back.')),
                    signaling.on('waitingRoomPeer', ({ peerId, displayName: name }: any) => {
                        if (!isManagerNow()) return;
                        playSound('notice');
                        setKnocks(current => current.some(k => k.peerId === peerId) ? current : [...current, { peerId, displayName: name || 'Guest' }]);
                    }),
                    signaling.on('newPeer', ({ peerId, displayName: name, role }: any) => patchPeer(peerId, { displayName: name, role })),
                    signaling.on('peerLeft', ({ peerId }: any) => { setKnocks(current => current.filter(k => k.peerId !== peerId)); setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; }); }),
                    signaling.on('newPeer', ({ peerId }: any) => setKnocks(current => current.filter(k => k.peerId !== peerId))),
                    signaling.on('peerKicked', ({ peerId }: any) => setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; })),
                    signaling.on('newProducer', async ({ peerId, producerId }: any) => {
                        try { await media.consume(peerId, producerId); } catch (err) { console.error('Failed to consume:', err); }
                    }),
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
                if (media.canSend) { if (media.hasProducer('audio')) await media.replaceTrack('audio', next); else await media.produce(next, { source: 'mic' }); }
                media.setPaused('audio', !wasOn);
                setLocalStream(new MediaStream(current.getTracks()));
                showNotice(`Your microphone was disconnected. Switched to ${deviceLabel(next)}.`);
            } catch {
                if (sessionActive.current) { applyMute('audio', true); showNotice('Your microphone was disconnected. Connect one and press the mic button.'); }
            }
        }, { once: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applyMute, showNotice]);

    const handleToggleAudio = useCallback(async () => {
        if (!canPublishRef.current) { showNotice('Only the webinar organiser can share media.'); return; }
        if (!sessionActive.current) return;
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
            if (media.canSend) {
                if (media.hasProducer('audio')) await media.replaceTrack('audio', track);
                else await media.produce(track, { source: 'mic' });
            }
            if (!sessionActive.current || revision !== sessionRevision.current) { track.stop(); return; }
            setLocalStream(new MediaStream(current.getTracks()));
            applyMute('audio', false);
        } catch (error) {
            acquired?.getTracks().forEach(t => t.stop());
            if (!sessionActive.current || revision !== sessionRevision.current) return;
            applyMute('audio', true);
            showNotice(microphoneMessage(error));
        } finally { busyRef.current.mic = false; }
    }, [applyMute, state.micId, showNotice, watchMicrophone]);

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
                ...(localStreamRef.current?.getAudioTracks() || []),
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
    }, [finishRecording, meetingCode, myRole, connected, showNotice]);

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

    const answerKnock = useCallback((peerId: string, admit: boolean) => {
        setKnocks(current => current.filter(k => k.peerId !== peerId));
        signaling.request(admit ? 'admitPeer' : 'rejectPeer', { targetPeerId: peerId }).catch((error: Error) => showNotice(error?.message || 'That request could not be answered.'));
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

    const sidePanelOpen = chatOpen || participantsOpen || activitiesOpen || hostToolsOpen;
    const manager = myRole === 'host' || myRole === 'co-host';
    const closeActivityPanel = () => { setActivitiesOpen(false); setHostToolsOpen(false); document.querySelector<HTMLButtonElement>('[aria-label="More controls"]')?.focus(); };
    if (waitingAdmission) return <WaitingAdmission mode={waitingAdmission} meetingCode={meetingCode || ''} onLeave={handleLeave} />;
    if (joinFailure) return <main className="waiting-admission meeting-join-failure"><div>
        <span className="mi" aria-hidden="true">block</span>
        <h1>{joinFailure.title}</h1>
        <p role="alert">{joinFailure.detail}</p>
        <div className="waiting-admission-actions">
            <button type="button" onClick={() => navigate(`/meeting/${meetingCode}/preview`, { replace: true })}>Try again</button>
            <button type="button" className="btn-text" onClick={() => navigate('/app')}>Back to meetings</button>
        </div>
    </div></main>;

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
                    {roomRecording && <span className="recording-indicator" role="status"><span className="mi mi-sm" aria-hidden="true">fiber_manual_record</span> {roomRecording.displayName} is recording</span>}
                    {screenSharing && <span className="sharing-indicator"><span className="mi mi-sm">screen_share</span> Sharing</span>}
                </div>
                <div className="top-bar-right">
                    <span className="participant-count"><span className="mi mi-sm">group</span> {peers.size + 1}</span>
                </div>
            </div>

            <div className="meeting-notices">
            {restoring && !connectionLost && <div className="meeting-notice" role="status"><span className="mi mi-sm meeting-spin" aria-hidden="true">progress_activity</span> Reconnecting… Hold on, we’re getting you back into the meeting.</div>}
            {connectionLost && <div className="meeting-notice" role="alert">Connection lost. Check your internet connection, then rejoin.
                <button className="btn-outline" onClick={() => navigate(`/meeting/${meetingCode}/preview`, { replace: true })}>Rejoin meeting</button>
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
                    <VideoGrid remoteVolume={translatedSpeaking ? 0.2 : 1} localStream={screenSharing ? screenStream : localStream} peers={peers} displayName={displayName} videoOff={screenSharing ? false : videoOff} audioMuted={audioMuted} handRaised={handRaised} sharing={screenSharing} viewMode={viewMode} />
                    <ReactionsOverlay reactions={reactions} pickerOpen={reactionsOpen} onSendReaction={handleSendReaction} onClosePicker={closeReactions} onExpire={expireReaction} />
                    <MeetingCaptions translatedSpeaking={translatedSpeaking} stopRecognition={stopSpeechRecognition} open={languageOpen} onClose={closeLanguage} connected={connected} audioMuted={audioMuted} speakingLanguage={speechLanguage.code} onSpeakingLanguageChange={chooseLanguage} onUseDetectedLanguage={applyDetectedLanguage} displayName={displayName} myPeerId={getMyPeerId} onSpeakingChange={handleTranslatedSpeaking} />
                </div>

                {chatOpen && <MeetingChat messages={chatMessages} onSend={handleSendChat} onClose={closeChat} />}

                {participantsOpen && (
                    <ParticipantsPanel peers={peers} displayName={displayName} myRole={myRole} audioMuted={audioMuted} videoOff={videoOff} handRaised={handRaised} onClose={() => setParticipantsOpen(false)} />
                )}
                <MeetingCollaboration key={meetingCode} open={activitiesOpen} connected={connected} role={myRole} myPeerId={myPeerIdRef.current} onClose={closeActivityPanel} />
                {hostToolsOpen && manager && <HostMeetingTools role={myRole} myPeerId={myPeerIdRef.current} participants={[{ peerId: myPeerIdRef.current, displayName, role: myRole, audioMuted, videoOff, handRaised }, ...Array.from(peers.values()).map(peer => ({ ...peer, role: peer.role || 'member', videoOff: peer.videoOff ?? !peer.videoTrack }))]} settings={roomSettings} onClose={closeActivityPanel} onEndMeeting={() => setLeaveOpen(true)} />}
            </div>

            {recordingStatus && <div className="meeting-recording-status" role="status">{recordingStatus}
                {pendingRecording.current ? <details><summary>Recording actions</summary><button type="button" onClick={() => void savePendingRecording()}>Retry saving</button><button type="button" onClick={() => { const pending = pendingRecording.current; if (pending) recordingManager.downloadLocally(pending.blob, `QS-VC-${meetingCode}.${pending.format}`); }}>Download unsaved copy</button><button type="button" onClick={() => { if (window.confirm('Discard the unsaved recording? This copy cannot be recovered.')) { pendingRecording.current = null; recordingManager.pending = null; setRecordingStatus('Unsaved copy discarded. You can leave the meeting.'); } }}>Discard unsaved copy</button></details> : <a href={`/recordings/${encodeURIComponent(meetingCode || '')}`}>Manage recordings</a>}
            </div>}
            <ControlBar
                assistant={<AIChatBot onOpen={() => { setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }} closeSignal={chatOpen || participantsOpen || activitiesOpen || hostToolsOpen} />}
                activitiesOpen={activitiesOpen} hostToolsOpen={hostToolsOpen}
                onToggleActivities={() => { setActivitiesOpen(value => !value); setHostToolsOpen(false); setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); }}
                onToggleHostTools={manager ? () => { setHostToolsOpen(value => !value); setActivitiesOpen(false); setChatOpen(false); setParticipantsOpen(false); setLanguageOpen(false); setReactionsOpen(false); } : undefined}
                viewMode={viewMode} onChangeView={setViewMode} activitySignal={mutedSpeechPulse} keepSideVisible={mutedSpeechNotice}
                audioMuted={audioMuted} videoOff={videoOff} screenSharing={screenSharing}
                isRecording={isRecording} canRecord={myRole === 'host' && !!getToken()} chatOpen={chatOpen} participantsOpen={participantsOpen}
                handRaised={handRaised} reactionsOpen={reactionsOpen}
                onToggleReactions={() => { setReactionsOpen((open) => !open); setLanguageOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                languageOpen={languageOpen} languageLabel={findLanguage(speechLanguage.code)?.name} languageCode={speechLanguage.code.split('-')[0].toUpperCase()}
                onToggleLanguage={() => { setLanguageOpen((open) => !open); setReactionsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                onToggleAudio={handleToggleAudio} onToggleVideo={handleToggleVideo}
                onToggleScreen={handleScreenShare} onToggleRecording={handleToggleRecording}
                onToggleChat={() => { if (!roomSettings.allowChat && !manager) { showNotice('Chat is disabled by the host.'); return; } setChatOpen(!chatOpen); setParticipantsOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                onToggleParticipants={() => { setParticipantsOpen(!participantsOpen); setChatOpen(false); setActivitiesOpen(false); setHostToolsOpen(false); }}
                onRaiseHand={handleRaiseHand} onLeave={requestLeave}
            />
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
