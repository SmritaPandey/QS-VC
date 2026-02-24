import VideoTile from './VideoTile';

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
}

interface Props {
    localStream: MediaStream | null;
    peers: Map<string, PeerData>;
    displayName: string;
    videoOff: boolean;
}

export default function VideoGrid({ localStream, peers, displayName, videoOff }: Props) {
    const totalPeers = peers.size + 1; // +1 for self

    // Compute grid layout
    const cols = totalPeers <= 1 ? 1 : totalPeers <= 4 ? 2 : totalPeers <= 9 ? 3 : 4;
    const rows = Math.ceil(totalPeers / cols);

    return (
        <div
            className="video-grid"
            style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
        >
            {/* Local video (self) */}
            <VideoTile
                displayName={`${displayName} (You)`}
                stream={localStream}
                isLocal
                videoOff={videoOff}
            />

            {/* Remote peers */}
            {Array.from(peers.values()).map((peer) => (
                <VideoTile
                    key={peer.peerId}
                    displayName={peer.displayName}
                    audioTrack={peer.audioTrack}
                    videoTrack={peer.videoTrack}
                    videoOff={!peer.videoTrack}
                />
            ))}
        </div>
    );
}
