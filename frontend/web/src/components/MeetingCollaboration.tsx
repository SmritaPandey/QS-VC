import { downloadReport, pollReport, questionReport } from '../lib/activity-reports';
import SelectionInput from './SelectionInput';
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { signaling } from '../lib/signaling';
import { boardPoint, EMPTY_COLLABORATION, newerCollaboration, pollCounts, sharedFileError, SHARED_FILE_TYPES, POLL_RESULT_LABELS, type BoardStroke, type BoardPoint, type CollaborationState, type PollResults } from '../lib/collaboration-state';
import { MAX_SECURE_NOTES_BYTES, type EncryptedNotesRecord } from '../lib/e2ee-data';
import { readEncryptedNotes, saveEncryptedNotes, type EncryptedNotesAccess } from '../lib/encrypted-notes';
import EncryptedPolls from './EncryptedPolls';
import EncryptedQuestions from './EncryptedQuestions';
import AnimatedNumber from './AnimatedNumber';
import { readEncryptedBoard, actEncryptedBoard, type EncryptedBoardState } from '../lib/encrypted-board';
import EncryptedMeetingFiles from './EncryptedMeetingFiles';
import { downloadWhiteboard } from '../lib/whiteboard-export';
import WhiteboardStickyNotes from './WhiteboardStickyNotes';
import '../styles/meeting-collaboration.css';

interface Props { onSelectTab?: (tab: CollaborationTab) => void; sharedTab?: CollaborationTab | null; tabRequest?: { tab: CollaborationTab }; open: boolean; connected: boolean; role: string; myPeerId: string; onClose: () => void; encryptedNotes?: EncryptedNotesAccess; canShareFiles?: boolean; canEditBoard?: boolean }
export const ACTIVITY_TABS = [['board', 'draw', 'Whiteboard'], ['polls', 'poll', 'Polls'], ['questions', 'help', 'Q&A'], ['notes', 'description', 'Notes'], ['files', 'attach_file', 'Files']] as const;
export type CollaborationTab = typeof ACTIVITY_TABS[number][0];
type Tab = CollaborationTab;
const PALETTE = ['#102a43', '#006d77', '#c9364f', '#5141be'];
const FILE_ICONS: Record<string, string> = { 'image/png': 'image', 'image/jpeg': 'image', 'application/pdf': 'picture_as_pdf', 'text/plain': 'description' };
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;

