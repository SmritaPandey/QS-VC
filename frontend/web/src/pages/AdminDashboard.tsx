import OrganisationBranding from '../components/OrganisationBranding';
import AdminMeetingControls from '../components/AdminMeetingControls';
import DownloadLeads from '../components/DownloadLeads';
import AdminAnalytics from '../components/AdminAnalytics';
import AnimatedNumber from '../components/AnimatedNumber';
import ThemeSelect from '../components/ThemeSelect';
import { AUTH_API, clearSession, getToken } from '../lib/session';
import { useSession } from '../lib/use-session';
import EnterpriseAccessTerms from '../components/EnterpriseAccessTerms';
/**
 * Admin Dashboard — Real-time monitoring, user management, and analytics.
 */
import { useState, useEffect } from 'react';
import BrandLogo from '../components/BrandLogo';
import '../styles/admin-workspace.css';
import { Link, useNavigate } from 'react-router-dom';

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

type TabName = 'overview' | 'meetings' | 'users' | 'recordings' | 'leads' | 'system';
type DeploymentMode = 'hosted-online' | 'onprem-intranet' | 'onprem-online';
type AdminDeployment = {
    mode: DeploymentMode;
    publicMeetingOrigin: string | null;
    ssoConfigured: boolean;
    localAiEnabled: boolean;
    canIssueLicense: boolean;
};
const deploymentLabels: Record<DeploymentMode, string> = {
    'hosted-online': 'Online website',
    'onprem-intranet': 'On-prem intranet',
    'onprem-online': 'On-prem online',
};
const tabs: { id: TabName; label: string; icon: string }[] = [
    { id:'overview', label:'Overview', icon:'dashboard' },
    { id:'meetings', label:'Conference Control', icon:'videocam' },
    { id:'users', label:'Accounts', icon:'group' },
    { id:'recordings', label:'Recordings', icon:'video_library' },
    { id:'leads', label:'Download leads', icon:'contact_mail' },
    { id:'system', label:'Deployment settings', icon:'settings' },
];

function isAdminDeployment(value: AdminDeployment | undefined): value is AdminDeployment {
    return Boolean(value && Object.prototype.hasOwnProperty.call(deploymentLabels, value.mode) &&
        typeof value.ssoConfigured === 'boolean' && typeof value.localAiEnabled === 'boolean' &&
        typeof value.canIssueLicense === 'boolean' &&
        (value.publicMeetingOrigin === null || typeof value.publicMeetingOrigin === 'string'));
}

