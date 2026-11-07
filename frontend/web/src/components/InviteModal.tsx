import { useState, useEffect, useRef, useCallback } from 'react';
import { getToken } from '../lib/session';

export const AUTH_API = import.meta.env.VITE_AUTH_URL || '';
export const MEETING_API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';

interface Props {
    open: boolean;
    meetingCode: string;
    meetingTitle?: string;
    inviteToken?: string;
    onClose: () => void;
}

type TabType = 'members' | 'guest' | 'copy';

interface RegisteredUser {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    role?: string;
}

interface ExistingInvitation {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    avatarUrl?: string;
    assignedRole: string;
    status: 'pending' | 'accepted' | 'declined' | 'revoked';
    createdAt: string;
}

interface ExistingGuestToken {
    id: string;
    expiresAt: string;
    revokedAt: string | null;
    maxUses: number;
    usageCount: number;
    createdAt: string;
}

export default function InviteModal({ open, meetingCode, meetingTitle, inviteToken, onClose }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [activeTab, setActiveTab] = useState<TabType>('members');

    // Method A: Members
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<RegisteredUser[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<Map<string, RegisteredUser>>(new Map());
    const [assignedRole, setAssignedRole] = useState<'participant' | 'co-host'>('participant');
    const [sendingInvite, setSendingInvite] = useState(false);
    const [memberMessage, setMemberMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [invitations, setInvitations] = useState<ExistingInvitation[]>([]);
    const [loadingInvitations, setLoadingInvitations] = useState(false);

    // Method B: Guest Links
    const [expiresInHours, setExpiresInHours] = useState(24);
    const [maxUses, setMaxUses] = useState(100);
    const [generatingGuestToken, setGeneratingGuestToken] = useState(false);
    const [latestGuestUrl, setLatestGuestUrl] = useState('');
    const [copiedGuestUrl, setCopiedGuestUrl] = useState(false);
    const [guestTokens, setGuestTokens] = useState<ExistingGuestToken[]>([]);
    const [loadingGuestTokens, setLoadingGuestTokens] = useState(false);
    const [guestMessage, setGuestMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    // Method C: Copy Meeting Link
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://qsvcmeeting.com';
    const standardLink = `${origin}/meeting/${encodeURIComponent(meetingCode)}/preview${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`;
    const [copiedStandard, setCopiedStandard] = useState(false);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);

    // Load existing invitations
    const loadInvitations = useCallback(async () => {
        const token = getToken();
        if (!token || !meetingCode) return;
        setLoadingInvitations(true);
        try {
            const res = await fetch(`${MEETING_API}/api/meetings/${encodeURIComponent(meetingCode)}/invitations`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setInvitations(data.invitations || []);
            }
        } catch { }
        finally { setLoadingInvitations(false); }
    }, [meetingCode]);

    // Load existing guest tokens
    const loadGuestTokens = useCallback(async () => {
        const token = getToken();
        if (!token || !meetingCode) return;
        setLoadingGuestTokens(true);
        try {
            const res = await fetch(`${MEETING_API}/api/meetings/${encodeURIComponent(meetingCode)}/guest-tokens`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setGuestTokens(data.guestTokens || []);
            }
        } catch { }
        finally { setLoadingGuestTokens(false); }
    }, [meetingCode]);

    useEffect(() => {
        if (!open) return;
        if (activeTab === 'members') void loadInvitations();
        else if (activeTab === 'guest') void loadGuestTokens();
    }, [open, activeTab, loadInvitations, loadGuestTokens]);

    // User search debounce
    useEffect(() => {
        const query = searchQuery.trim();
        if (query.length < 1) {
            setSearchResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            const token = getToken();
            if (!token) return;
            setSearching(true);
            try {
                const res = await fetch(`${AUTH_API}/api/users/search?q=${encodeURIComponent(query)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setSearchResults(data.users || []);
                }
            } catch { }
            finally { setSearching(false); }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const toggleSelectUser = (user: RegisteredUser) => {
        setSelectedUsers(prev => {
            const next = new Map(prev);
            if (next.has(user.id)) next.delete(user.id);
            else next.set(user.id, user);
            return next;
        });
    };

    const handleSendInvitations = async () => {
        const token = getToken();
        if (!token || selectedUsers.size === 0) return;
        setSendingInvite(true);
        setMemberMessage(null);
        try {
            const res = await fetch(`${MEETING_API}/api/meetings/${encodeURIComponent(meetingCode)}/invitations`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inviteeUserIds: Array.from(selectedUsers.keys()),
                    assignedRole,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setMemberMessage({ text: `Sent ${data.created} invitation(s) successfully.`, type: 'success' });
                setSelectedUsers(new Map());
                setSearchQuery('');
                setSearchResults([]);
                void loadInvitations();
            } else {
                setMemberMessage({ text: data.error || 'Failed to send invitations', type: 'error' });
            }
        } catch (err: any) {
            setMemberMessage({ text: err.message || 'Network error', type: 'error' });
        } finally {
            setSendingInvite(false);
        }
    };

    const handleRevokeInvitation = async (inviteId: string) => {
        const token = getToken();
        if (!token) return;
        try {
            const res = await fetch(`${MEETING_API}/api/meetings/${encodeURIComponent(meetingCode)}/invitations/${inviteId}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'revoke' }),
            });
            if (res.ok) void loadInvitations();
        } catch { }
    };

    const handleGenerateGuestToken = async () => {
        const token = getToken();
        if (!token) return;
        setGeneratingGuestToken(true);
        setGuestMessage(null);
        try {
            const res = await fetch(`${MEETING_API}/api/meetings/${encodeURIComponent(meetingCode)}/guest-tokens`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ expiresInHours, maxUses }),
            });
            const data = await res.json();
            if (res.ok) {
                setLatestGuestUrl(data.guestUrl);
                setGuestMessage({ text: 'Unique guest link generated. Hashed for security.', type: 'success' });
                void loadGuestTokens();
            } else {
                setGuestMessage({ text: data.error || 'Failed to generate guest link', type: 'error' });
            }
        } catch (err: any) {
            setGuestMessage({ text: err.message || 'Network error', type: 'error' });
        } finally {
            setGeneratingGuestToken(false);
        }
    };

    const handleRevokeGuestToken = async (tokenId: string) => {
        const token = getToken();
        if (!token) return;
        try {
            const res = await fetch(`${MEETING_API}/api/meetings/${encodeURIComponent(meetingCode)}/guest-tokens/${tokenId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                if (latestGuestUrl.includes(tokenId)) setLatestGuestUrl('');
                void loadGuestTokens();
            }
        } catch { }
    };

    const copyText = async (text: string, onDone: () => void) => {
        try {
            await navigator.clipboard.writeText(text);
            onDone();
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            onDone();
        }
    };

    if (!open) return null;

    return (
        <dialog
            ref={dialogRef}
            className="invite-dialog"
            aria-labelledby="invite-modal-title"
            onCancel={(e) => { e.preventDefault(); onClose(); }}
        >
            <div className="invite-modal-content">
                <div className="invite-modal-header">
                    <div className="invite-title-row">
                        <span className="mi invite-header-icon" aria-hidden="true">person_add</span>
                        <div>
                            <h2 id="invite-modal-title">Invite to {meetingTitle || 'Meeting'}</h2>
                            <p className="invite-code-pill">Code: <strong>{meetingCode}</strong></p>
                        </div>
                    </div>
                    <button type="button" className="invite-modal-close" aria-label="Close invite modal" onClick={onClose}>
                        <span className="mi" aria-hidden="true">close</span>
                    </button>
                </div>

                <div className="invite-tabs-bar" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'members'}
                        className={`invite-tab-btn ${activeTab === 'members' ? 'active' : ''}`}
                        onClick={() => setActiveTab('members')}
                    >
                        <span className="mi" aria-hidden="true">group</span>
                        Members
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'guest'}
                        className={`invite-tab-btn ${activeTab === 'guest' ? 'active' : ''}`}
                        onClick={() => setActiveTab('guest')}
                    >
                        <span className="mi" aria-hidden="true">link</span>
                        Guest Link
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'copy'}
                        className={`invite-tab-btn ${activeTab === 'copy' ? 'active' : ''}`}
                        onClick={() => setActiveTab('copy')}
                    >
                        <span className="mi" aria-hidden="true">content_copy</span>
                        Copy Meeting Link
                    </button>
                </div>

                {/* TAB 1: REGISTERED MEMBERS */}
                {activeTab === 'members' && (
                    <div className="invite-tab-panel" role="tabpanel">
                        <div className="member-search-bar">
                            <span className="mi" aria-hidden="true">search</span>
                            <input
                                type="text"
                                className="member-search-input"
                                placeholder="Search by name or email in your organisation…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                            {searching && <span className="mi spin-indicator" aria-hidden="true">sync</span>}
                        </div>

                        {selectedUsers.size > 0 && (
                            <div className="selected-chips-area">
                                <span className="selected-chips-label">Selected ({selectedUsers.size}):</span>
                                <div className="selected-chips-list">
                                    {Array.from(selectedUsers.values()).map(u => (
                                        <span key={u.id} className="user-chip">
                                            {u.displayName}
                                            <button type="button" onClick={() => toggleSelectUser(u)} aria-label={`Remove ${u.displayName}`}>
                                                <span className="mi" aria-hidden="true">close</span>
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                <div className="assign-role-row">
                                    <label htmlFor="assign-role-select">Role:</label>
                                    <select
                                        id="assign-role-select"
                                        value={assignedRole}
                                        onChange={e => setAssignedRole(e.target.value as any)}
                                        className="role-select"
                                    >
                                        <option value="participant">Participant (Standard attendee)</option>
                                        <option value="co-host">Co-host (Can admit & manage guests)</option>
                                    </select>
                                    <button
                                        type="button"
                                        className="btn-send-invites"
                                        disabled={sendingInvite}
                                        onClick={handleSendInvitations}
                                    >
                                        <span className="mi" aria-hidden="true">send</span>
                                        {sendingInvite ? 'Sending…' : 'Send In-App Invite'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {memberMessage && (
                            <div className={`invite-status-message ${memberMessage.type}`}>
                                <span className="mi" aria-hidden="true">{memberMessage.type === 'success' ? 'check_circle' : 'error'}</span>
                                {memberMessage.text}
                            </div>
                        )}

                        {searchResults.length > 0 && (
                            <div className="search-results-list">
                                <h4 className="subheading">Matching Members</h4>
                                {searchResults.map(user => {
                                    const isSelected = selectedUsers.has(user.id);
                                    return (
                                        <div
                                            key={user.id}
                                            className={`user-result-row ${isSelected ? 'selected' : ''}`}
                                            onClick={() => toggleSelectUser(user)}
                                        >
                                            <div className="user-avatar-bubble">
                                                {user.displayName[0]?.toUpperCase() || '?'}
                                            </div>
                                            <div className="user-result-info">
                                                <span className="user-result-name">{user.displayName}</span>
                                                <span className="user-result-email">{user.email}</span>
                                            </div>
                                            <span className="mi select-checkbox" aria-hidden="true">
                                                {isSelected ? 'check_box' : 'check_box_outline_blank'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {searchQuery && !searching && searchResults.length === 0 && (
                            <p className="empty-search-note">No matching members found in your organisation.</p>
                        )}

                        <div className="existing-invitations-area">
                            <h4 className="subheading">Pending & Responded Invitations ({invitations.length})</h4>
                            {loadingInvitations ? (
                                <p className="loading-note">Loading invitations…</p>
                            ) : invitations.length === 0 ? (
                                <p className="empty-invitations-note">No invitations have been sent yet.</p>
                            ) : (
                                <div className="invitations-table-wrapper">
                                    <table className="invitations-table">
                                        <thead>
                                            <tr>
                                                <th>Member</th>
                                                <th>Role</th>
                                                <th>Status</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invitations.map(inv => (
                                                <tr key={inv.id}>
                                                    <td>
                                                        <div className="inv-user-cell">
                                                            <strong>{inv.displayName}</strong>
                                                            <small>{inv.email}</small>
                                                        </div>
                                                    </td>
                                                    <td><span className="role-tag">{inv.assignedRole}</span></td>
                                                    <td>
                                                        <span className={`status-pill ${inv.status}`}>
                                                            {inv.status}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {inv.status === 'pending' && (
                                                            <button
                                                                type="button"
                                                                className="btn-revoke-invite"
                                                                onClick={() => handleRevokeInvitation(inv.id)}
                                                            >
                                                                Revoke
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TAB 2: GUEST INVITATION */}
                {activeTab === 'guest' && (
                    <div className="invite-tab-panel" role="tabpanel">
                        <div className="guest-token-creator-card">
                            <h3>Create a Secure Guest Link</h3>
                            <p className="card-lead">
                                External guests can join without creating an account. The token is stored as a cryptographic hash on the server.
                            </p>

                            <div className="guest-options-grid">
                                <label className="input-group">
                                    <span>Expires In:</span>
                                    <select
                                        value={expiresInHours}
                                        onChange={e => setExpiresInHours(Number(e.target.value))}
                                    >
                                        <option value={2}>2 Hours</option>
                                        <option value={24}>24 Hours (1 Day)</option>
                                        <option value={72}>3 Days</option>
                                        <option value={168}>7 Days</option>
                                    </select>
                                </label>
                                <label className="input-group">
                                    <span>Max Uses:</span>
                                    <select
                                        value={maxUses}
                                        onChange={e => setMaxUses(Number(e.target.value))}
                                    >
                                        <option value={1}>Single-use (1 guest)</option>
                                        <option value={10}>Up to 10 guests</option>
                                        <option value={50}>Up to 50 guests</option>
                                        <option value={100}>Up to 100 guests</option>
                                    </select>
                                </label>
                            </div>

                            <button
                                type="button"
                                className="btn-generate-guest"
                                disabled={generatingGuestToken}
                                onClick={handleGenerateGuestToken}
                            >
                                <span className="mi" aria-hidden="true">key</span>
                                {generatingGuestToken ? 'Generating…' : 'Generate Guest Access Link'}
                            </button>
                        </div>

                        {guestMessage && (
                            <div className={`invite-status-message ${guestMessage.type}`}>
                                <span className="mi" aria-hidden="true">{guestMessage.type === 'success' ? 'check_circle' : 'error'}</span>
                                {guestMessage.text}
                            </div>
                        )}

                        {latestGuestUrl && (
                            <div className="latest-link-box">
                                <label>New Guest Joining Link:</label>
                                <div className="link-copy-row">
                                    <input type="text" readOnly value={latestGuestUrl} className="link-display-input" />
                                    <button
                                        type="button"
                                        className="btn-copy-action"
                                        onClick={() => copyText(latestGuestUrl, () => {
                                            setCopiedGuestUrl(true);
                                            setTimeout(() => setCopiedGuestUrl(false), 2000);
                                        })}
                                    >
                                        <span className="mi" aria-hidden="true">{copiedGuestUrl ? 'done' : 'content_copy'}</span>
                                        {copiedGuestUrl ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                <div className="share-apps-row">
                                    <span>Share via:</span>
                                    <a
                                        href={`https://wa.me/?text=${encodeURIComponent(`Join my Q-SVC meeting: ${latestGuestUrl}`)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-share-app whatsapp"
                                    >
                                        WhatsApp
                                    </a>
                                    <a
                                        href={`https://t.me/share/url?url=${encodeURIComponent(latestGuestUrl)}&text=${encodeURIComponent(`Join my Q-SVC meeting: ${meetingTitle || meetingCode}`)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-share-app telegram"
                                    >
                                        Telegram
                                    </a>
                                </div>
                            </div>
                        )}

                        <div className="existing-guest-tokens-area">
                            <h4 className="subheading">Active & Past Guest Tokens ({guestTokens.length})</h4>
                            {loadingGuestTokens ? (
                                <p className="loading-note">Loading guest tokens…</p>
                            ) : guestTokens.length === 0 ? (
                                <p className="empty-invitations-note">No guest tokens generated yet.</p>
                            ) : (
                                <div className="invitations-table-wrapper">
                                    <table className="invitations-table">
                                        <thead>
                                            <tr>
                                                <th>Created</th>
                                                <th>Expires</th>
                                                <th>Usage</th>
                                                <th>Status</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {guestTokens.map(gt => {
                                                const isRevoked = !!gt.revokedAt;
                                                const isExpired = new Date(gt.expiresAt).getTime() < Date.now();
                                                const status = isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active';
                                                return (
                                                    <tr key={gt.id}>
                                                        <td>{new Date(gt.createdAt).toLocaleDateString()}</td>
                                                        <td>{new Date(gt.expiresAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                                                        <td>{gt.usageCount} / {gt.maxUses}</td>
                                                        <td><span className={`status-pill ${status.toLowerCase()}`}>{status}</span></td>
                                                        <td>
                                                            {!isRevoked && !isExpired && (
                                                                <button
                                                                    type="button"
                                                                    className="btn-revoke-invite"
                                                                    onClick={() => handleRevokeGuestToken(gt.id)}
                                                                >
                                                                    Revoke
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TAB 3: COPY MEETING LINK */}
                {activeTab === 'copy' && (
                    <div className="invite-tab-panel" role="tabpanel">
                        <div className="copy-link-card">
                            <div className="copy-link-icon-bubble">
                                <span className="mi" aria-hidden="true">share</span>
                            </div>
                            <h3>Share Meeting Link</h3>
                            <p className="card-lead">
                                Anyone with this link can join directly or request entry according to the host's access policy.
                            </p>

                            <div className="link-copy-row">
                                <input type="text" readOnly value={standardLink} className="link-display-input" />
                                <button
                                    type="button"
                                    className="btn-copy-action primary"
                                    onClick={() => copyText(standardLink, () => {
                                        setCopiedStandard(true);
                                        setTimeout(() => setCopiedStandard(false), 2000);
                                    })}
                                >
                                    <span className="mi" aria-hidden="true">{copiedStandard ? 'done' : 'content_copy'}</span>
                                    {copiedStandard ? 'Copied Link' : 'Copy Link'}
                                </button>
                            </div>

                            <div className="meeting-summary-box">
                                <div className="summary-item">
                                    <span className="summary-label">Meeting Title:</span>
                                    <span className="summary-val">{meetingTitle || 'Instant Meeting'}</span>
                                </div>
                                <div className="summary-item">
                                    <span className="summary-label">Meeting Code:</span>
                                    <span className="summary-val code">{meetingCode}</span>
                                </div>
                                <div className="summary-item">
                                    <span className="summary-label">Security:</span>
                                    <span className="summary-val">Signed Token Authentication</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </dialog>
    );
}
