import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import VideoTile from './VideoTile';
import { autoPageSize, computeLayout, gridShape, type LayoutPerson } from '../lib/meeting-layout';
import '../styles/meeting-stage.css';
import '../styles/multi-content-stage.css';

export interface GridPeer {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    cameraTracks?: Record<string, MediaStreamTrack>;
    siteLocation?: string;
    userId?: string | null;
    screenVideoTrack?: MediaStreamTrack;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
    role?: string;
    presenting?: boolean;
    onStage?: boolean;
}

export type ViewMode = 'auto' | 'tiled' | 'spotlight' | 'sidebar';
export type TilesPerPage = 'auto' | 4 | 9 | 16 | 25 | 49;
const SCREEN_TILE_PREFIX = '__screen__:';
const CAMERA_TILE_PREFIX = '__camera__:';
const screenTileId = (peerId: string) => `${SCREEN_TILE_PREFIX}${peerId}`;

interface Props {
    localStream: MediaStream | null;
    localCameraTracks?: Record<string, MediaStreamTrack>;
    siteLocation?: string;
    userId?: string | null;
    localScreenTrack?: MediaStreamTrack | null;
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
export default function VideoGrid({ localStream, localCameraTracks = {}, siteLocation, userId, localScreenTrack, myPeerId, myRole, myOnStage, peers, displayName, videoOff, audioMuted = false, handRaised = false, sharing = false, viewMode = 'auto', tilesPerPage = 'auto', webinar = false, speaking, activeSpeaker, spotlightId, pinnedId, canManage = false, onPin, onSpotlight, onToggleStage }: Props) {
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
    const cameraOwners = new Map<string, { peerId: string; source: string; track: MediaStreamTrack }>();
    for (const [source, track] of Object.entries(localCameraTracks)) {
        if (/^camera:[234]$/.test(source) && track.readyState === 'live') cameraOwners.set(`${CAMERA_TILE_PREFIX}${selfId}:${source}`, { peerId: selfId, source, track });
    }
    for (const peer of peers.values()) for (const [source, track] of Object.entries(peer.cameraTracks || {})) {
        if (/^camera:[234]$/.test(source) && track.readyState === 'live') cameraOwners.set(`${CAMERA_TILE_PREFIX}${peer.peerId}:${source}`, { peerId: peer.peerId, source, track });
    }
    const people: LayoutPerson[] = [
        { id: selfId, isLocal: true, role: myRole, onStage: myOnStage, handRaised },
        ...Array.from(peers.values()).map(peer => ({ id: peer.peerId, role: peer.role, onStage: peer.onStage, handRaised: peer.handRaised })),
        ...Array.from(cameraOwners, ([id, camera]) => {
            const owner = peers.get(camera.peerId);
            return { id, isLocal: camera.peerId === selfId, role: camera.peerId === selfId ? myRole : owner?.role, onStage: camera.peerId === selfId ? myOnStage : owner?.onStage };
        }),
    ];
    const presentationIds = [
        ...(sharing && localScreenTrack?.readyState === 'live' ? [selfId] : []),
        ...Array.from(peers.values()).filter(peer => peer.screenVideoTrack?.readyState === 'live').map(peer => peer.peerId),
    ];

    // "Spotlight" and "Sidebar" views always show one large tile: the focus, else whoever is speaking.
    const forcedFocus = (viewMode === 'spotlight' || viewMode === 'sidebar') && !pinnedId && !spotlightId && !people.some(p => p.presenting)
        ? (activeSpeaker && activeSpeaker !== selfId ? activeSpeaker : people.find(p => !p.isLocal)?.id ?? null) : null;
    const preview = computeLayout({ people, webinar, pinnedId: pinnedId || forcedFocus, spotlightId, activeSpeaker, pageSize: 1, page: 0 });
    // A presentation always gets the main stage, even when a viewer prefers a tiled gallery.
    const hasFocus = !!preview.focusId && (viewMode !== 'tiled' || preview.focusReason === 'presenting');
    const wideStage = box.width > 950 && box.width / Math.max(box.height, 1) > 1.35;
    const stripSide = (viewMode === 'sidebar' || (viewMode === 'auto' && wideStage)) && wideStage ? 'side' : 'bottom';
    const size = tilesPerPage === 'auto' ? autoPageSize(box.width, box.height, hasFocus) : hasFocus ? Math.min(tilesPerPage, stripSide === 'side' ? 6 : 8) : tilesPerPage;
    const layout = computeLayout({ people, webinar, pinnedId: hasFocus ? (pinnedId || forcedFocus) : null, spotlightId: hasFocus ? spotlightId : null, activeSpeaker, pageSize: size, page });
    useEffect(() => { if (!presentationIds.length && layout.page !== page) setPage(layout.page); }, [layout.page, page, presentationIds.length]);

    const tileFor = (id: string, tileSize: 'stage' | 'strip' | 'grid') => {
        const isScreenTile = id.startsWith(SCREEN_TILE_PREFIX);
        const camera = cameraOwners.get(id);
        const peerId = isScreenTile ? id.slice(SCREEN_TILE_PREFIX.length) : camera?.peerId || id;
        const participantId = peerId;
        const actions = {
            pinned: pinnedId === id,
            onPin: () => onPin(pinnedId === id ? null : id),
            spotlighted: spotlightId === participantId,
            onSpotlight: canManage && onSpotlight ? () => onSpotlight(spotlightId === participantId ? null : participantId) : undefined,
        };
        if (camera) {
            const local = camera.peerId === selfId;
            const peer = peers.get(camera.peerId);
            return <VideoTile key={id} size={tileSize} displayName={`${local ? displayName + ' (You)' : peer?.displayName || 'Participant'} · Camera ${camera.source.slice(-1)}`}
                siteLocation={local ? siteLocation : peer?.siteLocation} userId={local ? userId : peer?.userId}
                videoTrack={camera.track} isLocal={local} videoOff={false} audioMuted={local ? audioMuted : peer?.audioMuted} role={local ? myRole : peer?.role} {...actions} />;
        }
        if (isScreenTile) {
            if (peerId === selfId) return <VideoTile key={id} size={tileSize} displayName={`${displayName} (You)`} siteLocation={siteLocation} userId={userId} mediaLabel="Screen" videoTrack={localScreenTrack || undefined}
                audioTrack={localStream?.getAudioTracks()[0]} videoOff={!localScreenTrack} audioMuted={audioMuted} sharing role={myRole} {...actions} />;
            const peer = peers.get(peerId);
            if (!peer) return null;
            return <VideoTile key={id} size={tileSize} displayName={peer.displayName} siteLocation={peer.siteLocation} userId={peer.userId} mediaLabel="Screen" audioTrack={peer.audioTrack} videoTrack={peer.screenVideoTrack}
                videoOff={!peer.screenVideoTrack} audioMuted={peer.audioMuted ?? !peer.audioTrack} sharing role={peer.role} {...actions} />;
        }
        if (id === selfId) return <VideoTile key={id} size={tileSize} displayName={`${displayName} (You)`} siteLocation={siteLocation} userId={userId} stream={localStream} isLocal videoOff={videoOff}
            mediaLabel={sharing && localScreenTrack ? 'Camera' : undefined} audioMuted={audioMuted} handRaised={handRaised} role={myRole} speaking={speaking.has(selfId)} {...actions} />;
        const peer = peers.get(id);
        if (!peer) return null;
        const stageAction = webinar && canManage && onToggleStage && peer.role !== 'host' && peer.role !== 'co-host'
            ? { onStage: !!peer.onStage, onToggleStage: () => onToggleStage(id, !peer.onStage) } : {};
        return <VideoTile key={id} size={tileSize} displayName={peer.displayName} siteLocation={peer.siteLocation} userId={peer.userId} mediaLabel={peer.screenVideoTrack ? 'Camera' : undefined} audioTrack={peer.audioTrack} videoTrack={peer.videoTrack}
            videoOff={!peer.videoTrack || !!peer.videoOff} audioMuted={peer.audioMuted ?? !peer.audioTrack} handRaised={peer.handRaised}
            role={peer.role} speaking={speaking.has(id)} {...actions} {...stageAction} />;
    };

    const pager = layout.pages > 1 && <nav className="qs-pager" aria-label="Pages of participants">
        <button type="button" aria-label="Previous page" disabled={layout.page === 0} onClick={() => setPage(layout.page - 1)}><span className="mi" aria-hidden="true">chevron_left</span></button>
        <span aria-live="polite">{layout.page + 1} / {layout.pages}</span>
        <button type="button" aria-label="Next page" disabled={layout.page >= layout.pages - 1} onClick={() => setPage(layout.page + 1)}><span className="mi" aria-hidden="true">chevron_right</span></button>
    </nav>;
    const audience = null; // the audience count is shown in the top bar

    if (presentationIds.length) {
        const cameraLayout = computeLayout({ people, webinar, pinnedId: null, spotlightId: null, activeSpeaker, pageSize: tilesPerPage === 'auto' ? Math.max(4, autoPageSize(box.width, Math.max(180, box.height / 3), false)) : tilesPerPage, page });
        const cameraShape = gridShape(Math.max(cameraLayout.tiles.length, 1), box.width, Math.max(160, box.height / 3));
        return <div ref={areaRef} className="qs-video-root qs-multi-content-stage">
            <section className="qs-content-area" aria-label="Shared content">
                <h2 className="sr-only">Shared content</h2>
                <div className="qs-content-grid" data-count={presentationIds.length}>{presentationIds.map(peerId => tileFor(screenTileId(peerId), 'stage'))}</div>
            </section>
            <section className="qs-camera-area" aria-label="Participant cameras">
                <h2 className="sr-only">Participant cameras</h2>
                <div className="qs-camera-gallery" style={{ gridTemplateColumns: `repeat(${cameraShape.cols}, minmax(0, 1fr))` }}>
                    {cameraLayout.tiles.map(id => tileFor(id, 'grid'))}
                </div>
                {cameraLayout.pages > 1 && <nav className="qs-pager" aria-label="Pages of cameras"><button type="button" disabled={!cameraLayout.page} onClick={() => setPage(cameraLayout.page - 1)} aria-label="Previous cameras"><span className="mi" aria-hidden="true">chevron_left</span></button><span aria-live="polite">{cameraLayout.page + 1} / {cameraLayout.pages}</span><button type="button" disabled={cameraLayout.page >= cameraLayout.pages - 1} onClick={() => setPage(cameraLayout.page + 1)} aria-label="Next cameras"><span className="mi" aria-hidden="true">chevron_right</span></button></nav>}
            </section>
        </div>;
    }

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
export function RemoteAudio({ peers, volume = 1, outputDeviceId, onOutputError }: { peers: Map<string, GridPeer>; volume?: number; outputDeviceId?: string; onOutputError?: () => void }) {
    return <div className="qs-remote-audio" aria-hidden="true">
        {Array.from(peers.values()).filter(p => p.audioTrack).map(p => <PeerAudio key={p.peerId} track={p.audioTrack!} volume={volume} outputDeviceId={outputDeviceId} onOutputError={onOutputError} />)}
    </div>;
}

function PeerAudio({ track, volume, outputDeviceId, onOutputError }: { track: MediaStreamTrack; volume: number; outputDeviceId?: string; onOutputError?: () => void }) {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => { if (ref.current) ref.current.srcObject = new MediaStream([track]); }, [track]);
    useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume, track]);
    useEffect(() => {
        const audio = ref.current as (HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
        if (!audio?.setSinkId) return;
        void audio.setSinkId(outputDeviceId || 'default').catch(() => onOutputError?.());
    }, [outputDeviceId, onOutputError, track]);
    return <audio ref={ref} autoPlay />;
}
