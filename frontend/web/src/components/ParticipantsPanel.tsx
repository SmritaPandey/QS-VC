import { useState } from 'react';

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
}

interface Props {
    peers: Map<string, PeerData>;
    displayName: string;
    onClose: () => void;
}

export default function ParticipantsPanel({ peers, displayName, onClose }: Props) {
    const [searchQuery, setSearchQuery] = useState('');

    const allParticipants = [
        { peerId: 'self', displayName: `${displayName} (You)`, isLocal: true },
        ...Array.from(peers.values()).map(p => ({ ...p, isLocal: false })),
    ];

    const filtered = searchQuery
        ? allParticipants.filter(p =>
            p.displayName.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : allParticipants;

    return (
        <div className="side-panel">
            <div className="panel-header">
                <h3>Participants ({allParticipants.length})</h3>
                <button className="panel-close" onClick={onClose}>
                    <span className="mi mi-sm">close</span>
                </button>
            </div>

            <div className="participants-search">
                <input
                    type="text"
                    placeholder="Search participants..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="participants-search-input"
                />
            </div>

            <div className="participants-list">
                {filtered.map((p) => (
                    <div key={p.peerId} className="participant-item">
                        <div className="participant-avatar">
                            {p.displayName[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="participant-info">
                            <span className="participant-name">{p.displayName}</span>
                            {p.isLocal && <span className="participant-role">Host</span>}
                        </div>
                        <div className="participant-status">
                            <span className="status-icon mi mi-sm" title="Audio">
                                {(p as any).audioTrack ? 'mic' : 'mic_off'}
                            </span>
                            <span className="status-icon mi mi-sm" title="Video">
                                {(p as any).videoTrack ? 'videocam' : 'videocam_off'}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
