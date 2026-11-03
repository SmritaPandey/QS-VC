import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import { recordingManager, recordingRequest, type CloudRecording } from '../lib/recording';
import '../styles/recordings.css';

export default function RecordingPlayback() {
    const { meetingId = '', shareToken } = useParams();
    const [recordings, setRecordings] = useState<CloudRecording[]>([]);
    const [loading, setLoading] = useState(true);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [video, setVideo] = useState('');
    const [selected, setSelected] = useState('');
    const [sharing, setSharing] = useState('');
    const [shareUrl, setShareUrl] = useState('');
    const [deleting, setDeleting] = useState<string | null>(null);
    const mounted = useRef(true);
    const [pending, setPending] = useState(recordingManager.pending);
    useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (recordingManager.pending) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
    const base = encodeURIComponent(meetingId);
    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        setLoading(true); setError(''); setVideo('');
        const path = shareToken ? `shared/${encodeURIComponent(shareToken)}` : `meeting/${base}`;
        recordingRequest(path, { signal: controller.signal }, !!shareToken).then(result => {
            if (!mounted.current) return;
            if (shareToken) setVideo(result.url);
            else { setRecordings(result.recordings); setNextCursor(result.nextCursor); }
        }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
            .finally(() => { if (mounted.current) setLoading(false); });
        return () => { mounted.current = false; controller.abort(); };
    }, [base, shareToken]);

    const action = async (recording: CloudRecording, kind: 'play' | 'download' | 'delete' | 'share' | 'revoke') => {
        if (busy) return;
        document.querySelectorAll<HTMLDetailsElement>('.recordings-actions[open]').forEach(menu => { menu.open = false; menu.querySelector('summary')?.focus(); });
        setBusy(recording.id); setError(''); setNotice('');
        const path = `${base}/${encodeURIComponent(recording.id)}`;
        try {
            if (kind === 'play' || kind === 'download') {
                const result = await recordingRequest(`${path}/playback`);
                if (kind === 'play') { setVideo(result.url); setSelected(recording.id); }
                else {
                    const response = await fetch(result.url);
                    if (!response.ok) throw new Error('Download failed. Try again.');
                    recordingManager.downloadLocally(await response.blob(), `QS-VC-${meetingId}-${recording.id}.${recording.format}`);
                    setNotice('Download requested. Check your browser’s downloads.');
                }
            } else if (kind === 'delete') {
                await recordingRequest(path, { method: 'DELETE' });
                setRecordings(current => current.filter(item => item.id !== recording.id));
                if (selected === recording.id) { setVideo(''); setSelected(''); }
                setDeleting(null); setShareUrl(''); setNotice('Recording deleted.'); requestAnimationFrame(() => document.getElementById('recordings-title')?.focus());
            } else if (kind === 'share') {
                const result = await recordingRequest(`${path}/share`, { method: 'POST' });
                setShareUrl(`${window.location.origin}/recordings/shared/${result.token}`);
                setSharing(recording.id);
                requestAnimationFrame(() => document.getElementById(`share-${recording.id}`)?.focus());
            } else {
                await recordingRequest(`${path}/share`, { method: 'DELETE' });
                setShareUrl(''); setSharing(''); setNotice('Sharing disabled. An already opened video link may work for up to five minutes.');
            }
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not finish. Try again.'); }
        finally { if (mounted.current) setBusy(''); }
    };
    return <div className="public-site recordings-page"><SiteNav /><main id="main-content" className="recordings-shell">
        <Link className="recordings-back" to="/app">← Back to meetings</Link>
        <header><div><h1 id="recordings-title" tabIndex={-1}>{shareToken ? 'Shared recording' : 'Meeting recordings'}</h1><p>{shareToken ? 'This recording was shared by its host.' : 'Saved privately until you delete them. Downloads start only when you choose.'}</p></div>{!shareToken && <span className="recordings-code">{meetingId}</span>}</header>
        {pending && <section className="recordings-message" aria-label="Unsaved recording"><h2>Recording waiting to save</h2><p>Keep this tab open. This copy is only in memory until upload succeeds.</p><details className="recordings-actions"><summary aria-label="Unsaved recording actions"><span className="mi" aria-hidden="true">more_horiz</span></summary><div className="recordings-menu"><button type="button" disabled={!!busy} onClick={async () => {
            setBusy('pending'); setError('');
            try { await recordingManager.uploadRecording(pending.meetingCode, pending.blob, pending.id); recordingManager.pending = null; setPending(null); setNotice('Recording saved. Reload to refresh the list.'); }
            catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed. Try again.'); }
            finally { setBusy(''); }
        }}>Retry saving</button><button type="button" onClick={() => recordingManager.downloadLocally(pending.blob, `QS-VC-${pending.meetingCode}.${pending.format}`)}>Download unsaved copy</button><button type="button" onClick={() => { if (window.confirm('Discard the unsaved recording? This copy cannot be recovered.')) { recordingManager.pending = null; setPending(null); } }}>Discard unsaved copy</button></div></details></section>}
        {loading && <p role="status">Loading recordings…</p>}
        {error && <div role="alert" className="recordings-message"><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Try again</button></div>}
        {notice && <p role="status" className="recordings-message">{notice}</p>}
        {video && <section aria-label="Recording playback" className="recordings-player"><video key={video} src={video} controls playsInline preload="metadata" onError={() => setError('Playback failed or the link expired. Open the recording again.')} /><p>Playback links expire after five minutes. Open the recording again if needed.</p></section>}
        {!loading && !shareToken && !recordings.length && !error && <div className="recordings-empty"><h2>No recordings yet</h2><p>Sign in as the meeting host, then choose Record in the meeting’s More menu.</p></div>}
        {!shareToken && <ul className="recordings-list">{recordings.map(recording => <li key={recording.id}>
            <button type="button" className="recordings-play" disabled={!!busy} onClick={() => void action(recording, 'play')} aria-label={`Play recording from ${new Date(recording.createdAt).toLocaleString()}`}><span className="mi" aria-hidden="true">play_arrow</span></button>
            <div className="recordings-info"><h2>{new Date(recording.createdAt).toLocaleString()}</h2><p>{(recording.size / 1024 / 1024).toFixed(1)} MB · {recording.format.toUpperCase()}</p></div>
            <details className="recordings-actions" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary id={`actions-${recording.id}`} aria-label={`Actions for recording from ${new Date(recording.createdAt).toLocaleString()}`}><span className="mi" aria-hidden="true">more_horiz</span></summary><div className="recordings-menu">
                <button type="button" disabled={!!busy} onClick={() => void action(recording, 'download')}>Download</button>
                <button type="button" disabled={!!busy} onClick={() => void action(recording, 'share')}>Create share link</button>
                <button type="button" disabled={!!busy} onClick={() => void action(recording, 'revoke')}>Disable sharing</button>
                <button type="button" disabled={!!busy} onClick={event => { setDeleting(recording.id); const menu = event.currentTarget.closest('details'); if (menu) menu.open = false; requestAnimationFrame(() => document.getElementById(`delete-${recording.id}`)?.focus()); }}>Delete recording</button>
            </div></details>
            {deleting === recording.id && <div className="recordings-confirm" role="group" aria-label="Confirm recording deletion"><p>Delete this recording permanently? Shared access will stop.</p><button id={`delete-${recording.id}`} type="button" disabled={!!busy} onClick={() => void action(recording, 'delete')}>Delete permanently</button><button type="button" disabled={!!busy} onClick={() => { setDeleting(null); requestAnimationFrame(() => document.getElementById(`actions-${recording.id}`)?.focus()); }}>Keep recording</button></div>}
            {sharing === recording.id && shareUrl && <div className="recordings-share"><label htmlFor={`share-${recording.id}`}>Anyone with this link can watch. Disable sharing to revoke it.</label><input id={`share-${recording.id}`} value={shareUrl} readOnly onFocus={event => event.target.select()} /><button type="button" onClick={() => { navigator.clipboard.writeText(shareUrl).then(() => setNotice('Share link copied.')).catch(() => setNotice('Select and copy the link above.')); }}>Copy link</button></div>}
        </li>)}</ul>}
        {!shareToken && nextCursor && <button type="button" disabled={!!busy} onClick={async () => {
            setBusy('page'); setError('');
            try { const result = await recordingRequest(`meeting/${base}?cursor=${encodeURIComponent(nextCursor)}`); setRecordings(current => [...current, ...result.recordings].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)); setNextCursor(result.nextCursor); }
            catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load recordings.'); }
            finally { setBusy(''); }
        }}>Load more recordings</button>}
    </main></div>;
}
