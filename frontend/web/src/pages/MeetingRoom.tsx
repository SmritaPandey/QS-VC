import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { signaling } from '../lib/signaling';
import { media, ConsumerInfo } from '../lib/media';
import { recordingManager } from '../lib/recording';
import VideoGrid from '../components/VideoGrid';
import ControlBar from '../components/ControlBar';
import ParticipantsPanel from '../components/ParticipantsPanel';
import ReactionsOverlay from '../components/ReactionsOverlay';
import AIChatBot from '../components/AIChatBot';

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
}

interface ChatMessage {
    id: string;
    peerId: string;
    displayName: string;
    content: string;
    timestamp: string;
}

export default function MeetingRoom() {
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const state = (location.state as any) || {};

    const [, setMyPeerId] = useState('');
    const [displayName] = useState(state.displayName || 'Guest');
    const [peers, setPeers] = useState<Map<string, PeerData>>(new Map());
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [audioMuted, setAudioMuted] = useState(state.audioMuted || false);
    const [videoOff, setVideoOff] = useState(state.videoOff || false);
    const [screenSharing, setScreenSharing] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatOpen, setChatOpen] = useState(false);
    const [participantsOpen, setParticipantsOpen] = useState(false);
    const [connected, setConnected] = useState(false);
    const [duration, setDuration] = useState(0);
    const [handRaised, setHandRaised] = useState(false);
    const chatInputRef = useRef<HTMLInputElement>(null);

    const screenStreamRef = useRef<MediaStream | null>(null);
    const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);

    useEffect(() => {
        if (!connected) return;
        const timer = setInterval(() => setDuration((d) => d + 1), 1000);
        return () => clearInterval(timer);
    }, [connected]);

    useEffect(() => {
        let mounted = true;
        async function init() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: true, video: { width: 1280, height: 720 },
                });
                if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
                setLocalStream(stream);
                if (state.audioMuted) stream.getAudioTracks().forEach(t => t.enabled = false);
                if (state.videoOff) stream.getVideoTracks().forEach(t => t.enabled = false);
                await signaling.connect();
                const joinResult = await signaling.request('joinRoom', {
                    meetingCode, displayName, rtpCapabilities: null,
                });
                if (!mounted) return;
                setMyPeerId(joinResult.peerId);
                await media.loadDevice(joinResult.routerRtpCapabilities);
                await media.createSendTransport(joinResult.sendTransport);
                await media.createRecvTransport(joinResult.recvTransport);
                media.setConsumerCallbacks(
                    (info: ConsumerInfo) => {
                        setPeers((prev) => {
                            const next = new Map(prev);
                            const existing = next.get(info.peerId) || { peerId: info.peerId, displayName: info.peerId };
                            if (info.kind === 'audio') existing.audioTrack = info.track;
                            if (info.kind === 'video') existing.videoTrack = info.track;
                            next.set(info.peerId, existing);
                            return next;
                        });
                    },
                    (_consumerId: string) => { }
                );
                const audioTrack = stream.getAudioTracks()[0];
                const videoTrack = stream.getVideoTracks()[0];
                if (audioTrack) await media.produce(audioTrack, { source: 'mic' });
                if (videoTrack) await media.produce(videoTrack, { source: 'camera' });
                for (const existingPeer of joinResult.existingPeers) {
                    setPeers((prev) => {
                        const next = new Map(prev);
                        next.set(existingPeer.peerId, { peerId: existingPeer.peerId, displayName: existingPeer.displayName });
                        return next;
                    });
                    for (const producer of existingPeer.producers) {
                        try { await media.consume(existingPeer.peerId, producer.id); } catch (err) { console.error('Failed to consume:', err); }
                    }
                }
                setConnected(true);
                signaling.on('newPeer', ({ peerId, displayName: name }: any) => {
                    setPeers((prev) => { const next = new Map(prev); next.set(peerId, { peerId, displayName: name }); return next; });
                });
                signaling.on('peerLeft', ({ peerId }: any) => {
                    setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; });
                });
                signaling.on('newProducer', async ({ peerId, producerId }: any) => {
                    try { await media.consume(peerId, producerId); } catch (err) { console.error('Failed to consume:', err); }
                });
                signaling.on('chatMessage', (msg: ChatMessage) => { setChatMessages((prev) => [...prev, msg]); });
                signaling.on('reaction', () => { });
            } catch (err) {
                console.error('Failed to join meeting:', err);
                alert('Failed to join meeting. Please check your connection.');
            }
        }
        init();
        return () => { mounted = false; media.close(); signaling.request('leaveRoom', {}).catch(() => { }); signaling.disconnect(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meetingCode]);

    const handleToggleAudio = useCallback(async () => {
        if (localStream) {
            const muted = !audioMuted;
            localStream.getAudioTracks().forEach(t => t.enabled = !muted);
            await media.toggleMute('audio');
            signaling.request('muteStateChanged', { kind: 'audio', muted }).catch(() => { });
            setAudioMuted(muted);
        }
    }, [audioMuted, localStream]);

    const handleToggleVideo = useCallback(async () => {
        if (localStream) {
            const off = !videoOff;
            localStream.getVideoTracks().forEach(t => t.enabled = !off);
            await media.toggleMute('video');
            signaling.request('muteStateChanged', { kind: 'video', muted: off }).catch(() => { });
            setVideoOff(off);
        }
    }, [videoOff, localStream]);

    const handleScreenShare = useCallback(async () => {
        if (screenSharing) {
            screenStreamRef.current?.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
            if (originalVideoTrackRef.current) { await media.replaceVideoTrack(originalVideoTrackRef.current); originalVideoTrackRef.current = null; }
            signaling.request('muteStateChanged', { kind: 'screen', sharing: false }).catch(() => { });
            setScreenSharing(false);
        } else {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080, frameRate: 30 }, audio: true });
                screenStreamRef.current = screenStream;
                if (localStream) originalVideoTrackRef.current = localStream.getVideoTracks()[0] || null;
                const screenTrack = screenStream.getVideoTracks()[0];
                await media.replaceVideoTrack(screenTrack);
                screenTrack.onended = () => { handleScreenShare(); };
                signaling.request('muteStateChanged', { kind: 'screen', sharing: true }).catch(() => { });
                setScreenSharing(true);
            } catch (err) { console.error('Screen share failed:', err); }
        }
    }, [screenSharing, localStream]);

    const handleToggleRecording = useCallback(async () => {
        if (isRecording) {
            try {
                const result = await recordingManager.stopRecording();
                recordingManager.downloadLocally(result.blob, `QS-VC-${meetingCode}-${Date.now()}.${result.format}`);
                setIsRecording(false);
            } catch (err) { console.error('Failed to stop recording:', err); }
        } else {
            try {
                const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080 }, audio: true });
                await recordingManager.startRecording(displayStream);
                setIsRecording(true);
                displayStream.getVideoTracks()[0].onended = () => {
                    recordingManager.stopRecording().then((result) => {
                        recordingManager.downloadLocally(result.blob, `QS-VC-${meetingCode}-${Date.now()}.${result.format}`);
                        setIsRecording(false);
                    });
                };
            } catch (err) { console.error('Failed to start recording:', err); }
        }
    }, [isRecording, meetingCode]);

    const handleRaiseHand = useCallback(() => { const raised = !handRaised; setHandRaised(raised); signaling.request('handRaise', { raised }).catch(() => { }); }, [handRaised]);
    const handleSendReaction = useCallback((emoji: string) => { signaling.request('reaction', { emoji }).catch(() => { }); }, []);
    const handleLeave = useCallback(() => { media.close(); signaling.request('leaveRoom', {}).catch(() => { }); signaling.disconnect(); localStream?.getTracks().forEach(t => t.stop()); screenStreamRef.current?.getTracks().forEach(t => t.stop()); navigate('/'); }, [localStream, navigate]);
    const handleSendChat = useCallback((content: string) => { signaling.request('chatMessage', { content, type: 'text' }).catch(() => { }); }, []);

    const formatDuration = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
            : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    const sidePanelOpen = chatOpen || participantsOpen;

    return (
        <div className="meeting-room">
            <div className="meeting-top-bar">
                <div className="top-bar-left">
                    <span className="e2ee-badge">
                        <span className="mi mi-sm">lock</span> E2EE
                    </span>
                    <span className="meeting-code-display">{meetingCode}</span>
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

            <div className="meeting-content">
                <div className={`video-area ${sidePanelOpen ? 'with-panel' : ''}`}>
                    <VideoGrid localStream={localStream} peers={peers} displayName={displayName} videoOff={videoOff} />
                    <ReactionsOverlay onSendReaction={handleSendReaction} />
                </div>

                {chatOpen && (
                    <div className="side-panel">
                        <div className="panel-header">
                            <h3>Chat</h3>
                            <button className="panel-close" onClick={() => setChatOpen(false)}>
                                <span className="mi mi-sm">close</span>
                            </button>
                        </div>
                        <div className="chat-messages">
                            {chatMessages.length === 0 ? (
                                <div className="chat-empty">No messages yet. Say hello!</div>
                            ) : (
                                chatMessages.map((msg) => (
                                    <div key={msg.id} className="chat-msg">
                                        <span className="chat-sender">{msg.displayName}</span>
                                        <span className="chat-text">{msg.content}</span>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="chat-input-area">
                            <input
                                ref={chatInputRef}
                                type="text"
                                placeholder="Type a message..."
                                className="chat-input"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                        handleSendChat((e.target as HTMLInputElement).value);
                                        (e.target as HTMLInputElement).value = '';
                                    }
                                }}
                            />
                            <button className="chat-send-btn" onClick={() => {
                                if (chatInputRef.current && chatInputRef.current.value.trim()) {
                                    handleSendChat(chatInputRef.current.value);
                                    chatInputRef.current.value = '';
                                }
                            }}>
                                <span className="mi mi-sm">send</span>
                            </button>
                        </div>
                    </div>
                )}

                {participantsOpen && (
                    <ParticipantsPanel peers={peers} displayName={displayName} onClose={() => setParticipantsOpen(false)} />
                )}
            </div>

            <ControlBar
                audioMuted={audioMuted} videoOff={videoOff} screenSharing={screenSharing}
                isRecording={isRecording} chatOpen={chatOpen} participantsOpen={participantsOpen}
                handRaised={handRaised}
                onToggleAudio={handleToggleAudio} onToggleVideo={handleToggleVideo}
                onToggleScreen={handleScreenShare} onToggleRecording={handleToggleRecording}
                onToggleChat={() => { setChatOpen(!chatOpen); setParticipantsOpen(false); }}
                onToggleParticipants={() => { setParticipantsOpen(!participantsOpen); setChatOpen(false); }}
                onRaiseHand={handleRaiseHand} onLeave={handleLeave}
            />

            <AIChatBot />
        </div>
    );
}
