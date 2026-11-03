import { useState } from 'react';

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

interface Props {
    peers: Map<string, PeerData>;
    displayName: string;
    myRole?: string;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
    onClose: () => void;
}

export default function ParticipantsPanel({ peers, displayName, myRole = 'member', audioMuted = false, videoOff = false, handRaised = false, onClose }: Props) {
    const [searchQuery, setSearchQuery] = useState('');

    const allParticipants = [
        { peerId: 'self', displayName: `${displayName} (You)`, isLocal: true, role: myRole, micOn: !audioMuted, camOn: !videoOff, handRaised },
        ...Array.from(peers.values()).map(p => ({
            ...p, isLocal: false,
            micOn: p.audioMuted !== undefined ? !p.audioMuted : !!p.audioTrack,
            camOn: p.videoOff !== undefined ? !p.videoOff && !!p.videoTrack : !!p.videoTrack,
            handRaised: !!p.handRaised,
        })),
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
                <button className="panel-close" aria-label="Close participants" onClick={onClose}>
                    <span className="mi mi-sm">close</span>
                </button>
            </div>

            <div className="participants-search">
                <input
                    type="text"
                    aria-label="Search participants" placeholder="Search participants…"
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
                            {(p.role === 'host' || p.role === 'co-host') && <span className="participant-role">{p.role === 'host' ? 'Host' : 'Co-host'}</span>}
                        </div>
                        <div className="participant-status">
                            {p.handRaised && <span className="status-icon mi mi-sm is-hand" title="Hand raised">front_hand</span>}
                            <span className={`status-icon mi mi-sm ${p.micOn ? '' : 'is-off'}`} title={p.micOn ? 'Microphone on' : 'Microphone off'}>
                                {p.micOn ? 'mic' : 'mic_off'}
                            </span>
                            <span className={`status-icon mi mi-sm ${p.camOn ? '' : 'is-off'}`} title={p.camOn ? 'Camera on' : 'Camera off'}>
                                {p.camOn ? 'videocam' : 'videocam_off'}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
