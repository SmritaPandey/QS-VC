import { useRef, useEffect } from 'react';
import { watchVoiceLevel } from '../lib/voice-activity';
import '../styles/speaking-indicator.css';

interface Props {
    displayName: string;
    stream?: MediaStream | null;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    isLocal?: boolean;
    videoOff?: boolean;
    audioMuted?: boolean;
    handRaised?: boolean;
    sharing?: boolean;
    volume?: number;
}

/** Up to two initials from a display name, ignoring the "(You)" suffix. */
export function initialsOf(name: string): string {
    const words = name.replace(/\(you\)\s*$/i, '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = [...words[0]][0] ?? '';
    const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
    return (first + last).toUpperCase() || '?';
}

export default function VideoTile({ displayName, stream, audioTrack, videoTrack, isLocal, videoOff, audioMuted, handRaised, sharing, volume = 1 }: Props) {
    const micOn = audioMuted !== undefined ? !audioMuted : !!audioTrack;
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const avatarRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);
    const voiceTrack = audioTrack ?? stream?.getAudioTracks()[0];

    useEffect(() => {
        const target = videoOff ? avatarRef.current : indicatorRef.current;
        if (!target) return;
        const update = (level: number) => {
            target.style.setProperty('--voice-level', String(level));
            target.dataset.speaking = String(level > 0);
        };
        update(0);
        if (!micOn || !voiceTrack) return;
        const stop = watchVoiceLevel(voiceTrack, update);
        return () => { stop(); update(0); };
    }, [voiceTrack, videoOff, micOn]);

    useEffect(() => {
        if (videoRef.current) {
            if (stream) {
                videoRef.current.srcObject = stream;
            } else if (videoTrack) {
                const ms = new MediaStream([videoTrack]);
                videoRef.current.srcObject = ms;
            } else {
                videoRef.current.srcObject = null;
            }
        }
    }, [stream, videoTrack]);

    useEffect(() => {
        if (audioRef.current && audioTrack && !isLocal) {
            const ms = new MediaStream([audioTrack]);
            audioRef.current.srcObject = ms;
        }
    }, [audioTrack, isLocal]);

    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, audioTrack]);

    return (
        <div className={`video-tile ${isLocal ? 'local' : ''} ${sharing ? 'is-sharing' : ''}`}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal}
                className={`tile-video ${videoOff ? 'hidden' : ''}`}
            />

            {!isLocal && <audio ref={audioRef} autoPlay />}

            {videoOff && (
                <div className="tile-avatar">
                    <div ref={avatarRef} className="avatar-glass" aria-hidden="true">
                        <span className="avatar-glass-core">{initialsOf(displayName)}</span>
                    </div>
                </div>
            )}

            <div className="tile-name-badge">
                {micOn && !videoOff ? <span ref={indicatorRef} className="qsvc-speaking" role="img" aria-label="Microphone on"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></span> : <span className="mi mi-sm" aria-label={micOn ? 'Microphone on' : 'Microphone off'} style={{ color: micOn ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    {micOn ? 'mic' : 'mic_off'}
                </span>}
                <span className="tile-name">{displayName}{sharing ? ' · presenting' : ''}</span>
                {handRaised && <span className="mi mi-sm tile-hand" aria-label="Hand raised">front_hand</span>}
            </div>
        </div>
    );
}
