/**
 * E2EE Indicator — Shows encryption status in the meeting room.
 */
import React from 'react';

interface Props {
    isE2EEActive: boolean;
    currentEpoch: number;
    participantCount: number;
}

const E2EEIndicator: React.FC<Props> = ({ isE2EEActive, currentEpoch, participantCount }) => {
    if (!isE2EEActive) return null;

    return (
        <div className="e2ee-indicator" title={`E2EE active · Epoch ${currentEpoch} · ${participantCount} encrypted participants`}>
            <span className="e2ee-icon">🔒</span>
            <span className="e2ee-label">End-to-End Encrypted</span>
        </div>
    );
};

export default E2EEIndicator;
