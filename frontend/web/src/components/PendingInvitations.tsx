import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../lib/session';
import ActionContents from './ActionContents';

const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';

export interface PendingInvitation {
    id: string;
    assignedRole: string;
    status: 'pending' | 'accepted' | 'declined' | 'revoked';
    createdAt: string;
    expiresAt: string | null;
    meetingCode: string;
    meetingTitle: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    hostName: string;
}

export interface UserNotification {
    id: string;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    meetingId: string | null;
    meetingCode: string | null;
    invitationId: string | null;
    createdAt: string;
}

interface Props {
    onCountChange?: (count: number) => void;
    onExpired?: () => void;
}

export default function PendingInvitations({ onCountChange, onExpired }: Props) {
    const navigate = useNavigate();
    const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
    const [notifications, setNotifications] = useState<UserNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        const token = getToken();
        if (!token) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/notifications`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.status === 401) {
                onExpired?.();
                return;
            }
            if (!res.ok) throw new Error('Failed to load invitations');
            const data = await res.json();
            const invites: PendingInvitation[] = Array.isArray(data.pendingInvitations) ? data.pendingInvitations : [];
            const notifs: UserNotification[] = Array.isArray(data.notifications) ? data.notifications : [];
            setInvitations(invites);
            setNotifications(notifs);
            onCountChange?.(invites.length);
        } catch {
            setError('Could not load your invitations right now.');
        } finally {
            setLoading(false);
        }
    }, [onCountChange, onExpired]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const handleAccept = async (invite: PendingInvitation) => {
        const token = getToken();
        if (!token) return;
        setActionLoadingId(invite.id);
        try {
            const res = await fetch(`${API}/api/meetings/${encodeURIComponent(invite.meetingCode)}/invitations/${invite.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ action: 'accept' })
            });
            if (res.status === 401) {
                onExpired?.();
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || 'Failed to accept invitation');
                return;
            }
            // Navigate to meeting
            navigate(`/meeting/${encodeURIComponent(invite.meetingCode)}/preview`);
        } catch {
            alert('Failed to connect. Please try again.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleDecline = async (invite: PendingInvitation) => {
        const token = getToken();
        if (!token) return;
        if (typeof window !== 'undefined' && !window.confirm(`Decline invitation to "${invite.meetingTitle || invite.meetingCode}"?`)) return;
        setActionLoadingId(invite.id);
        try {
            const res = await fetch(`${API}/api/meetings/${encodeURIComponent(invite.meetingCode)}/invitations/${invite.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ action: 'decline' })
            });
            if (res.status === 401) {
                onExpired?.();
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || 'Failed to decline invitation');
                return;
            }
            setInvitations(prev => {
                const updated = prev.filter(item => item.id !== invite.id);
                onCountChange?.(updated.length);
                return updated;
            });
        } catch {
            alert('Failed to decline invitation. Please try again.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleMarkNotificationRead = async (notifId: string) => {
        const token = getToken();
        if (!token) return;
        try {
            await fetch(`${API}/api/notifications/${notifId}/read`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });
            setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, isRead: true } : n));
        } catch {
            // ignore failure
        }
    };

    if (loading) {
        return (
            <div className="workspace-state" role="status">
                <span className="mi" aria-hidden="true">mail</span>
                <h2>Loading invitations…</h2>
                <p>Checking for meetings you’ve been invited to.</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="workspace-state" role="alert">
                <span className="mi" aria-hidden="true">cloud_off</span>
                <h2>Could not load invitations</h2>
                <p>{error}</p>
                <button className="qsvc-action qsvc-action--secondary" onClick={() => void loadData()}>
                    <ActionContents>Try again</ActionContents>
                </button>
            </div>
        );
    }

    if (invitations.length === 0 && notifications.length === 0) {
        return (
            <div className="workspace-state">
                <div className="workspace-empty-calendar" aria-hidden="true">
                    <span className="mi">mark_email_read</span>
                </div>
                <h2>No pending invitations</h2>
                <p>When someone invites you to a meeting, it will appear right here.</p>
            </div>
        );
    }

    return (
        <div className="pending-invitations-container">
            {invitations.length > 0 && (
                <div className="workspace-list">
                    <h3 className="invitations-section-title">Meeting Invitations ({invitations.length})</h3>
                    {invitations.map(invite => {
                        const isCoHost = invite.assignedRole === 'co-host';
                        const isBusy = actionLoadingId === invite.id;
                        return (
                            <article className="workspace-meeting-row" key={invite.id}>
                                <div className="invitation-icon-col">
                                    <span className="mi mi-invitation-badge">
                                        {isCoHost ? 'verified_user' : 'group'}
                                    </span>
                                </div>
                                <div>
                                    <h2>{invite.meetingTitle || 'Untitled meeting'}</h2>
                                    <p>
                                        <span className="workspace-code">{invite.meetingCode}</span>
                                        <span>Invited by <strong>{invite.hostName}</strong></span>
                                        <span className={`invite-role-tag ${isCoHost ? 'is-cohost' : 'is-participant'}`}>
                                            Role: {isCoHost ? 'Co-host' : 'Participant'}
                                        </span>
                                        {invite.scheduledStart ? (
                                            <span>
                                                Scheduled for: {new Date(invite.scheduledStart).toLocaleDateString(undefined, {
                                                    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                                })}
                                            </span>
                                        ) : (
                                            <span className="invite-instant-tag">Instant meeting</span>
                                        )}
                                    </p>
                                </div>
                                <div className="workspace-row-actions">
                                    <button
                                        type="button"
                                        className="btn-decline-invite"
                                        disabled={isBusy}
                                        onClick={() => void handleDecline(invite)}
                                    >
                                        Decline
                                    </button>
                                    <button
                                        type="button"
                                        className="workspace-row-join qsvc-action"
                                        disabled={isBusy}
                                        onClick={() => void handleAccept(invite)}
                                    >
                                        <ActionContents>
                                            <span className="mi" aria-hidden="true">check</span>
                                            {isBusy ? 'Joining…' : 'Accept & Join'}
                                        </ActionContents>
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {notifications.length > 0 && (
                <div className="workspace-list" style={{ marginTop: '32px' }}>
                    <h3 className="invitations-section-title">Notifications</h3>
                    {notifications.map(notif => (
                        <article
                            className={`workspace-meeting-row notif-row ${notif.isRead ? 'is-read' : 'is-unread'}`}
                            key={notif.id}
                        >
                            <div className="invitation-icon-col">
                                <span className="mi">{notif.isRead ? 'notifications_none' : 'notifications_active'}</span>
                            </div>
                            <div>
                                <h2>{notif.title}</h2>
                                <p>{notif.message}</p>
                                <time dateTime={notif.createdAt} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {new Date(notif.createdAt).toLocaleDateString(undefined, {
                                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                    })}
                                </time>
                            </div>
                            <div className="workspace-row-actions">
                                {notif.meetingCode && (
                                    <button
                                        type="button"
                                        className="workspace-row-join qsvc-action"
                                        onClick={() => navigate(`/meeting/${encodeURIComponent(notif.meetingCode!)}/preview`)}
                                    >
                                        <ActionContents>Open</ActionContents>
                                    </button>
                                )}
                                {!notif.isRead && (
                                    <button
                                        type="button"
                                        className="btn-text"
                                        onClick={() => void handleMarkNotificationRead(notif.id)}
                                    >
                                        Mark read
                                    </button>
                                )}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}
