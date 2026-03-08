import React, { useState } from 'react';

interface RoomSettings {
    maxParticipants: number;
    waitingRoomEnabled: boolean;
    locked: boolean;
    password: string | null;
    muteOnEntry: boolean;
    allowScreenShare: boolean;
    allowChat: boolean;
    allowRecording: boolean;
}

interface Participant {
    peerId: string;
    displayName: string;
    role: string;
    audioMuted: boolean;
    videoOff: boolean;
    handRaised: boolean;
}

interface Props {
    isHost: boolean;
    participants: Participant[];
    settings: RoomSettings;
    onMutePeer: (peerId: string) => void;
    onKickPeer: (peerId: string) => void;
    onChangeRole: (peerId: string, role: string) => void;
    onMuteAll: () => void;
    onLockMeeting: (locked: boolean) => void;
    onEndMeeting: () => void;
    onUpdateSettings: (settings: Partial<RoomSettings>) => void;
    onClose: () => void;
}

const HostControlsPanel: React.FC<Props> = ({
    isHost, participants, settings, onMutePeer, onKickPeer,
    onChangeRole, onMuteAll, onLockMeeting, onEndMeeting,
    onUpdateSettings, onClose,
}) => {
    const [activeTab, setActiveTab] = useState<'participants' | 'settings'>('participants');
    const [confirmEnd, setConfirmEnd] = useState(false);

    if (!isHost) return null;

    return (
        <div className="host-controls-panel">
            <div className="host-controls-header">
                <h3>Host Controls</h3>
                <button className="btn-close" onClick={onClose}>
                    <span className="mi mi-sm">close</span>
                </button>
            </div>

            <div className="host-controls-tabs">
                <button className={`tab-btn ${activeTab === 'participants' ? 'active' : ''}`} onClick={() => setActiveTab('participants')}>Participants</button>
                <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
            </div>

            {activeTab === 'participants' && (
                <div className="host-controls-participants">
                    <div className="host-actions-bar">
                        <button className="btn-mute-all" onClick={onMuteAll}>
                            <span className="mi mi-sm">volume_off</span> Mute All
                        </button>
                        <button className={`btn-lock ${settings.locked ? 'active' : ''}`} onClick={() => onLockMeeting(!settings.locked)}>
                            <span className="mi mi-sm">{settings.locked ? 'lock' : 'lock_open'}</span>
                            {settings.locked ? 'Locked' : 'Unlocked'}
                        </button>
                    </div>
                    <ul className="host-participant-list">
                        {participants.map((p) => (
                            <li key={p.peerId} className="host-participant-item">
                                <div className="host-participant-info">
                                    <span className="host-participant-name">{p.displayName}</span>
                                    <span className={`role-badge role-${p.role}`}>{p.role}</span>
                                </div>
                                <div className="host-participant-actions">
                                    <button className="btn-action" onClick={() => onMutePeer(p.peerId)} title="Mute">
                                        <span className="mi mi-sm">{p.audioMuted ? 'mic_off' : 'mic'}</span>
                                    </button>
                                    <select value={p.role} onChange={(e) => onChangeRole(p.peerId, e.target.value)} className="role-select">
                                        <option value="co-host">Co-Host</option>
                                        <option value="member">Member</option>
                                        <option value="guest">Guest</option>
                                    </select>
                                    <button className="btn-kick" onClick={() => onKickPeer(p.peerId)} title="Remove">
                                        <span className="mi mi-sm">person_remove</span>
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="host-controls-settings">
                    <label className="setting-toggle">
                        <span><span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>meeting_room</span>Waiting Room</span>
                        <input type="checkbox" checked={settings.waitingRoomEnabled} onChange={(e) => onUpdateSettings({ waitingRoomEnabled: e.target.checked })} />
                    </label>
                    <label className="setting-toggle">
                        <span><span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>mic_off</span>Mute on Entry</span>
                        <input type="checkbox" checked={settings.muteOnEntry} onChange={(e) => onUpdateSettings({ muteOnEntry: e.target.checked })} />
                    </label>
                    <label className="setting-toggle">
                        <span><span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>screen_share</span>Allow Screen Share</span>
                        <input type="checkbox" checked={settings.allowScreenShare} onChange={(e) => onUpdateSettings({ allowScreenShare: e.target.checked })} />
                    </label>
                    <label className="setting-toggle">
                        <span><span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>chat</span>Allow Chat</span>
                        <input type="checkbox" checked={settings.allowChat} onChange={(e) => onUpdateSettings({ allowChat: e.target.checked })} />
                    </label>
                    <label className="setting-toggle">
                        <span><span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>fiber_manual_record</span>Allow Recording</span>
                        <input type="checkbox" checked={settings.allowRecording} onChange={(e) => onUpdateSettings({ allowRecording: e.target.checked })} />
                    </label>
                    <div className="setting-divider" />
                    {!confirmEnd ? (
                        <button className="btn-end-meeting" onClick={() => setConfirmEnd(true)}>
                            <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>call_end</span>
                            End Meeting for All
                        </button>
                    ) : (
                        <div className="end-confirm">
                            <p>Are you sure you want to end the meeting?</p>
                            <button className="btn-end-confirm" onClick={onEndMeeting}>Yes, End Meeting</button>
                            <button className="btn-end-cancel" onClick={() => setConfirmEnd(false)}>Cancel</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default HostControlsPanel;
