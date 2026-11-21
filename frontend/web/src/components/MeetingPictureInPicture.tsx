import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GridPeer } from './VideoGrid';
import { initialsOf } from './VideoTile';
import '../styles/meeting-picture-in-picture.css';

interface DocumentPip { requestWindow(options: { width: number; height: number }): Promise<Window>; }
export interface MeetingPictureInPictureHandle { toggle: () => Promise<void>; }
interface Props {
    peers: Map<string, GridPeer>;
    localStream: MediaStream | null;
    localScreenTrack?: MediaStreamTrack | null;
    sharing?: boolean;
    displayName: string;
    videoOff: boolean;
    audioMuted: boolean;
    cameraStartAllowed?: boolean;
    activeSpeaker: string | null;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onNotice: (message: string) => void;
    onOpenChange: (open: boolean) => void;
}

/** Reuses received tracks; the floating view never captures media or plays duplicate audio. */
export function pictureInPicturePreview(peers: Map<string, GridPeer>, activeSpeaker: string | null,
    localStream: MediaStream | null, videoOff: boolean, displayName: string) {
    const live = (track?: MediaStreamTrack) => track?.readyState === 'live' ? track : undefined;
    const people = [...peers.values()];
    const presenter = people.find(peer => live(peer.screenVideoTrack));
    if (presenter) return { name: `${presenter.displayName} is presenting`, track: presenter.screenVideoTrack };
    const speaker = people.find(peer => peer.peerId === activeSpeaker);
    const participant = speaker && !speaker.videoOff && live(speaker.videoTrack) ? speaker
        : people.find(peer => !peer.videoOff && live(peer.videoTrack));
    if (participant) return { name: participant.displayName, track: participant.videoTrack };
    const localTrack = !videoOff ? live(localStream?.getVideoTracks()[0]) : undefined;
    if (localTrack) return { name: `${displayName} (You)`, track: localTrack };
    return { name: speaker?.displayName || people[0]?.displayName || `${displayName} (You)`, track: undefined };
}

export function MeetingPipControls({ audioMuted, videoOff, cameraStartAllowed = true, onToggleAudio, onToggleVideo, onReturn }: {
    audioMuted: boolean; videoOff: boolean; cameraStartAllowed?: boolean;
    onToggleAudio: () => void; onToggleVideo: () => void; onReturn: () => void;
}) {
    const cameraBlocked = videoOff && !cameraStartAllowed;
    const cameraLabel = cameraBlocked ? 'Return to meeting to start camera' : videoOff ? 'Turn camera on' : 'Turn camera off';
    return <>
        <div className="meeting-pip-controls">
            <button type="button" className={`meeting-pip-btn ${audioMuted ? 'is-muted' : 'is-active'}`} aria-pressed={!audioMuted} aria-label={audioMuted ? 'Unmute microphone' : 'Mute microphone'} onClick={onToggleAudio}><span className="mi" aria-hidden="true">{audioMuted ? 'mic_off' : 'mic'}</span></button>
            <button type="button" className={`meeting-pip-btn ${videoOff ? 'is-off' : 'is-active'}`} disabled={cameraBlocked} title={cameraLabel} aria-pressed={!videoOff} aria-label={cameraLabel} onClick={onToggleVideo}><span className="mi" aria-hidden="true">{videoOff ? 'videocam_off' : 'videocam'}</span></button>
            <button type="button" className="meeting-pip-return" onClick={onReturn}><span className="mi mi-sm" aria-hidden="true">open_in_full</span><span>Back to meeting</span></button>
        </div>
        {cameraBlocked && <p className="meeting-pip-camera-hint">Return to meeting to start camera.</p>}
    </>;
}

