import AdminAnalytics from '../components/AdminAnalytics';
import ThemeSelect from '../components/ThemeSelect';
import { AUTH_API, clearSession, getToken } from '../lib/session';
import { useSession } from '../lib/use-session';
import EnterpriseAccessTerms from '../components/EnterpriseAccessTerms';
/**
 * Admin Dashboard — Real-time monitoring, user management, and analytics.
 */
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface DashboardStats {
    activeMeetings: number;
    totalParticipants: number;
    totalUsers: number;
    recordingsCount: number;
    sfuHealth: 'healthy' | 'degraded' | 'down';
    signalingHealth: 'healthy' | 'degraded' | 'down';
    authHealth: 'healthy' | 'degraded' | 'down';
    recordingHealth: 'healthy' | 'degraded' | 'down';
    uptime: string;
    totalMeetingsToday: number;
    avgMeetingDuration: string;
    peakConcurrent: number;
}

interface ActiveMeeting {
    meetingCode: string;
    host: string;
    participants: number;
    startedAt: string;
    isRecording: boolean;
}

interface UserRecord {
    id: string;
    email: string;
    displayName: string;
    phoneNumber: string | null;
    role: 'admin' | 'user' | 'guest';
    plan: string;
    planStatus: string;
    billingProvider: 'razorpay' | 'paypal' | 'cashfree' | null;
    billingStatus: string | null;
    subscriptionEndsAt: string | null;
    billingAmount: string | null;
    billingCurrency: string | null;
    createdAt: string;
    lastLogin: string;
    meetingCount: number;
    status: 'active' | 'suspended' | 'invited';
}

type UserDirectory = { totalUsers: number; total: number; planCounts: Record<string, number>; users: UserRecord[] };
const USER_PAGE_SIZE = 50;
const userPlanLabels: Record<string, string> = {
    admin: 'Admin', guest: 'Free', basic_trial: 'Basic trial', business_trial: 'Business trial', starter_trial: 'Starter trial', pro_trial: 'Pro trial', trial_expired: 'Trial expired',
    basic: 'Basic', starter: 'Starter', pro: 'Pro', business: 'Business', paid_expired: 'Expired', enterprise: 'Enterprise',
};

function formatBillingAmount(amount: string, currency: string) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return `${currency} ${amount}`;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
    catch { return `${currency} ${value.toFixed(2)}`; }
}

interface RecordingRecord {
    id: string;
    meetingCode: string;
    host: string;
    duration: string;
    size: string;
    createdAt: string;
    format: string;
}

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4001';
const AUTH_URL = import.meta.env.VITE_AUTH_URL || 'http://localhost:4002';
const MEETING_URL = import.meta.env.VITE_MEETING_URL || 'http://localhost:4003';
const RECORDING_URL = import.meta.env.VITE_RECORDING_URL || 'http://localhost:4004';

type TabName = 'overview' | 'meetings' | 'users' | 'recordings' | 'system';

