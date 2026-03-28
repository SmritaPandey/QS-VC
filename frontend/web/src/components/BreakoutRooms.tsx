/**
 * BreakoutRooms — Sub-room management for large meetings.
 *
 * Features:
 * - Create/manage multiple breakout rooms
 * - Auto-assign or manual participant assignment
 * - Timed breakout sessions
 * - Broadcast message from host to all rooms
 * - Per-room chat isolation
 * - Return all participants to main room
 */
import React, { useState } from 'react';

interface BreakoutRoom {
    id: string;
    name: string;
    participants: { id: string; name: string }[];
    isActive: boolean;
    timer?: number;  // minutes
}

interface BreakoutRoomsProps {
    isHost: boolean;
    mainRoomParticipants: { id: string; name: string }[];
    onCreateRooms: (rooms: { name: string; participants: string[] }[]) => void;
    onCloseRooms: () => void;
    onBroadcast: (message: string) => void;
    onMoveParticipant: (participantId: string, roomId: string) => void;
    breakoutRooms: BreakoutRoom[];
    isOpen: boolean;
    onClose: () => void;
}

const BreakoutRooms: React.FC<BreakoutRoomsProps> = ({
    isHost,
    mainRoomParticipants,
    onCreateRooms,
    onCloseRooms,
    onBroadcast,
    breakoutRooms,
    isOpen,
    onClose,
}) => {
    const [roomCount, setRoomCount] = useState(2);
    const [assignMode, setAssignMode] = useState<'auto' | 'manual'>('auto');
    const [timer, setTimer] = useState(15);
    const [broadcastMsg, setBroadcastMsg] = useState('');

    if (!isOpen) return null;

    const handleCreate = () => {
        const rooms: { name: string; participants: string[] }[] = [];
        for (let i = 0; i < roomCount; i++) {
            rooms.push({ name: `Room ${i + 1}`, participants: [] });
        }

        if (assignMode === 'auto') {
            // Round-robin assignment
            mainRoomParticipants.forEach((p, idx) => {
                rooms[idx % roomCount].participants.push(p.id);
            });
        }

        onCreateRooms(rooms);
    };

    return (
        <div style={{
            position: 'absolute',
            right: '16px',
            top: '60px',
            width: '360px',
            maxHeight: 'calc(100vh - 160px)',
            background: 'linear-gradient(135deg, #0d0d1e 0%, #1a1a35 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(99,102,241,0.2)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            zIndex: 100,
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(99,102,241,0.08)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>🏠</span>
                    <span style={{ fontWeight: 700, color: '#fff', fontSize: '14px' }}>Breakout Rooms</span>
                </div>
                <button onClick={onClose} style={{
                    background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px',
                    color: '#fff', padding: '6px 8px', cursor: 'pointer',
                }}>✕</button>
            </div>

            <div style={{ padding: '16px', overflowY: 'auto', maxHeight: '400px' }}>
                {breakoutRooms.length === 0 ? (
                    /* Setup */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '4px' }}>
                                Number of Rooms
                            </label>
                            <input
                                type="number" min={2} max={20} value={roomCount}
                                onChange={e => setRoomCount(parseInt(e.target.value) || 2)}
                                style={{
                                    width: '100%', background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                                    color: '#fff', padding: '8px 12px', fontSize: '14px',
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            {(['auto', 'manual'] as const).map(mode => (
                                <button key={mode} onClick={() => setAssignMode(mode)} style={{
                                    flex: 1, padding: '8px', borderRadius: '8px',
                                    background: assignMode === mode ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${assignMode === mode ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                                    color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                                }}>
                                    {mode === 'auto' ? '🎲 Auto-assign' : '✋ Manual'}
                                </button>
                            ))}
                        </div>

                        <div>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '4px' }}>
                                Timer (minutes) — 0 for unlimited
                            </label>
                            <input
                                type="number" min={0} max={120} value={timer}
                                onChange={e => setTimer(parseInt(e.target.value) || 0)}
                                style={{
                                    width: '100%', background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                                    color: '#fff', padding: '8px 12px', fontSize: '14px',
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        <div style={{
                            padding: '10px', borderRadius: '8px',
                            background: 'rgba(255,255,255,0.03)', fontSize: '12px',
                            color: 'rgba(255,255,255,0.5)',
                        }}>
                            {mainRoomParticipants.length} participants will be split into {roomCount} rooms
                            (~{Math.ceil(mainRoomParticipants.length / roomCount)} per room)
                        </div>

                        {isHost && (
                            <button onClick={handleCreate} style={{
                                padding: '10px', borderRadius: '10px',
                                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                border: 'none', color: '#fff', cursor: 'pointer',
                                fontSize: '14px', fontWeight: 600,
                            }}>
                                🚀 Open Breakout Rooms
                            </button>
                        )}
                    </div>
                ) : (
                    /* Active rooms */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {breakoutRooms.map(room => (
                            <div key={room.id} style={{
                                padding: '12px', borderRadius: '10px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.06)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ fontWeight: 600, color: '#fff', fontSize: '13px' }}>
                                        {room.name}
                                    </span>
                                    <span style={{ fontSize: '11px', color: '#6366f1' }}>
                                        {room.participants.length} participants
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {room.participants.map(p => (
                                        <span key={p.id} style={{
                                            padding: '2px 8px', borderRadius: '10px',
                                            background: 'rgba(99,102,241,0.15)',
                                            color: '#a5b4fc', fontSize: '11px',
                                        }}>
                                            {p.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Broadcast */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                                type="text" placeholder="Broadcast to all rooms..."
                                value={broadcastMsg}
                                onChange={e => setBroadcastMsg(e.target.value)}
                                style={{
                                    flex: 1, background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                                    color: '#fff', padding: '8px 10px', fontSize: '12px',
                                }}
                                onKeyDown={e => { if (e.key === 'Enter' && broadcastMsg.trim()) { onBroadcast(broadcastMsg); setBroadcastMsg(''); } }}
                            />
                            <button onClick={() => { if (broadcastMsg.trim()) { onBroadcast(broadcastMsg); setBroadcastMsg(''); } }} style={{
                                background: '#6366f1', border: 'none', borderRadius: '8px',
                                color: '#fff', padding: '8px 12px', cursor: 'pointer', fontSize: '12px',
                            }}>
                                📢
                            </button>
                        </div>

                        {isHost && (
                            <button onClick={onCloseRooms} style={{
                                padding: '10px', borderRadius: '10px',
                                background: 'rgba(239,68,68,0.2)',
                                border: '1px solid rgba(239,68,68,0.3)',
                                color: '#ef4444', cursor: 'pointer',
                                fontSize: '13px', fontWeight: 600,
                            }}>
                                Close All Breakout Rooms
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BreakoutRooms;