const MeetingPictureInPicture = forwardRef<MeetingPictureInPictureHandle, Props>(function MeetingPictureInPicture({
    peers, localStream, sharing, displayName, videoOff, audioMuted, cameraStartAllowed = true, activeSpeaker,
    onToggleAudio, onToggleVideo, onNotice, onOpenChange,
}, ref) {
    const [pipWindow, setPipWindow] = useState<Window | null>(null);
    const [inline, setInline] = useState(false);
    const windowRef = useRef<Window | null>(null);
    const opening = useRef(false);
    const mounted = useRef(true);
    const videoRef = useRef<HTMLVideoElement>(null);
    const preview = pictureInPicturePreview(peers, activeSpeaker, localStream, videoOff, displayName);
    const open = Boolean(pipWindow || inline);
    const changeRef = useRef(onOpenChange);
    changeRef.current = onOpenChange;
    useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; windowRef.current?.close(); windowRef.current = null; changeRef.current(false); };
    }, []);
    function close() {
        windowRef.current?.close(); windowRef.current = null;
        setPipWindow(null); setInline(false);
    }
    useImperativeHandle(ref, () => ({ toggle: async () => {
        if (open) { close(); return; }
        if (opening.current) return;
        const api = (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
        if (!api) {
            setInline(true);
            onNotice('Floating view opened inside this tab. Use desktop Chrome or Edge for an always-on-top window.');
            return;
        }
        opening.current = true;
        try {
            const target = await api.requestWindow({ width: 400, height: 360 });
            if (!mounted.current) { target.close(); return; }
            windowRef.current = target;
            target.document.title = 'QS-VC · Floating meeting';
            const base = target.document.createElement('base');
            base.href = document.baseURI; target.document.head.append(base);
            for (const sheet of Array.from(document.styleSheets)) {
                try {
                    const style = target.document.createElement('style');
                    style.textContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
                    target.document.head.append(style);
                } catch {
                    if (sheet.href) { const link = target.document.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; target.document.head.append(link); }
                }
            }
            target.document.body.className = 'meeting-pip-window';
            target.addEventListener('pagehide', () => {
                if (windowRef.current === target) { windowRef.current = null; if (mounted.current) setPipWindow(null); }
            }, { once: true });
            setPipWindow(target);
        } catch {
            windowRef.current?.close(); windowRef.current = null;
            if (mounted.current) onNotice('The floating window could not open. Allow picture-in-picture in your browser and try again.');
        } finally { opening.current = false; }
    } }));
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = preview.track ? new MediaStream([preview.track]) : null;
        if (preview.track) void video.play().catch(() => undefined);
        return () => { video.srcObject = null; };
    }, [preview.track, open, pipWindow]);
    if (!open) return null;
    const panel = <section className={`meeting-pip ${inline ? 'meeting-pip-inline' : ''}`} aria-label="Floating meeting">
        <header className="meeting-pip-header">
            <div className="meeting-pip-brand">
                <span className="mi meeting-pip-logo-icon" aria-hidden="true">videocam</span>
                <span>QS-VC{sharing ? ' · Presenting' : ''}</span>
            </div>
            <button type="button" className="meeting-pip-close" onClick={close} aria-label="Close floating view">
                <span className="mi" aria-hidden="true">close</span>
            </button>
        </header>
        <div className="meeting-pip-preview">
            {preview.track ? <video ref={videoRef} autoPlay playsInline muted aria-label={preview.name} /> : (
                <div className="meeting-pip-avatar-wrap">
                    <span className="meeting-pip-avatar" aria-hidden="true">{initialsOf(preview.name)}</span>
                </div>
            )}
            <p className="meeting-pip-name">{preview.name}</p>
        </div>
        <MeetingPipControls audioMuted={audioMuted} videoOff={videoOff} cameraStartAllowed={cameraStartAllowed}
            onToggleAudio={onToggleAudio} onToggleVideo={onToggleVideo} onReturn={() => { window.focus(); close(); }} />
    </section>;
    return pipWindow ? createPortal(panel, pipWindow.document.body) : panel;
});
export default MeetingPictureInPicture;
