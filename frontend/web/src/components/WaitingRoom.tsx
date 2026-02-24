import React from 'react';

interface WaitingPeer {
    peerId: string;
    displayName: string;
    requestedAt?: string;
}

interface Props {
    waitingPeers: WaitingPeer[];
    onAdmit: (peerId: string) => void;
    onReject: (peerId: string) => void;
    onAdmitAll: () => void;
    isHost: boolean;
}

const WaitingRoom: React.FC<Props> = ({ waitingPeers, onAdmit, onReject, onAdmitAll, isHost }) => {
    if (!isHost || waitingPeers.length === 0) return null;

    return (
        <div className="waiting-room-panel">
            <div className="waiting-room-header">
                <h3>Waiting Room ({waitingPeers.length})</h3>
                <button className="btn-admit-all" onClick={onAdmitAll}>
                    Admit All
                </button>
            </div>
            <ul className="waiting-room-list">
                {waitingPeers.map((peer) => (
                    <li key={peer.peerId} className="waiting-room-item">
                        <div className="waiting-room-avatar">
                            {peer.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="waiting-room-name">{peer.displayName}</span>
                        <div className="waiting-room-actions">
                            <button className="btn-admit" onClick={() => onAdmit(peer.peerId)}>
                                ✓
                            </button>
                            <button className="btn-reject" onClick={() => onReject(peer.peerId)}>
                                ✗
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default WaitingRoom;