export default function MeetingCollaboration({ onSelectTab, sharedTab, tabRequest, open, connected, role, myPeerId, onClose, encryptedNotes, canShareFiles = true, canEditBoard = true }: Props) {
    const [snapshot, setSnapshot] = useState<CollaborationState>(EMPTY_COLLABORATION);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<Tab>(tabRequest?.tab ?? 'board');
    const tabs = ACTIVITY_TABS;
    useEffect(() => { if (tabRequest) { setPrivateView(false); setTab(tabRequest.tab); setError(''); } }, [tabRequest]);
    const [board, setBoard] = useState<EncryptedBoardState>({revision:0,strokes:[],stickyNotes:[],records:new Map()});
    const [boardError, setBoardError] = useState('');
    const boardRefresh = useRef<() => void>(() => {});
    const [boardTool, setBoardTool] = useState<'notes' | 'draw' | 'pan' | 'line' | 'rectangle'>('draw');
    const [redoStroke, setRedoStroke] = useState<BoardStroke | null>(null);
    const drawingTool = boardTool === 'draw' || boardTool === 'line' || boardTool === 'rectangle';
    const panOrigin = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [color, setColor] = useState(PALETTE[0]);
    const [width, setWidth] = useState(3);
    const [failedStroke,setFailedStroke]=useState<Record<string,unknown>|null>(null);
    const [drawing, setDrawing] = useState<BoardPoint[]>([]);
    const draftStroke = useRef<BoardPoint[]>([]);
    const pointer = useRef<number | null>(null);
    const [notes, setNotes] = useState('');
    const [personalNotes, setPersonalNotes] = useState('');
    const [privateView, setPrivateView] = useState(false);
    const [shareStatus, setShareStatus] = useState('');
    const [inviteStatus, setInviteStatus] = useState('');
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
    useEffect(() => {
        const nav = tabsRef.current;
        const selected = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
        if (!open || !nav || !selected) return;
        const bounds = nav.getBoundingClientRect();
        const item = selected.getBoundingClientRect();
        if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left;
        else if (item.right > bounds.right) nav.scrollLeft += item.right - bounds.right;
    }, [tab, open]);
    const closeRef = useRef<HTMLButtonElement>(null);
    const active = useRef(true);
    const pending = useRef(false);
    const manager = role === 'host' || role === 'co-host';
    const receive = useCallback((next: CollaborationState) => { if (active.current) setSnapshot(current => {
        const accepted = newerCollaboration(current, next);
        return encryptedNotes ? {...accepted,strokes:current.strokes,stickyNotes:current.stickyNotes} : accepted;
    }); }, [encryptedNotes]);
    const receiveBoard = useCallback((next: EncryptedBoardState) => {
        setBoard(current => next.revision >= current.revision ? next : current);
    }, []);
    useEffect(() => {
        if (encryptedNotes) setSnapshot(current => ({ ...current, strokes: board.strokes, stickyNotes: board.stickyNotes }));
    }, [encryptedNotes, board]);
    useEffect(() => {
        if (!encryptedNotes || !connected) return;
        let disposed=false, running=false, queued=false;
        let timer:number|undefined;
        const refreshBoard=async()=>{
            if(disposed)return;
            if(running){queued=true;return;}
            running=true;
            try{
                const next=await readEncryptedBoard(encryptedNotes);
                if (!disposed) { receiveBoard(next); setBoardError(''); }
            }catch{if(!disposed)setBoardError('Whiteboard could not sync. Refresh when the secure connection is ready.');}
            finally{running=false;if(queued&&!disposed){queued=false;schedule();}}
        };
        function schedule(){window.clearTimeout(timer);timer=window.setTimeout(()=>{void refreshBoard();},200);}
        boardRefresh.current=schedule;
        const unsubscribe=signaling.on('encryptedBoardChanged',schedule);
        const key=encryptedNotes.manager.onKeyChange(schedule);
        schedule();
        return()=>{disposed=true;window.clearTimeout(timer);unsubscribe();key();boardRefresh.current=()=>{};};
    },[encryptedNotes,connected,receiveBoard]);
    const refresh = useCallback(async () => {
        try {
            const next = encryptedNotes
                ? await readEncryptedNotes(encryptedNotes, await signaling.request('getEncryptedNotes'))
                : await signaling.request('getCollaborationState');
            receive(next);
            if (encryptedNotes && active.current) setError(error => error.startsWith('Secure notes could not sync.') ? '' : error);
        } catch {
            if (active.current) setError(encryptedNotes ? 'Secure notes could not sync. Refresh when the meeting key is ready.' : 'Could not load activities. Try again.');
        } finally { if (active.current) setLoading(false); }
    }, [encryptedNotes, receive]);
    useEffect(() => {
        active.current = true;
        if (!connected) return () => { active.current = false; };
        setLoading(true);
        let subscribed = true;
        const remove = encryptedNotes
            ? signaling.on('encryptedNotesUpdated', (record: EncryptedNotesRecord) => {
                void readEncryptedNotes(encryptedNotes, record).then(next => {
                    if (!subscribed) return;
                    receive(next);
                    setError(error => error.startsWith('Secure notes could not sync.') ? '' : error);
                }, () => { if (subscribed) setError('Secure notes could not sync. Refresh when the meeting key is ready.'); });
            })
            : signaling.on('collaborationUpdated', receive);
        const removeKey = encryptedNotes?.manager.onKeyChange(() => { void refresh(); });
        void refresh();
        return () => { subscribed = false; active.current = false; remove(); removeKey?.(); };
    }, [connected, encryptedNotes, receive, refresh]);
    useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
    useEffect(() => {
        if (!notesDirty) { setNotes(snapshot.notes.text); setNotesVersion(snapshot.notes.version); }
    }, [snapshot.notes, notesDirty]);
    const act = async (action: Record<string, unknown>): Promise<CollaborationState | null> => {
        if (pending.current || !connected) return null;
        pending.current = true; setBusy(true); setError('');
        try {
            let next: CollaborationState;
            if (encryptedNotes) {
                if (typeof action.type === 'string' && /^(stroke:|sticky:|board:)/.test(action.type)) {
                    const updated = await actEncryptedBoard(encryptedNotes,action,board,myPeerId);
                    receiveBoard(updated);
                    const nextBoard={...snapshot,strokes:updated.strokes,stickyNotes:updated.stickyNotes};
                    return nextBoard;
                }
                if (action.type !== 'notes:update' || typeof action.text !== 'string' || action.version !== snapshot.notes.version) return null;
                next = await saveEncryptedNotes(encryptedNotes, action.text, snapshot);
            } else {
                next = await signaling.request('collaborationAction', action);
            }
            receive(next);
            return next;
        } catch {
            if (active.current) {
                setError('That change could not be saved. Try again.');
                void refresh();
                boardRefresh.current();
            }
            return null;
        } finally { pending.current = false; if (active.current) setBusy(false); }
    };
    const pointAt = (event: PointerEvent<SVGSVGElement>) => boardPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    const beginStroke = (event: PointerEvent<SVGSVGElement>) => {
        if (boardTool === 'pan' && event.button === 0) {
            const viewport = event.currentTarget.parentElement!;
            panOrigin.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
        }
        if (!drawingTool || !canEditBoard || !connected || loading || busy || event.button !== 0 || pointer.current !== null) return;
        const point = pointAt(event);
        if (!point) return;
        pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
        draftStroke.current = [point]; setDrawing([point]);
    };
    const moveStroke = (event: PointerEvent<SVGSVGElement>) => {
        const pan = panOrigin.current;
        if (pan?.id === event.pointerId) {
            event.currentTarget.parentElement?.scrollTo(pan.left + pan.x - event.clientX, pan.top + pan.y - event.clientY);
            return;
        }
        if (pointer.current !== event.pointerId || draftStroke.current.length >= (encryptedNotes ? 400 : 1000)) return;
        const point = pointAt(event), previous = draftStroke.current[draftStroke.current.length - 1];
        if (!point || !previous || Math.hypot(point.x - previous.x, point.y - previous.y) < .002) return;
        const start = draftStroke.current[0];
        if (boardTool === 'line') draftStroke.current = [start, point];
        else if (boardTool === 'rectangle') {
            draftStroke.current = [start, { x: point.x, y: start.y }, point, { x: start.x, y: point.y }, start];
        } else draftStroke.current.push(point);
        setDrawing([...draftStroke.current]);
    };
    const cancelStroke = () => { panOrigin.current = null; pointer.current = null; draftStroke.current = []; setDrawing([]); };
    const finishStroke = (event: PointerEvent<SVGSVGElement>) => {
        if (pointer.current !== event.pointerId) return;
        moveStroke(event);
        const points = draftStroke.current;
        cancelStroke();
        if (points.length) {
            setRedoStroke(null);
            const action={type:'stroke:add',points:points.length===1?[points[0],points[0]]:points,color,width};
            void act(action).then(saved=>setFailedStroke(saved?null:action));
        }
    };
    const saveNotes = async () => {
        if (encryptedNotes && new TextEncoder().encode(notes).length > MAX_SECURE_NOTES_BYTES) {
            setError('Secure notes can contain up to 32 KB of text. Shorten your draft before saving.');
            return;
        }
        const next = await act({ type: 'notes:update', text: notes, version: notesVersion });
        if (next && active.current) { setNotes(next.notes.text); setNotesVersion(next.notes.version); setNotesDirty(false); }
    };
    const upload = async (file?: File) => {
        if (!file || pending.current || !canShareFiles) return;
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
        } catch { if (active.current) setError('Could not download this file. Try again.'); }
        finally { pending.current = false; if (active.current) setBusy(false); }
    };
    const changeTab = (next: Tab) => { cancelStroke(); setInviteStatus(''); onSelectTab?.(next); setTab(next); setError(''); };
    const exportNotes = (text: string, filename: string) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const shareNotes = async (text: string) => {
        setShareStatus('');
        try {
            if (typeof navigator.share === 'function') {
                await navigator.share({ title: 'Meeting notes', text });
            } else {
                await navigator.clipboard.writeText(text);
                setShareStatus('Notes copied. Paste them where you want to share them.');
            }
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) {
                setShareStatus('Sharing is unavailable. Download a copy to share.');
            }
        }
    };
    const filePickerDisabled = !connected || busy || loading || !!uploading;
    const notesConflict = notesDirty && snapshot.notes.version !== notesVersion;
    const myLastStroke = [...snapshot.strokes].reverse().find(stroke => stroke.authorId === myPeerId);
    if (!open && !encryptedNotes) return null;
    return <section hidden={!open} className="meeting-collaboration" id="meeting-activities" aria-label="Meeting activities" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header className="collaboration-header"><div><h2>Meeting activities</h2><p>{encryptedNotes ? 'Activities are end-to-end encrypted in this room.' : 'Shared in this room.'}</p></div><button ref={closeRef} type="button" className="collaboration-close" aria-label="Return to call layout" title="Return to call layout" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></header>
        <nav ref={tabsRef} className="collaboration-tabs" aria-label="Activities" role="tablist" onKeyDown={event => {
            const index = tabs.findIndex(([key]) => key === tab);
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
            if (next === -1) return;
            event.preventDefault();
            changeTab(tabs[next][0]);
            event.currentTarget.querySelectorAll('button')[next]?.focus();
        }}>
            {tabs.map(([key, icon, label]) => <button type="button" role="tab" key={key} id={`activity-tab-${key}`}
                aria-controls="activity-workspace" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => changeTab(key)}>
                <span className="mi" aria-hidden="true">{icon}</span>{label}
            </button>)}
        </nav>
        <div className="collaboration-content" id="activity-workspace" role="tabpanel" aria-labelledby={`activity-tab-${tab}`} aria-busy={busy}>
            {manager && !(tab === 'notes' && privateView) && <button type="button" className="btn-text" disabled={!connected || loading || busy} onClick={async () => {
                try {
                    await signaling.request('setSharedActivity', { tab: sharedTab === tab ? null : tab });
                    setInviteStatus('');
                } catch { setInviteStatus('Could not update the shared tab. Try again.'); }
            }}>{sharedTab === tab ? 'Stop sharing' : 'Share tab with everyone ·'} {tabs.find(([key]) => key === tab)?.[2]}</button>}
            {inviteStatus && <p role="status">{inviteStatus}</p>}
            {(!connected || loading) && <p role="status">{connected ? 'Loading shared activities…' : 'Activities are offline. Reconnect to continue.'}</p>}
            {failedStroke && <p role="status">Your last stroke could not be saved.
                <button type="button" disabled={!canEditBoard || busy || !connected} onClick={() => { void act(failedStroke).then(saved=>{if(saved)setFailedStroke(null);}); }}>Retry stroke</button>
                <button type="button" onClick={() => setFailedStroke(null)}>Discard stroke</button>
            </p>}
            {boardError && <p role="alert">{boardError}<button type="button" onClick={() => boardRefresh.current()}>Refresh whiteboard</button></p>}
            {error && <p className="collaboration-error" role="alert">{error}<button type="button" disabled={!connected || busy} onClick={() => { setError(''); void refresh(); }}>Refresh activities</button></p>}
            {tab === 'board' && <div className="whiteboard-modes" role="group" aria-label="Whiteboard tools">
                <button type="button" aria-pressed={boardTool === 'notes'} onClick={() => { cancelStroke(); setBoardTool('notes'); }}><span className="mi" aria-hidden="true">sticky_note_2</span>Sticky notes</button>
                <button type="button" aria-pressed={boardTool === 'draw'} onClick={() => setBoardTool('draw')}><span className="mi" aria-hidden="true">draw</span>Draw</button>
                {(['line', 'rectangle'] as const).map(tool => <button key={tool} type="button" aria-pressed={boardTool === tool} onClick={() => { cancelStroke(); setBoardTool(tool); }}>
                    <span className="mi" aria-hidden="true">{tool === 'line' ? 'show_chart' : 'crop_square'}</span>{tool === 'line' ? 'Line' : 'Rectangle'}
                </button>)}
                <button type="button" aria-pressed={boardTool === 'pan'} onClick={() => { cancelStroke(); setBoardTool('pan'); }}><span className="mi" aria-hidden="true">pan_tool</span>Pan</button>
                <button type="button" disabled={!connected || loading || !!boardError || (!snapshot.strokes.length && !snapshot.stickyNotes?.length)} onClick={() => {
                    try { downloadWhiteboard(snapshot.strokes, snapshot.stickyNotes ?? []); }
                    catch { setError('Could not download the whiteboard image. Try again.'); }
                }}><span className="mi" aria-hidden="true">download</span>Download board image</button>
            </div>}
            <div hidden={tab !== 'board' || (boardTool !== 'notes' && !snapshot.stickyNotes?.length)}>
                <WhiteboardStickyNotes notes={snapshot.stickyNotes ?? []} myPeerId={myPeerId}
                    manager={manager} disabled={!canEditBoard || !connected || busy || loading} onAction={act} />
            </div>
            <fieldset className="collaboration-workspace" disabled={tab !== 'notes' && (!connected || busy || loading)}>
            {tab === 'board' && !canEditBoard && <p>The host can allow you to contribute to this whiteboard.</p>}
            {tab === 'board' && <><div hidden={!drawingTool} className="collaboration-board-tools"><div role="group" aria-label="Pen colour">{PALETTE.map(value => <button key={value} type="button" aria-label={`Pen ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} style={{ color: value }}><span aria-hidden="true">●</span></button>)}</div><label>Pen width<select value={width} onChange={event => setWidth(Number(event.target.value))}><option value={3}>Fine</option><option value={6}>Medium</option><option value={10}>Broad</option></select></label><button type="button" disabled={!canEditBoard || !myLastStroke} onClick={async () => {
                if (myLastStroke && await act({ type: 'stroke:undo', id: myLastStroke.id })) setRedoStroke(myLastStroke);
            }}>Undo my stroke</button>
            <button type="button" disabled={!canEditBoard || !redoStroke} onClick={async () => {
                if (!redoStroke) return;
                const { points, color, width } = redoStroke;
                if (await act({ type: 'stroke:add', points, color, width })) setRedoStroke(null);
            }}>Redo stroke</button>{(encryptedNotes ? role === 'host' : manager) && <button type="button" disabled={!snapshot.strokes.length && !(encryptedNotes && snapshot.stickyNotes?.length)} onClick={() => { if (window.confirm(encryptedNotes ? 'Clear all drawings and sticky notes for everyone?' : 'Clear all drawings for everyone? Sticky notes will stay.')) void act({ type: 'board:clear' }).then(saved => { if (saved) setRedoStroke(null); }); }}>{encryptedNotes ? 'Clear board' : 'Clear drawings'}</button>}</div><p className="collaboration-hint">{boardTool === 'pan' ? 'Drag to move around the zoomed canvas.' : boardTool === 'notes' ? 'Add a sticky note above the canvas.' : boardTool === 'draw' ? 'Drag to draw. Use sticky notes to contribute with a keyboard.' : 'Drag from the start point to the end point.'}</p><div className="board-navigation" role="group" aria-label="Canvas zoom">
                <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .25))}>−</button>
                <button type="button" aria-label="Reset canvas zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))}>+</button>
            </div><div className="board-viewport" role="region" aria-label="Drawing canvas" tabIndex={0}><svg className="collaboration-board" style={{ width: `${zoom * 100}%` }} viewBox="0 0 1000 650" role="img" aria-label={`Shared whiteboard, ${snapshot.strokes.length} strokes`} onPointerDown={beginStroke} onPointerMove={moveStroke} onPointerUp={finishStroke} onPointerCancel={cancelStroke} onLostPointerCapture={cancelStroke}>{snapshot.strokes.map(stroke => <polyline key={stroke.id} points={stroke.points.map(point => `${point.x * 1000},${point.y * 650}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}<polyline points={drawing.map(point => `${point.x * 1000},${point.y * 650}`).join(' ')} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" /></svg></div></>}
            {manager && !encryptedNotes && tab === 'polls' && snapshot.polls.length > 0 &&
                <button type="button" disabled={snapshot.polls.some(poll => poll.resultsHidden)} onClick={() =>
                    downloadReport('QS-VC-polls.csv', pollReport(snapshot.polls.map(poll => ({ ...poll, counts: pollCounts(poll) }))))}>Download poll report (CSV)</button>}
            {manager && !encryptedNotes && tab === 'questions' && snapshot.questions.length > 0 &&
                <button type="button" onClick={() => downloadReport('QS-VC-questions.csv', questionReport(snapshot.questions))}>Download Q&amp;A report (CSV)</button>}
            {tab === 'polls' && !encryptedNotes && <>{manager && <form className="collaboration-form" onSubmit={async (event: FormEvent) => { event.preventDefault(); const options = pollOptions.split('\n').map(value => value.trim()).filter(Boolean); if (options.length < 2 || options.length > 6 || options.some(value => value.length > 100)) { setError('Add 2 to 6 options, each up to 100 characters.'); return; } if (await act({ type: 'poll:create', question: pollQuestion.trim(), options, results: pollResults })) { setPollQuestion(''); setPollOptions(''); } }}><h3>Create a poll</h3><label>Question<input value={pollQuestion} onChange={event => setPollQuestion(event.target.value)} maxLength={300} required /></label><label>Options, one per line<textarea value={pollOptions} onChange={event => setPollOptions(event.target.value)} maxLength={606} rows={3} required /></label><label>Who can see results<select value={pollResults} onChange={event => setPollResults(event.target.value as PollResults)}>{(Object.keys(POLL_RESULT_LABELS) as PollResults[]).map(key => <option key={key} value={key}>{POLL_RESULT_LABELS[key]}</option>)}</select></label><button type="submit">Launch poll</button></form>}{!snapshot.polls.length && <p>No polls yet. Hosts can start one.</p>}{snapshot.polls.map(poll => { const counts = pollCounts(poll); const totalVotes = poll.total ?? Object.keys(poll.votes).length; return <section className="collaboration-card" key={poll.id}><h3>{poll.question}</h3><p>{poll.closed ? 'Poll closed' : 'Choose one answer'} · <AnimatedNumber value={totalVotes} /> {totalVotes === 1 ? 'vote' : 'votes'}</p>{(manager || poll.resultsHidden) && poll.results && poll.results !== 'live' && <p className="collaboration-poll-visibility"><span className="mi" aria-hidden="true">visibility_off</span>{poll.resultsHidden ? (poll.results === 'afterClose' ? 'Results appear when the host closes the poll.' : 'Only hosts can see the results.') : `Results visible to: ${POLL_RESULT_LABELS[poll.results]}`}</p>}<fieldset disabled={poll.closed}><legend className="collaboration-sr">{poll.question}</legend>{poll.options.map((option, index) => <label className="collaboration-poll-choice" key={index}><SelectionInput type="radio" name={`poll-${poll.id}`} checked={poll.votes[myPeerId] === index} onChange={() => { void act({ type: 'poll:vote', id: poll.id, option: index }); }} /><span>{option}</span>{!poll.resultsHidden && <span><AnimatedNumber value={counts[index]} /> {counts[index] === 1 ? 'vote' : 'votes'}</span>}</label>)}</fieldset>{manager && !poll.closed && <button type="button" onClick={() => { void act({ type: 'poll:close', id: poll.id }); }}>Close poll</button>}{manager && poll.closed && poll.results === 'hosts' && <button type="button" disabled={busy || !connected} onClick={() => void act({type:'poll:publish',id:poll.id})}>Share results with everyone</button>}</section>; })}</>}
            {tab === 'questions' && !encryptedNotes && <><form className="collaboration-form" onSubmit={async event => { event.preventDefault(); if (await act({ type: 'question:ask', text: question.trim() })) setQuestion(''); }}><label>Your question<textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} rows={2} required /></label><button type="submit">Ask question</button></form>{!snapshot.questions.length && <p>No questions yet.</p>}{snapshot.questions.map(item => <section className="collaboration-card" key={item.id}><p className="collaboration-author">{item.authorName}</p><h3>{item.text}</h3><button type="button" aria-pressed={item.voters.includes(myPeerId)} onClick={() => { void act({ type: 'question:vote', id: item.id }); }}>Helpful · {item.voters.length}</button>{item.answer && <p className="collaboration-answer">Host answer: {item.answer}</p>}{manager && <form className="collaboration-form" onSubmit={async event => { event.preventDefault(); if (await act({ type: 'question:answer', id: item.id, answer: answers[item.id]?.trim() })) setAnswers(current => ({ ...current, [item.id]: '' })); }}>{!item.answer && <button type="button" disabled={busy || !connected} onClick={() => void act({type:'question:answer',id:item.id,answer:'Answered live'})}>Mark answered live</button>}<label>Answer<textarea value={answers[item.id] || ''} onChange={event => setAnswers(current => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} rows={2} required /></label><button type="submit">{item.answer ? 'Update answer' : 'Answer question'}</button></form>}</section>)}</>}
            {tab === 'notes' && <div className="collaboration-form">
                <label>Notebook<select value={privateView ? 'private' : 'shared'} onChange={event => { setPrivateView(event.target.value === 'private'); setShareStatus(''); }}>
                    <option value="shared">Shared with the meeting</option><option value="private">My private notes</option>
                </select></label>
                {privateView ? <><label>My private notes<textarea rows={12} maxLength={20000} value={personalNotes} onChange={event => setPersonalNotes(event.target.value)} /></label>
                    <p className="collaboration-hint">Only you can see these notes. Download a copy before leaving.</p>
                    <button type="button" disabled={!personalNotes.trim()} onClick={() => exportNotes(personalNotes, 'QS-VC-private-notes.txt')}>Download private notes</button>
                </> : <><label>Shared notes<textarea disabled={busy || loading} value={notes} onChange={event => { setNotes(event.target.value); setNotesDirty(true); }} rows={12} maxLength={20000} /></label><p className="collaboration-hint">{notesDirty ? 'Your draft has unsaved changes.' : 'Notes are shared when you save.'} Notes last for this meeting. Download a copy before leaving.</p>{notesConflict && <div className="collaboration-conflict" role="status"><p>Shared notes changed. Your draft is safe above. Copy any changes you need before replacing it.</p><label>Latest shared version<textarea readOnly value={snapshot.notes.text} rows={5} /></label><button type="button" onClick={() => { setNotes(snapshot.notes.text); setNotesVersion(snapshot.notes.version); setNotesDirty(false); }}>Replace my draft with latest</button></div>}<button type="button" disabled={!connected || busy || loading || !notesDirty || notesConflict} onClick={() => { void saveNotes(); }}>Save shared notes</button><button type="button" disabled={!notes.length} onClick={() => exportNotes(notes, 'QS-VC-meeting-notes.txt')}>Download my notes</button></>}
                <button type="button" disabled={!(privateView ? personalNotes : snapshot.notes.text).trim()} onClick={() => void shareNotes(privateView ? personalNotes : snapshot.notes.text)}>
                    {typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? 'Share' : 'Copy'} {privateView ? 'private notes' : 'saved shared notes'}
                </button>
                {shareStatus && <p role="status">{shareStatus}</p>}
            </div>}
            {tab === 'files' && !encryptedNotes && <>
                {!canShareFiles && <p className="collaboration-hint">The host can allow you to share files.</p>}
                {canShareFiles && <div className="collaboration-dropzone" data-dragging={dragging || undefined} data-busy={uploading ? true : undefined}
                    onClick={event => { if (!filePickerDisabled && event.target === event.currentTarget) fileInput.current?.click(); }}
                    onDragOver={event => { event.preventDefault(); if (!filePickerDisabled && !dragging) setDragging(true); }}
                    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
                    onDrop={event => { event.preventDefault(); setDragging(false); if (!filePickerDisabled) void upload(event.dataTransfer.files?.[0]); }}>
                    <span className="mi collaboration-dropzone-icon" aria-hidden="true">{uploading ? 'progress_activity' : 'upload_file'}</span>
                    <p className="collaboration-dropzone-title">{uploading ? <>Sharing <strong>{uploading}</strong>…</> : <>Drop a file here, or <button type="button" className="collaboration-link" disabled={filePickerDisabled} onClick={() => fileInput.current?.click()}>browse</button></>}</p>
                    <p className="collaboration-dropzone-meta">PNG, JPEG, PDF or text · up to 32 KB</p>
                    <input ref={fileInput} className="collaboration-sr" type="file" disabled={filePickerDisabled} aria-label="Choose a file to share" accept={SHARED_FILE_TYPES.join(',')} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
                </div>}
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
            {encryptedNotes && <EncryptedPolls access={encryptedNotes} visible={tab === 'polls'} connected={connected} peerId={myPeerId} manager={manager} />}
            {encryptedNotes && <EncryptedQuestions access={encryptedNotes} visible={tab === 'questions'} connected={connected} peerId={myPeerId} manager={manager} />}
            {encryptedNotes && <EncryptedMeetingFiles access={encryptedNotes} visible={tab === 'files'} connected={connected} peerId={myPeerId} manager={manager} canShareFiles={canShareFiles} />}
        </div>
    </section>;
}