function AdminDashboard({ deployment }: { deployment: AdminDeployment }) {
    const navigate = useNavigate();
    const hosted = deployment.mode === 'hosted-online';
    const internetOnPrem = deployment.mode === 'onprem-online';
    const label = deploymentLabels[deployment.mode];
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [totalUsers, setTotalUsers] = useState<number | null>(null);
    const [recordingCode, setRecordingCode] = useState('');
    const [publicCode, setPublicCode] = useState('');
    const [activeTab, setActiveTab] = useState<TabName>('overview');
    const [userSearch, setUserSearch] = useState('');
    const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
    const [userPlanFilter, setUserPlanFilter] = useState<string>('all');
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [userPage, setUserPage] = useState(0);
    const [usersTotal, setUsersTotal] = useState(0);
    const [planCounts, setPlanCounts] = useState<Record<string, number>>({});
    const [userDirectoryError, setUserDirectoryError] = useState('');
    const [userDirectoryLoading, setUserDirectoryLoading] = useState(false);
    const [directoryAttempt, setDirectoryAttempt] = useState(0);

    useEffect(() => {
        const timer = window.setTimeout(() => { setUserSearchQuery(userSearch); setUserPage(0); }, 250);
        return () => window.clearTimeout(timer);
    }, [userSearch]);

    useEffect(() => {
        if (activeTab !== 'users') return;
        const controller = new AbortController();
        const token = getToken();
        setUserDirectoryLoading(true);
        setUserDirectoryError('');
        const query = new URLSearchParams({
            limit: String(USER_PAGE_SIZE), offset: String(userPage * USER_PAGE_SIZE),
            search: userSearchQuery, role: userRoleFilter,
        });
        if (userPlanFilter !== 'all') query.set('plan', userPlanFilter);
        fetch(`${AUTH_API}/api/auth/admin/users?${query}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        }).then(async response => {
            if (response.status === 401) clearSession(token);
            if (!response.ok) throw new Error('The admin account directory is unavailable.');
            return await response.json() as UserDirectory;
        }).then(data => {
            if (controller.signal.aborted || getToken() !== token) return;
            setUsers(data.users || []);
            setUsersTotal(data.total || 0);
            setPlanCounts(data.planCounts || {});
            setTotalUsers(data.totalUsers || 0);
            setUserDirectoryError('');
        }).catch(() => {
            if (controller.signal.aborted) return;
            setUserDirectoryError('The account directory is unavailable.');
        }).finally(() => { if (!controller.signal.aborted) setUserDirectoryLoading(false); });
        return () => controller.abort();
    }, [activeTab, directoryAttempt, userPage, userPlanFilter, userRoleFilter, userSearchQuery]);

    return (
        <div className="admin-dashboard admin-workspace" data-profile={deployment.mode}>
            <aside className="admin-workspace-rail">
            <Link to="/app" className="admin-logo" aria-label="QS-VC meetings"><BrandLogo /></Link>
                <nav className="admin-nav" aria-label="Admin sections">
                    {tabs.filter(tab => hosted || tab.id !== 'leads').map(tab => (
                        <button key={tab.id} type="button" aria-current={activeTab === tab.id ? 'page' : undefined}
                            aria-label={tab.label} title={tab.label}
                            className={`admin-nav-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                            <span className="mi mi-sm" aria-hidden="true">{tab.icon}</span><span className="admin-nav-label">{tab.label}</span>
                        </button>
                    ))}
                </nav>
            </aside>
            <div className="admin-workspace-body">
                <header className="admin-header">
                    <div className="admin-workspace-title">
                        <h1>{activeTab === 'overview' ? 'Admin overview' : tabs.find(tab => tab.id === activeTab)?.label}</h1>
                        <span className="admin-deployment-label">{label}</span>
                    </div>
                    <div className="admin-header-actions">
                        <ThemeSelect />
                        <Link className="btn-back-to-app" to="/schedule">Schedule</Link>
                        <Link className="btn-back-to-app" to="/app">Meetings workspace</Link>
                    </div>
                </header>

                <main className="admin-content" id="admin-workspace-content">
                {hosted && activeTab === 'leads' && <DownloadLeads />}
                {activeTab === 'users' && <EnterpriseAccessTerms canIssueLicense={hosted && deployment.canIssueLicense} />}
                {activeTab === 'overview' && <AdminAnalytics hosted={hosted} onManageAccess={() => setActiveTab('users')} />}

                {/* ━━━ MEETINGS TAB ━━━ */}
                {activeTab === 'meetings' && <AdminMeetingControls />}

                {/* ━━━ USERS TAB ━━━ */}
                {activeTab === 'users' && (
                    <div className="admin-users">
                        <div className="tab-header">
                            <h2>Account directory</h2>
                            <span className="badge">{totalUsers === null ? 'Account count unavailable' : <><AnimatedNumber value={totalUsers} /> total users</>}</span>
                        </div>

                        <div className="admin-user-plan-summary" aria-label="Users by plan">
                            {Object.entries(userPlanLabels).map(([key, label]) => <article key={key}>
                                <span>{label}</span><strong><AnimatedNumber value={planCounts[key] || 0} /></strong>
                            </article>)}
                        </div>

                        <div className="filter-bar admin-account-filters">
                            <input
                                type="text"
                                aria-label="Search accounts"
                                placeholder="Search accounts"
                                value={userSearch}
                                onChange={e => setUserSearch(e.target.value)}
                                className="form-input search-input"
                            />
                            <select
                                value={userRoleFilter}
                                aria-label="Filter by role"
                                onChange={e => { setUserRoleFilter(e.target.value); setUserPage(0); }}
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

                        {userDirectoryError && <p role="alert">{userDirectoryError} <button type="button" onClick={() => setDirectoryAttempt(attempt => attempt + 1)}>Retry</button></p>}
                        {userDirectoryLoading && <p role="status">Loading accounts…</p>}

                        {!userDirectoryError && !userDirectoryLoading && (users.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon"><span className="mi" style={{ fontSize: '48px' }}>person</span></div>
                                <p>{userSearch || userPlanFilter !== 'all' || userRoleFilter !== 'all' ? 'No users match these filters' : 'No users registered yet'}</p>
                            </div>
                        ) : (
                            <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Account directory"><table className="admin-table admin-account-table">
                                <thead>
                                    <tr>
                                        <th scope="col">Name</th>
                                        <th scope="col">Email</th>
                                        <th scope="col">Mobile</th>
                                        <th scope="col">Role</th>
                                        <th scope="col">Plan</th>
                                        {hosted && <th scope="col">Payment</th>}
                                        <th scope="col">Status</th>
                                        <th scope="col">Joined</th>
                                        <th scope="col">Last Login</th>
                                        <th scope="col" className="admin-account-count">Meetings</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id}>
                                            <td className="admin-account-name">
                                                <div className="user-name">
                                                    <span className="avatar-sm" aria-hidden="true">{u.displayName?.[0]?.toUpperCase() || '?'}</span>
                                                    <span>{u.displayName}</span>
                                                </div>
                                            </td>
                                            <td className="admin-account-email">{u.email}</td>
                                            <td className="admin-account-compact">{u.phoneNumber || '—'}</td>
                                            <td>
                                                <span className={`role-badge role-${u.role}`}>{u.role}</span>
                                            </td>
                                            <td><strong>{userPlanLabels[u.plan] || u.plan}</strong><br /><small>{u.planStatus?.replace(/_/g, ' ') || '—'}</small></td>
                                            {hosted && <td>{u.billingProvider ? <><span>{{ razorpay: 'Razorpay', paypal: 'PayPal', cashfree: 'Cashfree' }[u.billingProvider]} · {u.billingStatus || 'pending'}</span>{u.billingAmount && u.billingCurrency ? <><br /><small>{formatBillingAmount(u.billingAmount, u.billingCurrency)}</small></> : null}{u.subscriptionEndsAt && <><br /><small>Access through {new Date(u.subscriptionEndsAt).toLocaleDateString()}</small></>}</> : '—'}</td>}
                                            <td>
                                                <span className={`status-badge status-${u.status}`}>{u.status}</span>
                                            </td>
                                            <td className="admin-account-compact">{new Date(u.createdAt).toLocaleDateString()}</td>
                                            <td className="admin-account-compact">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                                            <td className="admin-account-count">{u.meetingCount.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        ))}
                        <div className="admin-user-pagination">
                            <span>{usersTotal ? <>Showing <AnimatedNumber value={userPage * USER_PAGE_SIZE + 1} />–<AnimatedNumber value={Math.min((userPage + 1) * USER_PAGE_SIZE, usersTotal)} /> of <AnimatedNumber value={usersTotal} /></> : <><AnimatedNumber value={0} /> matching users</>}</span>
                            <div><button type="button" className="btn-sm" disabled={userPage === 0} onClick={() => setUserPage(page => Math.max(0, page - 1))}>Previous</button>
                                <button type="button" className="btn-sm" disabled={(userPage + 1) * USER_PAGE_SIZE >= usersTotal} onClick={() => setUserPage(page => page + 1)}>Next</button></div>
                        </div>
                    </div>
                )}

                {activeTab === 'recordings' && <section className="admin-deployment-panel" aria-labelledby="admin-recordings-title">
                    <header><h2 id="admin-recordings-title">Find a meeting recording</h2>
                        <p>Use the meeting code to open the recording library. Playback requires the meeting owner’s access.</p></header>
                    <form className="admin-workspace-links" onSubmit={event => {
                        event.preventDefault();
                        const code = recordingCode.trim();
                        if (code) navigate(`/recordings/${encodeURIComponent(code)}`);
                    }}>
                        <label>Meeting code <input className="form-input" required value={recordingCode} onChange={event => setRecordingCode(event.target.value)} /></label>
                        <button type="submit" className="btn-sm" disabled={!recordingCode.trim()}>Open recordings</button>
                    </form>
                </section>}

                {activeTab === 'system' && <div className="admin-system">
                    <section className="admin-deployment-panel" aria-labelledby="admin-deployment-title">
                        <header><h2 id="admin-deployment-title">{label}</h2><p>{hosted
                            ? 'Manage accounts and commercial activity for the hosted website.'
                            : internetOnPrem ? 'Manage this self-hosted installation and check its public meeting entry point.'
                                : 'Manage meetings and accounts on this private installation.'}</p></header>
                        <dl>
                            <div><dt>Meeting access</dt><dd>{hosted ? 'Hosted website' : internetOnPrem ? 'Public HTTPS gateway' : 'Private workspace'}</dd></div>
                            <div><dt>Single sign-on</dt><dd>{deployment.ssoConfigured ? 'Configured' : 'Off'}</dd></div>
                            {hosted ? <div><dt>License issuance</dt><dd>{deployment.canIssueLicense ? 'Signing configured' : 'Signing unavailable'}</dd></div>
                                : <div><dt>Local AI gateway</dt><dd>{deployment.localAiEnabled ? 'Enabled' : 'Off'}</dd></div>}
                            {internetOnPrem && <div><dt>Public meeting origin</dt><dd>{deployment.publicMeetingOrigin || 'HTTPS origin needs configuration'}</dd></div>}
                        </dl>
                        <div className="admin-workspace-links">
                            {internetOnPrem && deployment.publicMeetingOrigin && <a href={deployment.publicMeetingOrigin + '/app'} target="_blank" rel="noopener noreferrer">Open public workspace</a>}
                            {deployment.mode === 'onprem-intranet' && <Link to="/app">Open private workspace</Link>}
                            {hosted && <button type="button" onClick={() => setActiveTab('leads')}>Review download leads</button>}
                            {!hosted && <button type="button" onClick={() => setActiveTab('users')}>Manage access terms</button>}
                            <button type="button" onClick={() => setActiveTab('meetings')}>Check live meetings</button>
                        </div>
                    </section>
                    <aside className="admin-deployment-panel admin-profile-guidance" aria-labelledby="admin-profile-guidance-title">
                        <header><h2 id="admin-profile-guidance-title">Changing this deployment</h2>
                            <p>The current profile comes from the installed server configuration. It cannot be switched safely from this dashboard.</p></header>
                        {hosted ? <p>The hosted website is operated as a separate service. To move this organisation to an on-premises edition, provision an on-prem installation and migrate its data with the platform operator.</p>
                            : <><p>To make an on-prem installation public, the platform operator must configure public HTTPS, DNS, certificates, proxy and firewall rules, then set <code>QSVC_ONPREM_EXPOSURE=public</code> and a valid <code>QSVC_PUBLIC_MEETING_ORIGIN</code> before restarting the services. Leave the exposure private for intranet use.</p>
                                <p>The offline intranet profile is available only through the signed offline Enterprise package. It stays private and must be changed through an approved package/configuration update.</p></>}
                    </aside>
                    {internetOnPrem && deployment.publicMeetingOrigin && <section className="admin-deployment-panel" aria-labelledby="public-meeting-link">
                        <header><h2 id="public-meeting-link">Public meeting preview</h2>
                            <p>Open a meeting code through the configured gateway. On-prem sign-in and meeting admission still apply.</p></header>
                        <form className="admin-workspace-links" action={deployment.publicMeetingOrigin + '/app'} onSubmit={event => {
                            event.preventDefault();
                            const code = publicCode.trim();
                            if (code) window.open(deployment.publicMeetingOrigin + '/meeting/' + encodeURIComponent(code) + '/preview', '_blank', 'noopener,noreferrer');
                        }}>
                            <label>Meeting code <input className="form-input" required value={publicCode} onChange={event => setPublicCode(event.target.value)} /></label>
                            <button type="submit" disabled={!publicCode.trim()}>Open meeting preview</button>
                        </form>
                    </section>}
                    <div className="system-sections">
                        <OrganisationBranding />
                    </div>
                </div>}
                </main>
            </div>
        </div>
    );
};

function VerifiedAdminDashboard({ token }: { token: string }) {
    const [access, setAccess] = useState<'checking' | 'allowed' | 'denied' | 'unavailable'>('checking');
    const [deployment, setDeployment] = useState<AdminDeployment | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let active = true;
        fetch(`${AUTH_API}/api/auth/admin/access`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        }).then(async response => {
            if (!active || getToken() !== token) return;
            if (response.status === 401) clearSession(token);
            if (!response.ok) { setAccess(response.status === 403 ? 'denied' : 'unavailable'); return; }
            const payload = await response.json();
            if (!active || getToken() !== token) return;
            if (!isAdminDeployment(payload.deployment)) { setAccess('unavailable'); return; }
            setDeployment(payload.deployment);
            setAccess('allowed');
        }).catch(() => { if (active) setAccess('unavailable'); }).finally(() => clearTimeout(timeout));
        return () => { active = false; clearTimeout(timeout); controller.abort(); };
    }, [token, attempt]);
    if (access === 'allowed' && deployment) return <AdminDashboard deployment={deployment} />;
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