const AdminDashboard: React.FC = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState<DashboardStats>({
        activeMeetings: 0, totalParticipants: 0, totalUsers: 0,
        recordingsCount: 0, sfuHealth: 'healthy', signalingHealth: 'healthy',
        authHealth: 'healthy', recordingHealth: 'healthy', uptime: '0h',
        totalMeetingsToday: 0, avgMeetingDuration: '0m', peakConcurrent: 0,
    });
    const [meetings, setMeetings] = useState<ActiveMeeting[]>([]);
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
    const [activeTab, setActiveTab] = useState<TabName>('overview');
    const [userSearch, setUserSearch] = useState('');
    const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
    const [userPlanFilter, setUserPlanFilter] = useState<string>('all');
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [userPage, setUserPage] = useState(0);
    const [usersTotal, setUsersTotal] = useState(0);
    const [planCounts, setPlanCounts] = useState<Record<string, number>>({});
    const [userDirectoryError, setUserDirectoryError] = useState('');

    // ── Fetch dashboard data ──
    useEffect(() => {
        const fetchStats = async () => {
            try {
                const results = await Promise.allSettled([
                    fetch(`${SIGNALING_URL}/health`).then(r => r.json()),
                    fetch(`${AUTH_URL}/health`).then(r => r.json()),
                    fetch(`${MEETING_URL}/health`).then(r => r.json()),
                    fetch(`${RECORDING_URL}/health`).then(r => r.json()),
                ]);

                const [sig, auth, _meet, rec] = results;

                setStats(prev => ({
                    ...prev,
                    signalingHealth: sig.status === 'fulfilled' ? 'healthy' : 'down',
                    authHealth: auth.status === 'fulfilled' ? 'healthy' : 'down',
                    sfuHealth: sig.status === 'fulfilled' ? 'healthy' : 'down',
                    recordingHealth: rec.status === 'fulfilled' ? 'healthy' : 'down',
                    activeMeetings: sig.status === 'fulfilled' ? (sig.value?.rooms || 0) : prev.activeMeetings,
                }));
            } catch {
                // Silently handle
            }
        };

        const fetchRecordings = async () => {
            try {
                const res = await fetch(`${RECORDING_URL}/api/recordings`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setRecordings(data.recordings || []);
                    setStats(prev => ({ ...prev, recordingsCount: data.recordings?.length || 0 }));
                }
            } catch { /* silent */ }
        };

        const fetchMeetings = async () => {
            try {
                const res = await fetch(`${MEETING_URL}/api/meetings?status=active`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setMeetings(data.meetings || []);
                }
            } catch { /* silent */ }
        };

        fetchStats();
        fetchRecordings();
        fetchMeetings();

        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => { setUserSearchQuery(userSearch); setUserPage(0); }, 250);
        return () => window.clearTimeout(timer);
    }, [userSearch]);

    useEffect(() => {
        const controller = new AbortController();
        const query = new URLSearchParams({
            limit: String(USER_PAGE_SIZE), offset: String(userPage * USER_PAGE_SIZE),
            search: userSearchQuery, role: userRoleFilter,
        });
        if (userPlanFilter !== 'all') query.set('plan', userPlanFilter);
        fetch(`${AUTH_URL}/api/auth/admin/users?${query}`, {
            headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal,
        }).then(async response => {
            if (!response.ok) throw new Error('The admin account directory is unavailable.');
            return await response.json() as UserDirectory;
        }).then(data => {
            setUsers(data.users || []);
            setUsersTotal(data.total || 0);
            setPlanCounts(data.planCounts || {});
            setStats(prev => ({ ...prev, totalUsers: data.totalUsers || 0 }));
            setUserDirectoryError('');
        }).catch(() => {
            if (controller.signal.aborted) return;
            setUserDirectoryError('The account directory is unavailable. Try again.');
        });
        return () => controller.abort();
    }, [userPage, userPlanFilter, userRoleFilter, userSearchQuery]);

    // ── Health status helper ──
    const HealthDot: React.FC<{ status: string; label: string }> = ({ status, label }) => (
        <div className={`health-item health-${status}`}>
            <span className="health-dot" />
            <span>{label}</span>
            <span className="health-label">{status}</span>
        </div>
    );

    return (
        <div className="admin-dashboard">
            <header className="admin-header">
                <div className="admin-logo">
                    <span className="logo-mark">QS</span>
                    <span className="logo-text">Admin Console</span>
                </div>
                <div className="admin-header-actions"><ThemeSelect />
                    <button className="btn-back-to-app" onClick={() => navigate('/schedule')}>
                        <span className="mi mi-sm">calendar_today</span> Schedule
                    </button>
                    <button className="btn-back-to-app" onClick={() => navigate('/app')}>
                        <span className="mi mi-sm">arrow_back</span> Back to App
                    </button>
                </div>
            </header>

            <nav className="admin-nav">
                {(['overview', 'meetings', 'users', 'recordings', 'system'] as TabName[]).map(tab => (
                    <button
                        key={tab}
                        className={`admin-nav-btn ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        <span className="mi mi-sm" style={{ marginRight: '4px' }}>
                            {tab === 'overview' && 'dashboard'}
                            {tab === 'meetings' && 'videocam'}
                            {tab === 'users' && 'group'}
                            {tab === 'recordings' && 'mic'}
                            {tab === 'system' && 'settings'}
                        </span>
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </nav>

            <main className="admin-content">
                {activeTab === 'users' && <EnterpriseAccessTerms />}
                {activeTab === 'overview' && <AdminAnalytics onManageAccess={() => setActiveTab('users')} />}

                {/* ━━━ MEETINGS TAB ━━━ */}
                {activeTab === 'meetings' && (
                    <div className="admin-meetings">
                        <div className="tab-header">
                            <h2>Active Meetings</h2>
                            <span className="badge">{meetings.length} active</span>
                        </div>
                        {meetings.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon"><span className="mi" style={{ fontSize: '48px' }}>videocam</span></div>
                                <p>No active meetings right now</p>
                            </div>
                        ) : (
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Meeting Code</th>
                                        <th>Host</th>
                                        <th>Participants</th>
                                        <th>Started</th>
                                        <th>Recording</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {meetings.map(m => (
                                        <tr key={m.meetingCode}>
                                            <td><code>{m.meetingCode}</code></td>
                                            <td>{m.host}</td>
                                            <td>{m.participants}</td>
                                            <td>{new Date(m.startedAt).toLocaleTimeString()}</td>
                                            <td>{m.isRecording ? <span style={{ color: 'var(--accent-danger)' }}><span className="mi mi-sm" style={{ verticalAlign: 'middle' }}>fiber_manual_record</span> Recording</span> : '—'}</td>
                                            <td>
                                                <button
                                                    className="btn-sm"
                                                    onClick={() => navigate(`/meeting/${m.meetingCode}`)}
                                                >
                                                    Join
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* ━━━ USERS TAB ━━━ */}
                {activeTab === 'users' && (
                    <div className="admin-users">
                        <div className="tab-header">
                            <h2>User Management</h2>
                            <span className="badge">{stats.totalUsers.toLocaleString()} total users</span>
                        </div>

                        <div className="admin-user-plan-summary" aria-label="Users by plan">
                            {Object.entries(userPlanLabels).map(([key, label]) => <article key={key}>
                                <span>{label}</span><strong>{(planCounts[key] || 0).toLocaleString()}</strong>
                            </article>)}
                        </div>

                        <div className="filter-bar">
                            <input
                                type="text"
                                placeholder="Search by name, email or mobile..."
                                value={userSearch}
                                onChange={e => setUserSearch(e.target.value)}
                                className="form-input search-input"
                            />
                            <select
                                value={userRoleFilter}
                                onChange={e => setUserRoleFilter(e.target.value)}
                                className="form-input role-filter"
                            >
                                <option value="all">All Roles</option>
                                <option value="admin">Admin</option>
                                <option value="user">User</option>
                                <option value="guest">Guest</option>
                            </select>
                            <select
                                value={userPlanFilter}
                                onChange={e => { setUserPlanFilter(e.target.value); setUserPage(0); }}
                                className="form-input role-filter"
                                aria-label="Filter by plan"
                            >
                                <option value="all">All Plans</option>
                                {Object.entries(userPlanLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                            </select>
                        </div>

                        {userDirectoryError && <p role="alert">{userDirectoryError}</p>}

                        {users.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon"><span className="mi" style={{ fontSize: '48px' }}>person</span></div>
                                <p>{userSearch || userPlanFilter !== 'all' || userRoleFilter !== 'all' ? 'No users match these filters' : 'No users registered yet'}</p>
                            </div>
                        ) : (
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Mobile</th>
                                        <th>Role</th>
                                        <th>Plan</th>
                                        <th>Payment</th>
                                        <th>Status</th>
                                        <th>Joined</th>
                                        <th>Last Login</th>
                                        <th>Meetings</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id}>
                                            <td className="user-name">
                                                <div className="avatar-sm">{u.displayName?.[0]?.toUpperCase() || '?'}</div>
                                                {u.displayName}
                                            </td>
                                            <td>{u.email}</td>
                                            <td>{u.phoneNumber || '—'}</td>
                                            <td>
                                                <span className={`role-badge role-${u.role}`}>{u.role}</span>
                                            </td>
                                            <td><strong>{userPlanLabels[u.plan] || u.plan}</strong><br /><small>{u.planStatus?.replace(/_/g, ' ') || '—'}</small></td>
                                            <td>{u.billingProvider ? <><span>{{ razorpay: 'Razorpay', paypal: 'PayPal', cashfree: 'Cashfree' }[u.billingProvider]} · {u.billingStatus || 'pending'}</span>{u.billingAmount && u.billingCurrency ? <><br /><small>{formatBillingAmount(u.billingAmount, u.billingCurrency)}</small></> : null}{u.subscriptionEndsAt && <><br /><small>Access through {new Date(u.subscriptionEndsAt).toLocaleDateString()}</small></>}</> : '—'}</td>
                                            <td>
                                                <span className={`status-badge status-${u.status}`}>{u.status}</span>
                                            </td>
                                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                                            <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                                            <td>{u.meetingCount}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        <div className="admin-user-pagination">
                            <span>{usersTotal ? `Showing ${userPage * USER_PAGE_SIZE + 1}–${Math.min((userPage + 1) * USER_PAGE_SIZE, usersTotal)} of ${usersTotal.toLocaleString()}` : '0 matching users'}</span>
                            <div><button type="button" className="btn-sm" disabled={userPage === 0} onClick={() => setUserPage(page => Math.max(0, page - 1))}>Previous</button>
                                <button type="button" className="btn-sm" disabled={(userPage + 1) * USER_PAGE_SIZE >= usersTotal} onClick={() => setUserPage(page => page + 1)}>Next</button></div>
                        </div>
                    </div>
                )}

                {/* ━━━ RECORDINGS TAB ━━━ */}
                {activeTab === 'recordings' && (
                    <div className="admin-recordings">
                        <div className="tab-header">
                            <h2>All Recordings</h2>
                            <span className="badge">{recordings.length} total</span>
                        </div>

                        {recordings.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon"><span className="mi" style={{ fontSize: '48px' }}>mic</span></div>
                                <p>No recordings available</p>
                            </div>
                        ) : (
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Meeting</th>
                                        <th>Host</th>
                                        <th>Duration</th>
                                        <th>Size</th>
                                        <th>Format</th>
                                        <th>Date</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recordings.map(r => (
                                        <tr key={r.id}>
                                            <td><code>{r.meetingCode}</code></td>
                                            <td>{r.host}</td>
                                            <td>{r.duration}</td>
                                            <td>{r.size}</td>
                                            <td>{r.format}</td>
                                            <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                                            <td>
                                                <button
                                                    className="btn-sm"
                                                    onClick={() => navigate(`/recordings/${r.id}`)}
                                                >
                                                    <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>play_arrow</span> Play
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* ━━━ SYSTEM TAB ━━━ */}
                {activeTab === 'system' && (
                    <div className="admin-system">
                        <h2>Service status</h2>

                        <div className="system-sections">
                            <section className="system-section">
                                <h3>Availability</h3>
                                <div className="health-grid">
                                    <HealthDot status={stats.sfuHealth} label="Meeting audio and video" />
                                    <HealthDot status={stats.signalingHealth} label="Meeting connection" />
                                    <HealthDot status={stats.authHealth} label="Sign-in" />
                                    <HealthDot status={stats.recordingHealth} label="Recordings" />
                                </div>
                            </section>

                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

function VerifiedAdminDashboard({ token }: { token: string }) {
    const [access, setAccess] = useState<'checking' | 'allowed' | 'denied' | 'unavailable'>('checking');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let active = true;
        fetch(`${AUTH_API}/api/auth/admin/access`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        }).then(response => {
            if (!active || getToken() !== token) return;
            if (response.status === 401) clearSession(token);
            setAccess(response.ok ? 'allowed' : response.status === 403 ? 'denied' : 'unavailable');
        }).catch(() => { if (active) setAccess('unavailable'); }).finally(() => clearTimeout(timeout));
        return () => { active = false; clearTimeout(timeout); controller.abort(); };
    }, [token, attempt]);
    if (access === 'allowed') return <AdminDashboard />;
    const title = access === 'checking'
        ? 'Checking administrator access'
        : access === 'denied'
            ? 'Administrator access is required'
            : 'We couldn’t verify administrator access';
    const message = access === 'checking'
        ? 'Please wait while we confirm this account.'
        : access === 'denied'
            ? 'This account does not have platform administrator access. Go to On-prem to check whether workspace access is enabled for your account.'
            : 'Your sign-in is still active, but the admin access check did not complete. Try again or open the On-prem page for workspace and app downloads.';
    return <main className="admin-dashboard admin-access-page">
        <section className="admin-access-panel" aria-labelledby="admin-access-title">
            <h1 id="admin-access-title">{title}</h1>
            <p role="status" aria-live="polite">{message}</p>
            <div className="admin-access-actions">
                <Link className="btn-primary" to="/intranet">Open On-prem</Link>
                {access === 'unavailable' && <button className="btn-secondary" type="button" onClick={() => { setAccess('checking'); setAttempt(value => value + 1); }}>Try again</button>}
                <Link className="admin-access-back" to="/app">Back to meetings</Link>
            </div>
        </section>
    </main>;
}

export default function AdminPage() {
    const session = useSession();
    const token = session.status === 'authenticated' ? getToken() : '';
    if (token) return <VerifiedAdminDashboard key={token} token={token} />;
    return <main className="admin-dashboard admin-access-page">
        <section className="admin-access-panel" aria-labelledby="admin-access-title">
            <h1 id="admin-access-title">{session.status === 'anonymous' ? 'Sign in to QS-VC' : 'Checking your account'}</h1>
            {session.status !== 'anonymous' && <p role="status" aria-live="polite">{session.status === 'unavailable' ? 'The account service is unavailable. Your saved session has not been removed.' : 'Please wait while we check your sign-in.'}</p>}
            {session.status === 'anonymous' && <p>Sign in with a platform administrator account to open the admin dashboard.</p>}
            <div className="admin-access-actions">
                {session.status === 'anonymous'
                    ? <Link className="btn-primary" to="/login?next=%2Fadmin">Sign in</Link>
                    : <Link className="btn-primary" to="/intranet">Open On-prem</Link>}
                <Link className="admin-access-back" to="/app">Back to meetings</Link>
            </div>
        </section>
    </main>;
}
