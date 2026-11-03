import type { CSSProperties } from 'react';
import VideoTile from './VideoTile';

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
}

interface Props {
    localStream: MediaStream | null;
    peers: Map<string, PeerData>;
    displayName: string;
    videoOff: boolean;
    audioMuted?: boolean;
    handRaised?: boolean;
    /** local tile shows the shared screen */
    sharing?: boolean;
    remoteVolume?: number;
    viewMode?: 'gallery' | 'focus' | 'sidebar' | 'filmstrip';
}

export default function VideoGrid({ localStream, peers, displayName, videoOff, audioMuted = false, handRaised = false, sharing = false, viewMode = 'gallery', remoteVolume = 1 }: Props) {
    const totalPeers = peers.size + 1; // +1 for self

    // Compute grid layout
    const cols = viewMode === 'focus' ? 1 : totalPeers <= 1 ? 1 : totalPeers <= 4 ? 2 : totalPeers <= 9 ? 3 : 4;
    const rows = viewMode === 'focus' ? 1 : Math.ceil(totalPeers / cols);

    return (
        <div
            className="video-grid"
            data-view={viewMode}
            data-peer-count={peers.size}
            style={{
                '--peer-rows': Math.max(peers.size, 1),
                '--peer-columns': Math.max(peers.size, 1),
                ...(viewMode === 'gallery' || viewMode === 'focus' ? {
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                } : {}),
            } as CSSProperties}
        >
            {/* Local video (self) */}
            <VideoTile
                displayName={`${displayName} (You)`}
                stream={localStream}
                isLocal
                videoOff={videoOff}
                audioMuted={audioMuted}
                handRaised={handRaised}
                sharing={sharing}
            />

            {/* Remote peers */}
            {Array.from(peers.values()).map((peer) => (
                <VideoTile
                    key={peer.peerId}
                    displayName={peer.displayName}
                    audioTrack={peer.audioTrack}
                    volume={remoteVolume}
                    videoTrack={peer.videoTrack}
                    videoOff={!peer.videoTrack || !!peer.videoOff}
                    audioMuted={peer.audioMuted ?? !peer.audioTrack}
                    handRaised={peer.handRaised}
                />
            ))}
        </div>
    );
}
