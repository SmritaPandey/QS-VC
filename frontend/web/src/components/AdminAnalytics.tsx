import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AUTH_API, clearSession, getToken } from '../lib/session';
import '../styles/admin-analytics.css';

type Quarter = {
    quarter: string;
    meetingsCreated: number;
    accessTermsUpdated: number;
    installerDownloads: number;
    desktopAppActivations: number;
    financials: Array<{ currency: string; revenue: string; expenses: string; net: string }>;
};
type MoneyTotal = { currency: string; revenue: string; expenses: string; net: string };
type FinanceEntry = {
    id: string;
    type: 'revenue' | 'expense';
    category: string;
    amount: string;
    currency: string;
    description: string;
    occurredOn: string;
    createdAt: string;
    recordedBy: string;
};
type Analytics = {
    generatedAt: string;
    totals: {
        organisations: number;
        activeOrganisations: number;
        activeUsers: number;
        meetingsCreated: number;
        scheduledMeetings: number;
        activeMeetingRecords: number;
        endedMeetings: number;
        cancelledMeetings: number;
        recurringMeetingRecords: number;
        webinars: number;
        enterpriseAccessSeats: number;
        activeEnterpriseAccessSeats: number;
        installerDownloads: number;
        desktopAppActivations: number;
    };
    plans: Array<{ plan: string; organisations: number; activeOrganisations: number }>;
    meetingStatuses: Array<{ status: string; count: number }>;
    installerDownloadsByPlatform: Record<string, number>;
    desktopActivationsByPlatform: Array<{ platform: string; architecture: string; count: number }>;
    quarters: Quarter[];
    financialTotalsByCurrency: MoneyTotal[];
    recentFinancialEntries: FinanceEntry[];
};

const colors = ['#007879', '#4955a2', '#a75921', '#786887', '#527177', '#a23b53'];
const platformNames: Record<string, string> = {
    windows: 'Windows', 'macos-arm64': 'Mac · Apple silicon', 'macos-x64': 'Mac · Intel',
    win32: 'Windows', darwin: 'Mac', x64: 'Intel / x64', arm64: 'Apple silicon / ARM64',
};
const statusNames: Record<string, string> = {
    waiting: 'Waiting', scheduled: 'Scheduled', active: 'Marked active', ended: 'Ended',
    cancelled: 'Cancelled', completed: 'Completed',
};
const format = (value: number) => value.toLocaleString();
const currencyOptions = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'CAD', 'AUD'];

function money(value: string, currency: string) {
    const numeric = Number(value);
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(numeric);
    } catch {
        return `${currency} ${Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}`;
    }
}

function Counter({ value }: { value: number }) {
    const [display, setDisplay] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0);
    useEffect(() => {
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (preference.matches || !value) { setDisplay(value); return; }
        let frame: number;
        const start = performance.now();
        const tick = (now: number) => {
            const progress = Math.min((now - start) / 500, 1);
            setDisplay(Math.round(value * (1 - (1 - progress) ** 3)));
            if (progress < 1) frame = requestAnimationFrame(tick);
        };
        const stop = () => { cancelAnimationFrame(frame); setDisplay(value); };
        frame = requestAnimationFrame(tick);
        preference.addEventListener('change', stop);
        return () => { cancelAnimationFrame(frame); preference.removeEventListener('change', stop); };
    }, [value]);
    return <><span className="admin-analytics-sr">{format(value)}</span><span aria-hidden="true">{format(display)}</span></>;
}

type ActivityMetric = 'meetingsCreated' | 'installerDownloads' | 'desktopAppActivations' | 'accessTermsUpdated';
const activityNames: Record<ActivityMetric, string> = {
    meetingsCreated: 'Meetings created',
    installerDownloads: 'Completed installer transfers',
    desktopAppActivations: 'Desktop app activations',
    accessTermsUpdated: 'Access terms last updated',
};

