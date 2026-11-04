import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUTH_API, clearSession, getToken } from '../lib/session';
import '../styles/admin-analytics.css';

const meetingApi = (import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '').replace(/\/api\/meetings$/, '');
const colors = ['#007879', '#4955a2', '#a75921', '#786887', '#527177'];

type Plan = { name: string; plan: string; maxParticipants: number; maxDurationMinutes: number; storageQuotaGb: number };

type Analytics = {
    totals: { links: number; scheduled: number; active: number };
    statuses: { status: string; count: number }[];
    quarters: { quarter: string; count: number }[];
};

const statusNames: Record<string, string> = {
    waiting: 'Waiting', scheduled: 'Scheduled', active: 'In progress', ended: 'Ended',
    cancelled: 'Cancelled', completed: 'Completed',
};
const format = (count: number) => count.toLocaleString();

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
        const stop = () => {
            cancelAnimationFrame(frame);
            setDisplay(value);
        };
        frame = requestAnimationFrame(tick);
        preference.addEventListener('change', stop);
        return () => { cancelAnimationFrame(frame); preference.removeEventListener('change', stop); };
    }, [value]);
    return <><span className="admin-analytics-sr">{format(value)}</span><span aria-hidden="true">{format(display)}</span></>;
}

export default function AdminAnalytics({ onManageAccess }: { onManageAccess?: () => void }) {
    const [quarters, setQuarters] = useState(4);
    const [selected, setSelected] = useState('');
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState<Analytics | null>(null);
    const [error, setError] = useState('');
    const [plan, setPlan] = useState<Plan | null>(null);
    const [planError, setPlanError] = useState(false);
    const [planAttempt, setPlanAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        const token = getToken();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        let active = true;
        setPlanError(false);
        fetch(`${AUTH_API}/api/auth/admin/plan`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        }).then(async response => {
            if (!active || token !== getToken()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (!response.ok) throw new Error();
            const result = await response.json() as Plan;
            if (typeof result.name !== 'string' || typeof result.plan !== 'string') throw new Error();
            if (active && token === getToken()) setPlan(result);
        }).catch(() => {
            if (active && token === getToken()) setPlanError(true);
        }).finally(() => window.clearTimeout(timeout));
        return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
    }, [planAttempt]);
    useEffect(() => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        const token = getToken();
        let active = true;
        setData(null); setError(''); setSelected('');
        fetch(`${meetingApi}/api/meetings/admin/analytics?quarters=${quarters}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        }).then(async response => {
            if (!active || token !== getToken()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (!response.ok) throw new Error();
            const result = await response.json() as Analytics;
            if (!result.totals || !Array.isArray(result.statuses) || !Array.isArray(result.quarters)) throw new Error();
            if (active && token === getToken()) setData(result);
        }).catch(() => {
            if (active && token === getToken()) setError('Could not load workspace analytics. Try again.');
        }).finally(() => window.clearTimeout(timeout));
        return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
    }, [quarters, attempt]);

    const max = Math.max(1, ...(data?.quarters.map(item => item.count) ?? []));
    const total = data?.statuses.reduce((sum, item) => sum + item.count, 0) ?? 0;
    let offset = 0;
    const segments = data?.statuses.map(({ count }, index) => {
        const start = offset;
        offset += total ? count / total * 100 : 0;
        return `${colors[index % colors.length]} ${start}% ${offset}%`;
    });
    const selectedQuarter = data?.quarters.find(item => item.quarter === selected);

    return <section className="admin-analytics" aria-labelledby="admin-analytics-title">
        <header className="admin-analytics-header">
            <div><p className="admin-analytics-kicker">Workspace analytics</p><h1 id="admin-analytics-title">Meetings and plans</h1>
                <p>Review activity recorded for your organisation.</p></div>
            <label>Activity period <select value={quarters} onChange={event => setQuarters(Number(event.target.value))}>
                <option value={4}>Last 4 quarters</option><option value={8}>Last 8 quarters</option><option value={12}>Last 12 quarters</option>
            </select></label>
        </header>
        {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>
            : !data ? <p role="status">Loading workspace analytics…</p> : <>
                <dl className="admin-analytics-counters" aria-label="All-time workspace totals">
                    <div><dt>Meeting links created</dt><dd><Counter value={data.totals.links} /></dd></div>
                    <div><dt>Scheduled occurrences</dt><dd><Counter value={data.totals.scheduled} /></dd></div>
                    <div><dt>Meetings marked active</dt><dd><Counter value={data.totals.active} /></dd></div>
                </dl>
                <div className="admin-analytics-panels">
                    <section aria-labelledby="admin-activity-title"><h2 id="admin-activity-title">Links created by quarter</h2>
                        <p>Calendar quarters in UTC, including the current quarter.</p>
                        <ul className="admin-analytics-bars">
                            {data.quarters.map(item => <li key={item.quarter}>
                                <button type="button" aria-pressed={selected === item.quarter} aria-label={`${item.quarter}, ${format(item.count)} links`} onClick={() => setSelected(item.quarter)}>
                                    <span>{item.quarter}</span><span className="admin-analytics-track" aria-hidden="true"><i style={{ width: `${item.count / max * 100}%` }} /></span><span>{format(item.count)}</span>
                                </button>
                            </li>)}
                        </ul>
                        {selectedQuarter && <p role="status">{selectedQuarter.quarter} recorded {format(selectedQuarter.count)} {selectedQuarter.count === 1 ? 'link' : 'links'}.</p>}
                    </section>
                    <section aria-labelledby="admin-status-title"><h2 id="admin-status-title">Meeting status</h2>
                        <p>All recorded links in this workspace.</p>
                        {total > 0 ? <div className="admin-analytics-breakdown">
                            <div className="admin-analytics-donut" aria-hidden="true" style={{ background: `conic-gradient(${segments?.join(',')})` }} />
                            <ul>{data.statuses.map((item, index) => <li key={item.status}>
                                <span className="admin-analytics-dot" aria-hidden="true" style={{ backgroundColor: colors[index % colors.length] }} />
                                <span>{Object.prototype.hasOwnProperty.call(statusNames, item.status) ? statusNames[item.status] : item.status}</span><strong>{format(item.count)}</strong>
                            </li>)}</ul>
                        </div> : <p>No meetings recorded yet.</p>}
                    </section>
                </div>
            </>}
        <div className="admin-analytics-panels admin-analytics-management">
            <section><h2>Plan and workspace access</h2>
                {planError ? <p role="alert">Could not load the current plan. <button type="button" onClick={() => setPlanAttempt(value => value + 1)}>Retry</button></p>
                    : plan ? <><p>{plan.name} · {plan.plan}</p><dl className="admin-analytics-plan">
                        <div><dt>Participants</dt><dd>{format(plan.maxParticipants)}</dd></div>
                        <div><dt>Minutes per meeting</dt><dd>{format(plan.maxDurationMinutes)}</dd></div>
                        <div><dt>Storage quota</dt><dd>{format(plan.storageQuotaGb)} GB</dd></div>
                    </dl></> : <p role="status">Loading workspace plan…</p>}
                <p>View the published plans or manage approved enterprise access.</p>
                <div className="admin-analytics-links"><Link to="/pricing">View plan catalogue</Link>
                    {onManageAccess && <button type="button" onClick={onManageAccess}>Manage access terms</button>}</div>
            </section>
            <section><h2>Quarterly financials</h2><p>Revenue, paid plan uptake, expenses and profit are unavailable. This workspace has no connected billing or accounting records.</p></section>
        </div>
    </section>;
}
