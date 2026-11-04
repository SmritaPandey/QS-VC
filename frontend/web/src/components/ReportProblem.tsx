import { useEffect, useRef, useState } from 'react';

const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const CATEGORIES = [
    ['audio', 'Audio', 'mic'], ['video', 'Video', 'videocam'], ['screen', 'Screen sharing', 'screen_share'],
    ['connection', 'Connection', 'wifi_off'], ['captions', 'Captions', 'closed_caption'], ['other', 'Something else', 'help'],
] as const;
type Category = typeof CATEGORIES[number][0];

interface Props {
    meetingCode: string;
    displayName: string;
    /** collected only if the person keeps "Include technical details" ticked */
    diagnostics: () => Promise<Record<string, unknown>>;
    onClose: () => void;
}

/** "Report a problem": what went wrong, plus optional technical details, sent to the QS-VC team. */
export default function ReportProblem({ meetingCode, displayName, diagnostics, onClose }: Props) {
    const [category, setCategory] = useState<Category>('audio');
    const [description, setDescription] = useState('');
    const [includeDetails, setIncludeDetails] = useState(true);
    const [state, setState] = useState<'editing' | 'sending' | 'sent' | 'failed'>('editing');
    const [error, setError] = useState('');
    const firstRef = useRef<HTMLButtonElement>(null);
    const lastReport = useRef<object | null>(null);
    useEffect(() => { firstRef.current?.focus(); }, []);

    const build = async () => ({ category, description: description.trim(), meetingCode, reporterName: displayName, diagnostics: includeDetails ? await diagnostics().catch(() => ({})) : {} });
    const submit = async () => {
        if (!description.trim()) { setError('Tell us briefly what happened.'); return; }
        setState('sending'); setError('');
        const report = await build();
        lastReport.current = report;
        try {
            const response = await fetch(`${API}/api/meetings/problem-reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Your report could not be sent.');
            setState('sent');
        } catch (reason) {
            setState('failed');
            setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : 'Your report could not be sent.');
        }
    };
    const download = () => {
        const blob = new Blob([JSON.stringify(lastReport.current, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `QS-VC-problem-report-${meetingCode}.json`; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return <div className="meeting-dialog-backdrop" onClick={onClose}>
        <div className="meeting-dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
            {state === 'sent' ? <>
                <span className="mi report-done" aria-hidden="true">task_alt</span>
                <h2 id="report-title">Thanks, your report was sent</h2>
                <p>It helps us fix problems faster. You can keep using the meeting.</p>
                <div className="meeting-dialog-actions"><button type="button" className="btn-outline" autoFocus onClick={onClose}>Done</button></div>
            </> : <>
                <h2 id="report-title">Report a problem</h2>
                <p>What isn’t working?</p>
                <div className="report-categories" role="radiogroup" aria-label="Problem type">
                    {CATEGORIES.map(([value, label, icon], index) => <button type="button" key={value} ref={index === 0 ? firstRef : undefined} role="radio" aria-checked={category === value} onClick={() => setCategory(value)}><span className="mi" aria-hidden="true">{icon}</span>{label}</button>)}
                </div>
                <label className="report-field" htmlFor="report-description">Describe what happened</label>
                <textarea id="report-description" rows={4} maxLength={2000} value={description} placeholder="For example: others can’t hear me after I switched to my headset." onChange={event => { setDescription(event.target.value); setError(''); }} />
                <label className="report-check"><input type="checkbox" checked={includeDetails} onChange={event => setIncludeDetails(event.target.checked)} /><span>Include technical details<small>Browser, device names, connection quality and the meeting code. No audio, video or chat.</small></span></label>
                {error && <p className="report-error" role="alert">{error}</p>}
                <div className="meeting-dialog-actions">
                    {state === 'failed' && <button type="button" className="btn-text" onClick={download}>Download report</button>}
                    <button type="button" className="btn-text" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn-outline" disabled={state === 'sending'} onClick={() => { void submit(); }}>{state === 'sending' ? 'Sending…' : state === 'failed' ? 'Try again' : 'Send report'}</button>
                </div>
            </>}
        </div>
    </div>;
}
