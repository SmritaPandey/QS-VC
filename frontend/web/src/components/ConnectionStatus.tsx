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
    connecting: { message: 'Connecting...', className: 'status-connecting', icon: 'sync' },
    connected: { message: 'Connected', className: 'status-connected', icon: 'check_circle' },
    reconnecting: { message: 'Reconnecting...', className: 'status-reconnecting', icon: 'sync' },
    disconnected: { message: 'Disconnected', className: 'status-disconnected', icon: 'cloud_off' },
    failed: { message: 'Connection failed', className: 'status-failed', icon: 'error' },
};

const ConnectionStatus: React.FC<Props> = ({ state, attemptCount }) => {
    if (state === 'connected') return null;
    const config = statusConfig[state];

    return (
        <div className={`connection-status-banner ${config.className}`}>
            <span className="mi mi-sm connection-icon">{config.icon}</span>
            <span className="connection-message">
                {config.message}
                {state === 'reconnecting' && ` (attempt ${attemptCount})`}
            </span>
            {state === 'failed' && (
                <button className="btn-retry" onClick={() => window.location.reload()}>
                    <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>refresh</span>
                    Retry
                </button>
            )}
        </div>
    );
};

export default ConnectionStatus;
