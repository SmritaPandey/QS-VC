/**
 * Connection status banner component.
 * Shows reconnection state to the user.
 */
import React from 'react';
import type { ConnectionState } from '../lib/reconnection-manager';

interface Props {
    state: ConnectionState;
    attemptCount: number;
}

const statusConfig: Record<ConnectionState, { message: string; className: string; icon: string }> = {
    connecting: { message: 'Connecting...', className: 'status-connecting', icon: '⟳' },
    connected: { message: 'Connected', className: 'status-connected', icon: '●' },
    reconnecting: { message: 'Reconnecting...', className: 'status-reconnecting', icon: '⟳' },
    disconnected: { message: 'Disconnected', className: 'status-disconnected', icon: '○' },
    failed: { message: 'Connection failed', className: 'status-failed', icon: '✕' },
};

const ConnectionStatus: React.FC<Props> = ({ state, attemptCount }) => {
    // Don't show when connected
    if (state === 'connected') return null;

    const config = statusConfig[state];

    return (
        <div className={`connection-status-banner ${config.className}`}>
            <span className="connection-icon">{config.icon}</span>
            <span className="connection-message">
                {config.message}
                {state === 'reconnecting' && ` (attempt ${attemptCount})`}
            </span>
            {state === 'failed' && (
                <button className="btn-retry" onClick={() => window.location.reload()}>
                    Retry
                </button>
            )}
        </div>
    );
};

export default ConnectionStatus;
