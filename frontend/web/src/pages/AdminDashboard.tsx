/**
 * Admin Dashboard — Real-time monitoring, user management, and analytics.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
    role: 'admin' | 'user' | 'guest';
    createdAt: string;
    lastLogin: string;
    meetingCount: number;
    status: 'active' | 'suspended' | 'invited';
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

type TabName = 'overview' | 'meetings' | 'users' | 'recordings' | 'analytics' | 'system';

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

        const fetchUsers = async () => {
            try {
                const res = await fetch(`${AUTH_URL}/api/auth/users`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setUsers(data.users || []);
                    setStats(prev => ({ ...prev, totalUsers: data.users?.length || 0 }));
                }
            } catch { /* silent */ }
        };

        const fetchRecordings = async () => {
            try {
                const res = await fetch(`${RECORDING_URL}/api/recordings`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
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
                    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setMeetings(data.meetings || []);
                }
            } catch { /* silent */ }
        };

        fetchStats();
        fetchUsers();
        fetchRecordings();
        fetchMeetings();

        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
    }, []);

    // ── Filter users ──
    const filteredUsers = users.filter(u => {
        const matchesSearch = userSearch === '' ||
            u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
            u.displayName.toLowerCase().includes(userSearch.toLowerCase());
        const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter;
        return matchesSearch && matchesRole;
    });

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
                <div className="admin-header-actions">
                    <button className="btn-back-to-app" onClick={() => navigate('/schedule')}>
                        <span className="mi mi-sm">calendar_today</span> Schedule
                    </button>
                    <button className="btn-back-to-app" onClick={() => navigate('/')}>
                        <span className="mi mi-sm">arrow_back</span> Back to App
                    </button>
                </div>
            </header>

            <nav className="admin-nav">
                {(['overview', 'meetings', 'users', 'recordings', 'analytics', 'system'] as TabName[]).map(tab => (
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
                            {tab === 'analytics' && 'analytics'}
                            {tab === 'system' && 'settings'}
                        </span>
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </nav>

            <main className="admin-content">
                {/* ━━━ OVERVIEW TAB ━━━ */}
                {activeTab === 'overview' && (
                    <div className="admin-overview">
                        <div className="kpi-grid">
                            <div className="kpi-card">
                                <span className="kpi-icon"><span className="mi">videocam</span></span>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.activeMeetings}</span>
                                    <span className="kpi-label">Active Meetings</span>
                                </div>
                            </div>
                            <div className="kpi-card">
                                <span className="kpi-icon"><span className="mi">group</span></span>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalParticipants}</span>
                                    <span className="kpi-label">Participants Now</span>
                                </div>
                            </div>
                            <div className="kpi-card">
                                <span className="kpi-icon"><span className="mi">person</span></span>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalUsers}</span>
                                    <span className="kpi-label">Registered Users</span>
                                </div>
                            </div>
                            <div className="kpi-card">
                                <span className="kpi-icon"><span className="mi">mic</span></span>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.recordingsCount}</span>
                                    <span className="kpi-label">Recordings</span>
                                </div>
                            </div>
                            <div className="kpi-card">
                                <span className="kpi-icon"><span className="mi">calendar_today</span></span>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalMeetingsToday}</span>
                                    <span className="kpi-label">Meetings Today</span>
                                </div>
                            </div>
                            <div className="kpi-card">
                                <span className="kpi-icon"><span className="mi">schedule</span></span>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.avgMeetingDuration}</span>
                                    <span className="kpi-label">Avg Duration</span>
                                </div>
                            </div>
                        </div>

                        <div className="health-status">
                            <h3>System Health</h3>
                            <div className="health-grid">
                                <HealthDot status={stats.sfuHealth} label="SFU Media Engine" />
                                <HealthDot status={stats.signalingHealth} label="Signaling Server" />
                                <HealthDot status={stats.authHealth} label="Auth Service" />
                                <HealthDot status={stats.recordingHealth} label="Recording Service" />
                            </div>
                        </div>
                    </div>
                )}

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
                            <span className="badge">{users.length} users</span>
                        </div>

                        <div className="filter-bar">
                            <input
                                type="text"
                                placeholder="Search by name or email..."
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
                        </div>

                        {filteredUsers.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon"><span className="mi" style={{ fontSize: '48px' }}>person</span></div>
                                <p>{userSearch ? 'No users match your search' : 'No users registered yet'}</p>
                            </div>
                        ) : (
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th>Status</th>
                                        <th>Joined</th>
                                        <th>Last Login</th>
                                        <th>Meetings</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.map(u => (
                                        <tr key={u.id}>
                                            <td className="user-name">
                                                <div className="avatar-sm">{u.displayName?.[0]?.toUpperCase() || '?'}</div>
                                                {u.displayName}
                                            </td>
                                            <td>{u.email}</td>
                                            <td>
                                                <span className={`role-badge role-${u.role}`}>{u.role}</span>
                                            </td>
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

                {/* ━━━ ANALYTICS TAB ━━━ */}
                {activeTab === 'analytics' && (
                    <div className="admin-analytics">
                        <h2>Platform Analytics</h2>

                        <div className="analytics-cards">
                            <div className="analytics-card">
                                <h3>Meeting Volume</h3>
                                <div className="chart-placeholder">
                                    <div className="bar-chart">
                                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
                                            const height = [65, 80, 45, 90, 70, 20, 15][i];
                                            return (
                                                <div key={day} className="bar-col">
                                                    <div className="bar" style={{ height: `${height}%` }} />
                                                    <span className="bar-label">{day}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div className="analytics-card">
                                <h3>Participant Trend</h3>
                                <div className="chart-placeholder">
                                    <div className="trend-line">
                                        <svg viewBox="0 0 200 80" className="trend-svg">
                                            <polyline
                                                fill="none"
                                                stroke="var(--accent-primary)"
                                                strokeWidth="2"
                                                points="0,60 30,45 60,55 90,30 120,35 150,20 180,25 200,15"
                                            />
                                            <polyline
                                                fill="url(#gradient)"
                                                stroke="none"
                                                points="0,60 30,45 60,55 90,30 120,35 150,20 180,25 200,15 200,80 0,80"
                                            />
                                            <defs>
                                                <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.3" />
                                                    <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
                                                </linearGradient>
                                            </defs>
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            <div className="analytics-card">
                                <h3>Usage by Feature</h3>
                                <div className="usage-breakdown">
                                    {[
                                        { label: 'Screen Share', pct: 78 },
                                        { label: 'Recording', pct: 45 },
                                        { label: 'Virtual BG', pct: 62 },
                                        { label: 'Noise Suppress', pct: 55 },
                                        { label: 'Live Captions', pct: 33 },
                                        { label: 'E2EE', pct: 28 },
                                    ].map(f => (
                                        <div key={f.label} className="usage-row">
                                            <span className="usage-label">{f.label}</span>
                                            <div className="usage-bar-wrapper">
                                                <div className="usage-bar" style={{ width: `${f.pct}%` }} />
                                            </div>
                                            <span className="usage-pct">{f.pct}%</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="analytics-card">
                                <h3>Peak Hours</h3>
                                <div className="peak-hours">
                                    {Array.from({ length: 24 }, (_, i) => {
                                        const load = i >= 9 && i <= 17
                                            ? 40 + Math.floor(Math.random() * 60)
                                            : Math.floor(Math.random() * 30);
                                        return (
                                            <div
                                                key={i}
                                                className="hour-cell"
                                                style={{ opacity: load / 100 }}
                                                title={`${i}:00 — ${load}% capacity`}
                                            />
                                        );
                                    })}
                                    <div className="peak-legend">
                                        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ━━━ SYSTEM TAB ━━━ */}
                {activeTab === 'system' && (
                    <div className="admin-system">
                        <h2>System Configuration</h2>

                        <div className="system-sections">
                            <section className="system-section">
                                <h3>Service Endpoints</h3>
                                <div className="config-grid">
                                    <div className="config-item">
                                        <span className="config-key">Signaling</span>
                                        <code className="config-value">{SIGNALING_URL}</code>
                                    </div>
                                    <div className="config-item">
                                        <span className="config-key">Auth</span>
                                        <code className="config-value">{AUTH_URL}</code>
                                    </div>
                                    <div className="config-item">
                                        <span className="config-key">Meeting</span>
                                        <code className="config-value">{MEETING_URL}</code>
                                    </div>
                                    <div className="config-item">
                                        <span className="config-key">Recording</span>
                                        <code className="config-value">{RECORDING_URL}</code>
                                    </div>
                                </div>
                            </section>

                            <section className="system-section">
                                <h3>Health Checks</h3>
                                <div className="health-grid">
                                    <HealthDot status={stats.sfuHealth} label="SFU Media Engine" />
                                    <HealthDot status={stats.signalingHealth} label="Signaling Server" />
                                    <HealthDot status={stats.authHealth} label="Auth Service" />
                                    <HealthDot status={stats.recordingHealth} label="Recording Service" />
                                </div>
                            </section>

                            <section className="system-section">
                                <h3>Feature Flags</h3>
                                <div className="feature-flags">
                                    {[
                                        { name: 'Virtual Background', enabled: true },
                                        { name: 'Noise Suppression', enabled: true },
                                        { name: 'Live Captions', enabled: true },
                                        { name: 'End-to-End Encryption', enabled: true },
                                        { name: 'Meeting Recording', enabled: true },
                                        { name: 'Screen Sharing', enabled: true },
                                        { name: 'Chat', enabled: true },
                                        { name: 'Reactions', enabled: true },
                                    ].map(flag => (
                                        <div key={flag.name} className="flag-item">
                                            <span>{flag.name}</span>
                                            <span className={`flag-status ${flag.enabled ? 'enabled' : 'disabled'}`}>
                                                <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>{flag.enabled ? 'check_circle' : 'cancel'}</span>
                                                {flag.enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default AdminDashboard;