export default function AdminAnalytics({ onManageAccess }: { onManageAccess?: () => void }) {
    const [quarters, setQuarters] = useState(4);
    const [activityMetric, setActivityMetric] = useState<ActivityMetric>('meetingsCreated');
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState<Analytics | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [ledgerMessage, setLedgerMessage] = useState('');
    const [ledgerError, setLedgerError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        const token = getToken();
        let active = true;
        setData(null); setError('');
        fetch(`${AUTH_API}/api/auth/admin/analytics?quarters=${quarters}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        }).then(async response => {
            if (!active || token !== getToken()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (!response.ok) throw new Error();
            const result = await response.json() as Analytics;
            if (!result.totals || !Array.isArray(result.quarters) || !Array.isArray(result.plans)) throw new Error();
            if (active && token === getToken()) setData(result);
        }).catch(() => {
            if (active && token === getToken()) setError('Could not load global platform analytics. Try again.');
        }).finally(() => window.clearTimeout(timeout));
        return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
    }, [quarters, attempt]);

    useEffect(() => {
        const timer = window.setInterval(() => setAttempt(value => value + 1), 60000);
        return () => window.clearInterval(timer);
    }, []);

    async function addFinancialEntry(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving) return;
        const form = event.currentTarget;
        const fields = new FormData(form);
        const token = getToken();
        setSaving(true); setLedgerMessage(''); setLedgerError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/admin/financial-entries`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: fields.get('type'), category: fields.get('category'), amount: fields.get('amount'),
                    currency: fields.get('currency'), occurredOn: fields.get('occurredOn'), description: fields.get('description'),
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (getToken() !== token) return;
            if (response.status === 401) { clearSession(token); return; }
            if (!response.ok) {
                const body = await response.json().catch(() => null) as { error?: unknown } | null;
                throw new Error(typeof body?.error === 'string' ? body.error : 'The financial entry could not be saved. Try again.');
            }
            form.reset();
            setLedgerMessage('Entry saved for all platform admins.');
            setAttempt(value => value + 1);
        } catch (reason) {
            if (getToken() === token) setLedgerError(reason instanceof Error ? reason.message : 'The financial entry could not be saved.');
        } finally { setSaving(false); }
    }

    const max = Math.max(1, ...(data?.quarters.map(item => item[activityMetric]) ?? []));
    const statusTotal = data?.meetingStatuses.reduce((sum, item) => sum + item.count, 0) ?? 0;
    let offset = 0;
    const segments = data?.meetingStatuses.map(({ count }, index) => {
        const start = offset;
        offset += statusTotal ? count / statusTotal * 100 : 0;
        return `${colors[index % colors.length]} ${start}% ${offset}%`;
    });
    const today = new Date().toISOString().slice(0, 10);

    return <section className="admin-analytics" aria-labelledby="admin-analytics-title">
        <header className="admin-analytics-header">
            <div><p className="admin-analytics-kicker">Platform admin overview</p><h1 id="admin-analytics-title">Global activity and finances</h1>
                <p>Shared across platform admins using this deployment’s database. Calendar quarters use UTC.</p></div>
            <div className="admin-analytics-controls">
                <label>Reporting period <select value={quarters} onChange={event => setQuarters(Number(event.target.value))}>
                    <option value={4}>Last 4 quarters</option><option value={8}>Last 8 quarters</option><option value={12}>Last 12 quarters</option>
                </select></label>
                <button type="button" onClick={() => setAttempt(value => value + 1)}>Refresh</button>
            </div>
        </header>
        {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>
            : !data ? <p role="status">Loading shared platform analytics…</p> : <>
                <p className="admin-analytics-updated" role="status">Updated {new Date(data.generatedAt).toLocaleString()}</p>
                <dl className="admin-analytics-counters" aria-label="Global database totals">
                    <div><dt>Active organisations</dt><dd><Counter value={data.totals.activeOrganisations} /></dd></div>
                    <div><dt>Active user accounts</dt><dd><Counter value={data.totals.activeUsers} /></dd></div>
                    <div><dt>Meeting records created</dt><dd><Counter value={data.totals.meetingsCreated} /></dd></div>
                    <div><dt>Active enterprise access seats</dt><dd><Counter value={data.totals.activeEnterpriseAccessSeats} /></dd></div>
                    <div><dt>Desktop app activations</dt><dd><Counter value={data.totals.desktopAppActivations} /></dd></div>
                </dl>
                <div className="admin-analytics-panels">
                    <section aria-labelledby="admin-activity-title"><div className="admin-analytics-section-head"><h2 id="admin-activity-title">Activity by quarter</h2>
                        <label>Count <select value={activityMetric} onChange={event => setActivityMetric(event.target.value as ActivityMetric)}>
                            {Object.entries(activityNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                        </select></label></div>
                        <p>Counts follow UTC calendar quarters.</p>
                        <ul className="admin-analytics-bars">{data.quarters.map(item => <li key={item.quarter}>
                            <div className="admin-analytics-bar-row"><span>{item.quarter}</span><span className="admin-analytics-track" aria-hidden="true"><i style={{ width: `${item[activityMetric] / max * 100}%` }} /></span><strong>{format(item[activityMetric])}</strong></div>
                        </li>)}</ul>
                    </section>
                    <section aria-labelledby="admin-status-title"><h2 id="admin-status-title">Meeting record status</h2>
                        <p>Stored meeting states, not live SFU presence.</p>
                        {statusTotal > 0 ? <div className="admin-analytics-breakdown">
                            <div className="admin-analytics-donut" aria-hidden="true" style={{ background: `conic-gradient(${segments?.join(',')})` }} />
                            <ul>{data.meetingStatuses.map((item, index) => <li key={item.status}>
                                <span className="admin-analytics-dot" aria-hidden="true" style={{ backgroundColor: colors[index % colors.length] }} />
                                <span>{Object.prototype.hasOwnProperty.call(statusNames, item.status) ? statusNames[item.status] : item.status}</span><strong>{format(item.count)}</strong>
                            </li>)}</ul>
                        </div> : <p>No meeting records yet.</p>}
                        <dl className="admin-analytics-mini-totals">
                            <div><dt>Scheduled records</dt><dd>{format(data.totals.scheduledMeetings)}</dd></div>
                            <div><dt>Recurring records</dt><dd>{format(data.totals.recurringMeetingRecords)}</dd></div>
                            <div><dt>Webinar records</dt><dd>{format(data.totals.webinars)}</dd></div>
                        </dl>
                    </section>
                </div>
                <div className="admin-analytics-panels">
                    <section aria-labelledby="admin-plans-title"><h2 id="admin-plans-title">Assigned plans by organisation</h2>
                        <p>Plan assignment is not proof of a paid subscription.</p>
                        {data.plans.length ? <ul className="admin-analytics-plan-list">{data.plans.map((item, index) => <li key={item.plan}>
                            <span className="admin-analytics-dot" aria-hidden="true" style={{ backgroundColor: colors[index % colors.length] }} />
                            <span>{item.plan}</span><strong>{format(item.organisations)}</strong><small>{format(item.activeOrganisations)} active</small>
                        </li>)}</ul> : <p>No plans are assigned.</p>}
                        <p>Enterprise access: {format(data.totals.activeEnterpriseAccessSeats)} active of {format(data.totals.enterpriseAccessSeats)} dated user seats.</p>
                        <div className="admin-analytics-links"><Link to="/pricing">View plan catalogue</Link>
                            {onManageAccess && <button type="button" onClick={onManageAccess}>Manage access terms</button>}</div>
                    </section>
                    <section aria-labelledby="admin-installer-title"><h2 id="admin-installer-title">Completed installer transfers</h2>
                        <p>A completed response does not confirm that a file was saved or installed.</p>
                        <ul className="admin-analytics-platform-list">{Object.entries(platformNames).filter(([key]) => key in data.installerDownloadsByPlatform).map(([key, name]) => <li key={key}><span>{name}</span><strong>{format(data.installerDownloadsByPlatform[key] || 0)}</strong></li>)}</ul>
                        <h3>Desktop app activations</h3><p>One first sign-in report per local app profile and workspace. Clearing app data or reinstalling may count again; no account or device ID is stored in the activation record.</p>
                        <ul className="admin-analytics-platform-list">{data.desktopActivationsByPlatform.map(item => <li key={`${item.platform}-${item.architecture}`}><span>{platformNames[item.platform] || item.platform} · {platformNames[item.architecture] || item.architecture}</span><strong>{format(item.count)}</strong></li>)}</ul>
                    </section>
                </div>
                <section className="admin-analytics-finance" aria-labelledby="admin-finance-title">
                    <header><div><h2 id="admin-finance-title">Admin-recorded financial ledger</h2>
                        <p>Entries are shared among platform admins. Totals are not connected to or reconciled with a payment provider or accounting system. Net is revenue minus expenses; currencies are never combined.</p></div></header>
                    {data.financialTotalsByCurrency.length ? <div className="admin-analytics-finance-totals">{data.financialTotalsByCurrency.map(item => <section key={item.currency}>
                        <h3>{item.currency}</h3><dl><div><dt>Revenue</dt><dd>{money(item.revenue, item.currency)}</dd></div><div><dt>Expenses</dt><dd>{money(item.expenses, item.currency)}</dd></div><div><dt>Recorded net</dt><dd>{money(item.net, item.currency)}</dd></div></dl>
                    </section>)}</div> : <p>No financial entries recorded yet.</p>}
                    <h3>Quarterly totals</h3>
                    {data.quarters.some(item => item.financials.length) ? <ul className="admin-analytics-quarter-finance">{data.quarters.flatMap(item => item.financials.map(finance => <li key={`${item.quarter}-${finance.currency}`}>
                        <span>{item.quarter} · {finance.currency}</span><span>Revenue {money(finance.revenue, finance.currency)}</span><span>Expenses {money(finance.expenses, finance.currency)}</span><strong>Net {money(finance.net, finance.currency)}</strong>
                    </li>))}</ul> : <p>No financial entries in the selected quarters.</p>}
                    <div className="admin-analytics-ledger-grid">
                        <form className="admin-analytics-entry-form" onSubmit={addFinancialEntry}>
                            <h3>Record a revenue or expense</h3>
                            <p>Entries cannot be edited or deleted. Correct an entry with a new opposite-direction entry and explain it in the description.</p>
                            <label>Entry type<select name="type" required defaultValue="revenue"><option value="revenue">Revenue</option><option value="expense">Expense</option></select></label>
                            <label>Category<input name="category" required maxLength={80} placeholder="Subscription, hosting, support…" /></label>
                            <div className="admin-analytics-form-row"><label>Amount<input name="amount" required inputMode="decimal" type="number" min="0.01" step="0.01" /></label>
                                <label>Currency<select name="currency" defaultValue="INR">{currencyOptions.map(code => <option key={code} value={code}>{code}</option>)}</select></label></div>
                            <label>Transaction date<input name="occurredOn" type="date" required defaultValue={today} /></label>
                            <label>Description<input name="description" required maxLength={500} placeholder="Invoice, receipt or adjustment reference" /></label>
                            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save shared ledger entry'}</button>
                            {ledgerMessage && <p role="status">{ledgerMessage}</p>}{ledgerError && <p role="alert">{ledgerError}</p>}
                        </form>
                        <section aria-labelledby="admin-ledger-recent-title"><h3 id="admin-ledger-recent-title">Recent entries</h3>
                            {data.recentFinancialEntries.length ? <ul className="admin-analytics-recent-entries">{data.recentFinancialEntries.map(item => <li key={item.id}>
                                <div><span>{item.type === 'revenue' ? 'Revenue' : 'Expense'} · {item.category}</span><strong>{money(item.amount, item.currency)}</strong></div>
                                <p>{item.description}</p><small>{new Date(`${item.occurredOn}T00:00:00`).toLocaleDateString()} · Recorded by {item.recordedBy}</small>
                            </li>)}</ul> : <p>No entries have been recorded.</p>}
                        </section>
                    </div>
                </section>
            </>}
    </section>;
}
