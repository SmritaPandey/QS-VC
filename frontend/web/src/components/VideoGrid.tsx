import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import VideoTile from './VideoTile';
import { autoPageSize, computeLayout, gridShape, type LayoutPerson } from '../lib/meeting-layout';
import '../styles/meeting-stage.css';

export interface GridPeer {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
    role?: string;
    presenting?: boolean;
    onStage?: boolean;
}

export type ViewMode = 'auto' | 'tiled' | 'spotlight' | 'sidebar';
export type TilesPerPage = 'auto' | 4 | 9 | 16 | 25 | 49;

interface Props {
    localStream: MediaStream | null;
    myPeerId: string;
    myRole?: string;
    myOnStage?: boolean;
    peers: Map<string, GridPeer>;
    displayName: string;
    videoOff: boolean;
    audioMuted?: boolean;
    handRaised?: boolean;
    sharing?: boolean;
    viewMode?: ViewMode;
    tilesPerPage?: TilesPerPage;
    webinar?: boolean;
    speaking: Set<string>;
    activeSpeaker: string | null;
    spotlightId: string | null;
    pinnedId: string | null;
    canManage?: boolean;
    onPin: (peerId: string | null) => void;
    onSpotlight?: (peerId: string | null) => void;
    onToggleStage?: (peerId: string, onStage: boolean) => void;
}

/**
 * The meeting stage. Paged gallery for big meetings, one large focus tile (pin, spotlight or presenter)
 * with a paged strip, and a stage-only view for webinars. Audio is played separately (RemoteAudio),
 * so people on other pages are still heard.
 */
export default function VideoGrid({ localStream, myPeerId, myRole, myOnStage, peers, displayName, videoOff, audioMuted = false, handRaised = false, sharing = false, viewMode = 'auto', tilesPerPage = 'auto', webinar = false, speaking, activeSpeaker, spotlightId, pinnedId, canManage = false, onPin, onSpotlight, onToggleStage }: Props) {
    const areaRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ width: 1200, height: 700 });
    const [page, setPage] = useState(0);
    useLayoutEffect(() => {
        const el = areaRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const selfId = myPeerId || 'self';
    const people = useMemo<LayoutPerson[]>(() => [
        { id: selfId, isLocal: true, role: myRole, onStage: myOnStage, presenting: sharing, handRaised },
        ...Array.from(peers.values()).map(p => ({ id: p.peerId, role: p.role, onStage: p.onStage, presenting: p.presenting, handRaised: p.handRaised })),
    ], [selfId, myRole, myOnStage, sharing, handRaised, peers]);

    // "Spotlight" and "Sidebar" views always show one large tile: the focus, else whoever is speaking.
    const forcedFocus = (viewMode === 'spotlight' || viewMode === 'sidebar') && !pinnedId && !spotlightId && !people.some(p => p.presenting)
        ? (activeSpeaker && activeSpeaker !== selfId ? activeSpeaker : people.find(p => !p.isLocal)?.id ?? null) : null;
    const preview = computeLayout({ people, webinar, pinnedId: pinnedId || forcedFocus, spotlightId, activeSpeaker, pageSize: 1, page: 0 });
    const hasFocus = viewMode !== 'tiled' && !!preview.focusId;
    const stripSide = viewMode === 'sidebar' && box.width > 700 ? 'side' : 'bottom';
    const size = tilesPerPage === 'auto' ? autoPageSize(box.width, box.height, hasFocus) : hasFocus ? Math.min(tilesPerPage, stripSide === 'side' ? 6 : 8) : tilesPerPage;
    const layout = computeLayout({ people, webinar, pinnedId: hasFocus ? (pinnedId || forcedFocus) : null, spotlightId: hasFocus ? spotlightId : null, activeSpeaker, pageSize: size, page });
    useEffect(() => { if (layout.page !== page) setPage(layout.page); }, [layout.page, page]);

    const tileFor = (id: string, tileSize: 'stage' | 'strip' | 'grid') => {
        const actions = {
            pinned: pinnedId === id,
            onPin: () => onPin(pinnedId === id ? null : id),
            spotlighted: spotlightId === id,
            onSpotlight: canManage && onSpotlight ? () => onSpotlight(spotlightId === id ? null : id) : undefined,
        };
        if (id === selfId) return <VideoTile key={id} size={tileSize} displayName={`${displayName} (You)`} stream={localStream} isLocal videoOff={videoOff}
            audioMuted={audioMuted} handRaised={handRaised} sharing={sharing} role={myRole} speaking={speaking.has(selfId)} {...actions} />;
        const peer = peers.get(id);
        if (!peer) return null;
        const stageAction = webinar && canManage && onToggleStage && peer.role !== 'host' && peer.role !== 'co-host'
            ? { onStage: !!peer.onStage, onToggleStage: () => onToggleStage(id, !peer.onStage) } : {};
        return <VideoTile key={id} size={tileSize} displayName={peer.displayName} audioTrack={peer.audioTrack} videoTrack={peer.videoTrack}
            videoOff={!peer.videoTrack || !!peer.videoOff} audioMuted={peer.audioMuted ?? !peer.audioTrack} handRaised={peer.handRaised}
            sharing={peer.presenting} role={peer.role} speaking={speaking.has(id)} {...actions} {...stageAction} />;
    };

    const pager = layout.pages > 1 && <nav className="qs-pager" aria-label="Pages of participants">
        <button type="button" aria-label="Previous page" disabled={layout.page === 0} onClick={() => setPage(layout.page - 1)}><span className="mi" aria-hidden="true">chevron_left</span></button>
        <span aria-live="polite">{layout.page + 1} / {layout.pages}</span>
        <button type="button" aria-label="Next page" disabled={layout.page >= layout.pages - 1} onClick={() => setPage(layout.page + 1)}><span className="mi" aria-hidden="true">chevron_right</span></button>
    </nav>;
    const audience = null; // the audience count is shown in the top bar

    if (hasFocus && layout.focusId) {
        const stripCount = Math.max(layout.tiles.length, 1);
        return <div ref={areaRef} className="qs-video-root"><div className={`qs-stage-layout qs-strip-${stripSide}`} data-count={layout.tiles.length}>
            <div className="qs-stage">{tileFor(layout.focusId, 'stage')}</div>
            {layout.tiles.length > 0 && <div className="qs-strip" style={{ '--strip-count': stripCount } as CSSProperties}>
                {layout.tiles.map(id => tileFor(id, 'strip'))}
                {pager}
            </div>}
            {audience}
        </div></div>;
    }
    const { cols, rows } = gridShape(Math.max(layout.tiles.length, 1), box.width, box.height - (layout.pages > 1 ? 48 : 0));
    return <div ref={areaRef} className="qs-video-root"><div className="qs-gallery-layout">
        <div className="video-grid qs-gallery" data-count={layout.tiles.length} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
            {layout.tiles.map(id => tileFor(id, 'grid'))}
        </div>
        {pager}
        {audience}
    </div></div>;
}

/** Plays every remote participant's audio, whether or not their tile is on screen. */
export function RemoteAudio({ peers, volume = 1 }: { peers: Map<string, GridPeer>; volume?: number }) {
    return <div className="qs-remote-audio" aria-hidden="true">
        {Array.from(peers.values()).filter(p => p.audioTrack).map(p => <PeerAudio key={p.peerId} track={p.audioTrack!} volume={volume} />)}
    </div>;
}

function PeerAudio({ track, volume }: { track: MediaStreamTrack; volume: number }) {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => { if (ref.current) ref.current.srcObject = new MediaStream([track]); }, [track]);
    useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume, track]);
    return <audio ref={ref} autoPlay />;
}
