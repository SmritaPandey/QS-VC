import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { signaling } from '../lib/signaling';
import { boardPoint, EMPTY_COLLABORATION, newerCollaboration, pollCounts, sharedFileError, SHARED_FILE_TYPES, POLL_RESULT_LABELS, type BoardPoint, type CollaborationState, type PollResults } from '../lib/collaboration-state';
import '../styles/meeting-collaboration.css';

interface Props { open: boolean; connected: boolean; role: string; myPeerId: string; onClose: () => void }
const TABS = [['board', 'draw', 'Whiteboard'], ['polls', 'poll', 'Polls'], ['questions', 'help', 'Q&A'], ['notes', 'description', 'Notes'], ['files', 'attach_file', 'Files']] as const;
type Tab = typeof TABS[number][0];
const PALETTE = ['#102a43', '#006d77', '#c9364f', '#5141be'];
const FILE_ICONS: Record<string, string> = { 'image/png': 'image', 'image/jpeg': 'image', 'application/pdf': 'picture_as_pdf', 'text/plain': 'description' };
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;

export default function MeetingCollaboration({ open, connected, role, myPeerId, onClose }: Props) {
    const [snapshot, setSnapshot] = useState<CollaborationState>(EMPTY_COLLABORATION);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<Tab>('board');
    const [color, setColor] = useState(PALETTE[0]);
    const [width, setWidth] = useState(3);
    const [drawing, setDrawing] = useState<BoardPoint[]>([]);
    const draftStroke = useRef<BoardPoint[]>([]);
    const pointer = useRef<number | null>(null);
    const [notes, setNotes] = useState('');
    const [notesVersion, setNotesVersion] = useState(0);
    const [notesDirty, setNotesDirty] = useState(false);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [pollQuestion, setPollQuestion] = useState('');
    const [pollOptions, setPollOptions] = useState('');
    const [pollResults, setPollResults] = useState<PollResults>('live');
    const [question, setQuestion] = useState('');
    const [dragging, setDragging] = useState(false);
    const [uploading, setUploading] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);
    const tabsRef = useRef<HTMLElement>(null);
    // On narrow screens keep the chosen tab visible in the scrolling tab row.
    useEffect(() => { tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [tab, open]);
    const closeRef = useRef<HTMLButtonElement>(null);
    const active = useRef(true);
    const pending = useRef(false);
    const manager = role === 'host' || role === 'co-host';
    const receive = useCallback((next: CollaborationState) => { if (active.current) setSnapshot(current => newerCollaboration(current, next)); }, []);
    const refresh = useCallback(async () => {
        try { receive(await signaling.request('getCollaborationState')); }
        catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : 'Could not load activities.'); }
        finally { if (active.current) setLoading(false); }
    }, [receive]);
    useEffect(() => {
        active.current = true;
        if (!connected) return () => { active.current = false; };
        setLoading(true);
        const remove = signaling.on('collaborationUpdated', receive);
        void refresh();
        return () => { active.current = false; remove(); };
    }, [connected, receive, refresh]);
    useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
    useEffect(() => {
        if (!notesDirty) { setNotes(snapshot.notes.text); setNotesVersion(snapshot.notes.version); }
    }, [snapshot.notes, notesDirty]);
    const act = async (action: Record<string, unknown>): Promise<CollaborationState | null> => {
        if (pending.current || !connected) return null;
        pending.current = true; setBusy(true); setError('');
        try {
            const next: CollaborationState = await signaling.request('collaborationAction', action);
            receive(next);
            return next;
        } catch (reason) {
            if (active.current) { setError(reason instanceof Error ? reason.message : 'That change could not be saved.'); void refresh(); }
            return null;
        } finally { pending.current = false; if (active.current) setBusy(false); }
    };
    const pointAt = (event: PointerEvent<SVGSVGElement>) => boardPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    const beginStroke = (event: PointerEvent<SVGSVGElement>) => {
        if (!connected || loading || busy || event.button !== 0 || pointer.current !== null) return;
        const point = pointAt(event);
        if (!point) return;
        pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
        draftStroke.current = [point]; setDrawing([point]);
    };
    const moveStroke = (event: PointerEvent<SVGSVGElement>) => {
        if (pointer.current !== event.pointerId || draftStroke.current.length >= 1000) return;
        const point = pointAt(event), previous = draftStroke.current[draftStroke.current.length - 1];
        if (!point || !previous || Math.hypot(point.x - previous.x, point.y - previous.y) < .002) return;
        draftStroke.current.push(point); setDrawing([...draftStroke.current]);
    };
    const cancelStroke = () => { pointer.current = null; draftStroke.current = []; setDrawing([]); };
    const finishStroke = (event: PointerEvent<SVGSVGElement>) => {
        if (pointer.current !== event.pointerId) return;
        const points = draftStroke.current;
        cancelStroke();
        if (points.length) void act({ type: 'stroke:add', points: points.length === 1 ? [points[0], points[0]] : points, color, width });
    };
    const saveNotes = async () => {
        const next = await act({ type: 'notes:update', text: notes, version: notesVersion });
        if (next && active.current) { setNotes(next.notes.text); setNotesVersion(next.notes.version); setNotesDirty(false); }
    };
    const upload = async (file?: File) => {
        if (!file || pending.current) return;
        const validation = sharedFileError(file.size, file.type);
        if (validation) { setError(validation); return; }
        setUploading(file.name);
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (active.current && connected) await act({ type: 'file:add', name: file.name, mime: file.type, data: btoa(String.fromCharCode(...bytes)) });
        } catch { if (active.current) setError('This file could not be read. Try again.'); }
        finally { if (active.current) setUploading(''); }
    };
    const download = async (id: string) => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try {
            const file: { name: string; mime: string; data: string } = await signaling.request('getCollaborationFile', { id });
            if (!active.current) return;
            const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
            const validation = sharedFileError(bytes.length, file.mime);
            if (validation) throw new Error(validation);
            const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
            const link = document.createElement('a'); link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : 'Could not download this file.'); }
        finally { pending.current = false; if (active.current) setBusy(false); }
    };
    const changeTab = (next: Tab) => { cancelStroke(); setTab(next); setError(''); };
    const exportNotes = () => {
        const url = URL.createObjectURL(new Blob([notes], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'QS-VC-meeting-notes.txt'; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const notesConflict = notesDirty && snapshot.notes.version !== notesVersion;
    const myLastStroke = [...snapshot.strokes].reverse().find(stroke => stroke.authorId === myPeerId);
    if (!open) return null;
    return <aside className="meeting-collaboration" id="meeting-activities" aria-label="Meeting activities" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header className="collaboration-header"><div><h2>Meeting activities</h2><p>Shared with everyone in this room.</p></div><button ref={closeRef} type="button" className="collaboration-close" aria-label="Close meeting activities" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></header>
        <nav ref={tabsRef} className="collaboration-tabs" aria-label="Activities" role="tablist">{TABS.map(([key, icon, label]) => <button type="button" role="tab" key={key} aria-selected={tab === key} aria-pressed={tab === key} onClick={() => changeTab(key)}><span className="mi" aria-hidden="true">{icon}</span>{label}</button>)}</nav>
        <div className="collaboration-content" aria-busy={busy}>
            {(!connected || loading) && <p role="status">{connected ? 'Loading shared activities…' : 'Activities are offline. Reconnect to continue.'}</p>}
            {error && <p className="collaboration-error" role="alert">{error}<button type="button" disabled={!connected || busy} onClick={() => { setError(''); void refresh(); }}>Refresh activities</button></p>}
            <fieldset className="collaboration-workspace" disabled={tab !== 'notes' && (!connected || busy || loading)}>
            {tab === 'board' && <><div className="collaboration-board-tools"><div role="group" aria-label="Pen colour">{PALETTE.map(value => <button key={value} type="button" aria-label={`Pen ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} style={{ color: value }}><span aria-hidden="true">●</span></button>)}</div><label>Pen width<select value={width} onChange={event => setWidth(Number(event.target.value))}><option value={3}>Fine</option><option value={6}>Medium</option><option value={10}>Broad</option></select></label><button type="button" disabled={!myLastStroke} onClick={() => { if (myLastStroke) void act({ type: 'stroke:undo', id: myLastStroke.id }); }}>Undo mine</button>{manager && <button type="button" disabled={!snapshot.strokes.length} onClick={() => { if (window.confirm('Clear the shared whiteboard for everyone?')) void act({ type: 'board:clear' }); }}>Clear board</button>}</div><p className="collaboration-hint">Draw with a pointer or touch. Use shared notes for keyboard contributions.</p><svg className="collaboration-board" viewBox="0 0 1000 650" role="img" aria-label={`Shared whiteboard, ${snapshot.strokes.length} strokes`} onPointerDown={beginStroke} onPointerMove={moveStroke} onPointerUp={finishStroke} onPointerCancel={cancelStroke} onLostPointerCapture={cancelStroke}>{snapshot.strokes.map(stroke => <polyline key={stroke.id} points={stroke.points.map(point => `${point.x * 1000},${point.y * 650}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}<polyline points={drawing.map(point => `${point.x * 1000},${point.y * 650}`).join(' ')} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" /></svg></>}
            {tab === 'polls' && <>{manager && <form className="collaboration-form" onSubmit={async (event: FormEvent) => { event.preventDefault(); const options = pollOptions.split('\n').map(value => value.trim()).filter(Boolean); if (options.length < 2 || options.length > 6 || options.some(value => value.length > 100)) { setError('Add 2 to 6 options, each up to 100 characters.'); return; } if (await act({ type: 'poll:create', question: pollQuestion.trim(), options, results: pollResults })) { setPollQuestion(''); setPollOptions(''); } }}><h3>Create a poll</h3><label>Question<input value={pollQuestion} onChange={event => setPollQuestion(event.target.value)} maxLength={300} required /></label><label>Options, one per line<textarea value={pollOptions} onChange={event => setPollOptions(event.target.value)} maxLength={606} rows={3} required /></label><label>Who can see results<select value={pollResults} onChange={event => setPollResults(event.target.value as PollResults)}>{(Object.keys(POLL_RESULT_LABELS) as PollResults[]).map(key => <option key={key} value={key}>{POLL_RESULT_LABELS[key]}</option>)}</select></label><button type="submit">Launch poll</button></form>}{!snapshot.polls.length && <p>No polls yet. Hosts can start one.</p>}{snapshot.polls.map(poll => { const counts = pollCounts(poll); return <section className="collaboration-card" key={poll.id}><h3>{poll.question}</h3><p>{poll.closed ? 'Poll closed' : 'Choose one answer'} · {poll.total ?? Object.keys(poll.votes).length} {(poll.total ?? Object.keys(poll.votes).length) === 1 ? 'vote' : 'votes'}</p>{(manager || poll.resultsHidden) && poll.results && poll.results !== 'live' && <p className="collaboration-poll-visibility"><span className="mi" aria-hidden="true">visibility_off</span>{poll.resultsHidden ? (poll.results === 'afterClose' ? 'Results appear when the host closes the poll.' : 'Only hosts can see the results.') : `Results visible to: ${POLL_RESULT_LABELS[poll.results]}`}</p>}<fieldset disabled={poll.closed}><legend className="collaboration-sr">{poll.question}</legend>{poll.options.map((option, index) => <label className="collaboration-poll-choice" key={index}><input type="radio" name={`poll-${poll.id}`} checked={poll.votes[myPeerId] === index} onChange={() => { void act({ type: 'poll:vote', id: poll.id, option: index }); }} /><span>{option}</span>{!poll.resultsHidden && <span>{counts[index]} {counts[index] === 1 ? 'vote' : 'votes'}</span>}</label>)}</fieldset>{manager && !poll.closed && <button type="button" onClick={() => { void act({ type: 'poll:close', id: poll.id }); }}>Close poll</button>}</section>; })}</>}
            {tab === 'questions' && <><form className="collaboration-form" onSubmit={async event => { event.preventDefault(); if (await act({ type: 'question:ask', text: question.trim() })) setQuestion(''); }}><label>Your question<textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} rows={2} required /></label><button type="submit">Ask question</button></form>{!snapshot.questions.length && <p>No questions yet.</p>}{snapshot.questions.map(item => <section className="collaboration-card" key={item.id}><p className="collaboration-author">{item.authorName}</p><h3>{item.text}</h3><button type="button" aria-pressed={item.voters.includes(myPeerId)} onClick={() => { void act({ type: 'question:vote', id: item.id }); }}>Helpful · {item.voters.length}</button>{item.answer && <p className="collaboration-answer">Host answer: {item.answer}</p>}{manager && <form className="collaboration-form" onSubmit={async event => { event.preventDefault(); if (await act({ type: 'question:answer', id: item.id, answer: answers[item.id]?.trim() })) setAnswers(current => ({ ...current, [item.id]: '' })); }}><label>Answer<textarea value={answers[item.id] || ''} onChange={event => setAnswers(current => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} rows={2} required /></label><button type="submit">{item.answer ? 'Update answer' : 'Answer question'}</button></form>}</section>)}</>}
            {tab === 'notes' && <div className="collaboration-form"><label>Shared notes<textarea disabled={busy || loading} value={notes} onChange={event => { setNotes(event.target.value); setNotesDirty(true); }} rows={12} maxLength={20000} /></label><p className="collaboration-hint">{notesDirty ? 'Your draft has unsaved changes.' : 'Shared notes are up to date.'} Notes are shared when you save and last for this meeting. Download a copy before leaving.</p>{notesConflict && <div className="collaboration-conflict" role="status"><p>Shared notes changed. Your draft is safe above. Copy any changes you need before replacing it.</p><label>Latest shared version<textarea readOnly value={snapshot.notes.text} rows={5} /></label><button type="button" onClick={() => { setNotes(snapshot.notes.text); setNotesVersion(snapshot.notes.version); setNotesDirty(false); }}>Replace my draft with latest</button></div>}<button type="button" disabled={!connected || busy || loading || !notesDirty || notesConflict} onClick={() => { void saveNotes(); }}>Save shared notes</button><button type="button" disabled={!notes.length} onClick={exportNotes}>Download my notes</button></div>}
            {tab === 'files' && <>
                <div className="collaboration-dropzone" data-dragging={dragging || undefined} data-busy={uploading ? true : undefined}
                    onClick={event => { if (!uploading && event.target === event.currentTarget) fileInput.current?.click(); }}
                    onDragOver={event => { event.preventDefault(); if (!dragging) setDragging(true); }}
                    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
                    onDrop={event => { event.preventDefault(); setDragging(false); if (connected && !busy && !loading) void upload(event.dataTransfer.files?.[0]); }}>
                    <span className="mi collaboration-dropzone-icon" aria-hidden="true">{uploading ? 'progress_activity' : 'upload_file'}</span>
                    <p className="collaboration-dropzone-title">{uploading ? <>Sharing <strong>{uploading}</strong>…</> : <>Drop a file here, or <button type="button" className="collaboration-link" onClick={() => fileInput.current?.click()}>browse</button></>}</p>
                    <p className="collaboration-dropzone-meta">PNG, JPEG, PDF or text · up to 32 KB</p>
                    <input ref={fileInput} className="collaboration-sr" type="file" aria-label="Choose a file to share" accept={SHARED_FILE_TYPES.join(',')} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
                </div>
                <div className="collaboration-files-head"><h3>Shared files{snapshot.files.length ? ` (${snapshot.files.length})` : ''}</h3><span><span className="mi" aria-hidden="true">schedule</span>Available until the meeting ends</span></div>
                {!snapshot.files.length ? <div className="collaboration-empty"><span className="mi" aria-hidden="true">folder_open</span><p>No files shared yet</p><p className="collaboration-hint">Files you share appear here for everyone in the meeting.</p></div> :
                <ul className="collaboration-files">{snapshot.files.map(file => <li key={file.id}>
                    <span className="collaboration-file-icon mi" aria-hidden="true">{FILE_ICONS[file.mime] || 'draft'}</span>
                    <div><span className="collaboration-file-name" title={file.name}>{file.name}</span><small>{fileSize(file.size)} · {file.authorId === myPeerId ? 'You' : file.authorName}</small></div>
                    <button type="button" className="collaboration-icon-btn" aria-label={`Download ${file.name}`} title="Download" onClick={() => { void download(file.id); }}><span className="mi" aria-hidden="true">download</span></button>
                    {(manager || file.authorId === myPeerId) && <button type="button" className="collaboration-icon-btn collaboration-danger" aria-label={`Remove ${file.name}`} title="Remove" onClick={() => { void act({ type: 'file:remove', id: file.id }); }}><span className="mi" aria-hidden="true">delete</span></button>}
                </li>)}</ul>}
            </>}
            </fieldset>
        </div>
    </aside>;
}
