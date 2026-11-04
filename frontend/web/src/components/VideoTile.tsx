import { useRef, useEffect, useState } from 'react';
import { watchVoiceLevel } from '../lib/voice-activity';
import '../styles/speaking-indicator.css';

export interface TileActions {
    pinned?: boolean;
    onPin?: () => void;
    /** host/co-host only */
    spotlighted?: boolean;
    onSpotlight?: () => void;
    /** webinars, host/co-host only */
    onStage?: boolean;
    onToggleStage?: () => void;
}

interface Props extends TileActions {
    displayName: string;
    stream?: MediaStream | null;
    videoTrack?: MediaStreamTrack;
    /** used only for the little speaking bars; playback happens in RemoteAudio */
    audioTrack?: MediaStreamTrack;
    isLocal?: boolean;
    videoOff?: boolean;
    audioMuted?: boolean;
    handRaised?: boolean;
    sharing?: boolean;
    speaking?: boolean;
    role?: string;
    size?: 'stage' | 'strip' | 'grid';
}

/** Up to two initials from a display name, ignoring the "(You)" suffix. */
export function initialsOf(name: string): string {
    const words = name.replace(/\(you\)\s*$/i, '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = [...words[0]][0] ?? '';
    const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
    return (first + last).toUpperCase() || '?';
}

export default function VideoTile({ displayName, stream, audioTrack, videoTrack, isLocal, videoOff, audioMuted, handRaised, sharing, speaking = false, role, size = 'grid', pinned, onPin, spotlighted, onSpotlight, onStage, onToggleStage }: Props) {
    const micOn = audioMuted !== undefined ? !audioMuted : !!audioTrack;
    const tileRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const avatarRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const voiceTrack = audioTrack ?? stream?.getAudioTracks()[0];
    const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;

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
        const video = videoRef.current;
        if (!video) return;
        if (stream) video.srcObject = stream;
        else if (videoTrack) video.srcObject = new MediaStream([videoTrack]);
        else video.srcObject = null;
    }, [stream, videoTrack]);

    useEffect(() => {
        const sync = () => setFullscreen(document.fullscreenElement === tileRef.current);
        document.addEventListener('fullscreenchange', sync);
        return () => document.removeEventListener('fullscreenchange', sync);
    }, []);

    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
    }, [menuOpen]);

    const toggleFullscreen = () => {
        setMenuOpen(false);
        if (!canFullscreen) return;
        if (document.fullscreenElement === tileRef.current) void document.exitFullscreen?.();
        else void tileRef.current?.requestFullscreen?.().catch(() => {});
    };
    const name = displayName.replace(/\s*\(You\)\s*$/, '');
    const hasMenu = !!(onPin || onSpotlight || onToggleStage) || canFullscreen;

    return (
        <div ref={tileRef} className={`video-tile qs-tile qs-tile--${size} ${isLocal ? 'local' : ''} ${sharing ? 'is-sharing' : ''}`}
            data-speaking={speaking && micOn ? 'true' : undefined} data-pinned={pinned || undefined} data-spotlight={spotlighted || undefined}
            onDoubleClick={event => { if ((event.target as HTMLElement).closest('button')) return; toggleFullscreen(); }}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`tile-video ${videoOff ? 'hidden' : ''} ${isLocal && !sharing ? 'is-mirrored' : ''}`}
            />

            {videoOff && (
                <div className="tile-avatar">
                    <div ref={avatarRef} className="avatar-glass" aria-hidden="true">
                        <span className="avatar-glass-core">{initialsOf(displayName)}</span>
                    </div>
                </div>
            )}

            <div className="qs-tile-flags">
                {sharing && <span className="qs-flag qs-flag--present"><span className="mi" aria-hidden="true">present_to_all</span>Presenting</span>}
                {spotlighted && <span className="qs-flag"><span className="mi" aria-hidden="true">star</span>Spotlight</span>}
                {pinned && <span className="qs-flag"><span className="mi" aria-hidden="true">push_pin</span>Pinned</span>}
            </div>

            {hasMenu && <div className="qs-tile-menu" ref={menuRef}>
                <button type="button" className="qs-tile-menu-btn" aria-label={`Options for ${name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
                    <span className="mi" aria-hidden="true">more_vert</span>
                </button>
                {menuOpen && <div className="qs-tile-menu-list" role="menu">
                    {onPin && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onPin(); }}><span className="mi" aria-hidden="true">{pinned ? 'keep_off' : 'push_pin'}</span>{pinned ? 'Unpin' : 'Pin for me'}</button>}
                    {onSpotlight && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSpotlight(); }}><span className="mi" aria-hidden="true">{spotlighted ? 'star_half' : 'star'}</span>{spotlighted ? 'Remove spotlight' : 'Spotlight for everyone'}</button>}
                    {onToggleStage && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onToggleStage(); }}><span className="mi" aria-hidden="true">{onStage ? 'person_remove' : 'co_present'}</span>{onStage ? 'Move to audience' : 'Invite to stage'}</button>}
                    {canFullscreen && <button type="button" role="menuitem" onClick={toggleFullscreen}><span className="mi" aria-hidden="true">{fullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>}
                </div>}
            </div>}

            <div className="tile-name-badge">
                {micOn && !videoOff ? <span ref={indicatorRef} className="qsvc-speaking" role="img" aria-label="Microphone on"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></span> : <span className="mi mi-sm" aria-label={micOn ? 'Microphone on' : 'Microphone off'} style={{ color: micOn ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    {micOn ? 'mic' : 'mic_off'}
                </span>}
                <span className="tile-name">{displayName}</span>
                {(role === 'host' || role === 'co-host') && <span className="qs-role">{role === 'host' ? 'Host' : 'Co-host'}</span>}
                {handRaised && <span className="mi mi-sm tile-hand" aria-label="Hand raised">front_hand</span>}
            </div>
        </div>
    );
}
