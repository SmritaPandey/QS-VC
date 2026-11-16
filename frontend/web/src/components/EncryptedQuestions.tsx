import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import type { EncryptedNotesAccess } from '../lib/encrypted-notes';
import type { EncryptedNotesRecord } from '../lib/e2ee-data';

interface QuestionRecord extends EncryptedNotesRecord {
    kind: 'question' | 'answer'; authorId: string; authorName: string; authorSigningKey: string; voters: string[];
}
interface OpenRecord extends QuestionRecord { text: string }
interface Page { records: QuestionRecord[]; revision: number; nextCursor: number | null }

export default function EncryptedQuestions({ access, connected, peerId, manager, visible }: {
    access: EncryptedNotesAccess; connected: boolean; peerId: string; manager: boolean; visible: boolean;
}) {
    const [records, setRecords] = useState<OpenRecord[]>([]);
    const [question, setQuestion] = useState('');
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const pending = useRef(false);
    const reload = useRef<() => void>(() => {});
    useEffect(() => {
        if (!connected) { setLoading(true); return; }
        let disposed = false;
        let running = false;
        let queued = false;
        let timer: number | undefined;
        const refresh = async () => {
            if (disposed) return;
            if (running) { queued = true; return; }
            running = true;
            try {
                const opened: OpenRecord[] = [];
                const reseals: { record: QuestionRecord; text: string }[] = [];
                let cursor: number | null = 0;
                let revision: number | undefined;
                while (cursor !== null) {
                    const page: Page = await signaling.request('getEncryptedQuestions', { cursor, ...(revision === undefined ? {} : { revision }) });
                    if (disposed) return;
                    revision = page.revision;
                    for (const record of page.records) {
                        const id = record.encrypted.fileId;
                        const key = access.signingKeyFor(record.encrypted.senderPeerId);
                        const authorKey = access.signingKeyFor(record.authorId);
                        if (!id || (key && key !== record.signingPublicKey) || (authorKey && authorKey !== record.authorSigningKey)) throw new Error('The question author could not be verified.');
                        const { text, currentEpoch } = await access.manager.openNotes(record);
                        const signed = JSON.parse(text);
                        if (typeof signed.payload !== 'string' || typeof signed.signature !== 'string' ||
                            !await access.manager.verifyFile(id, signed.payload, signed.signature, record.authorSigningKey)) throw new Error('The question signature could not be verified.');
                        const payload = JSON.parse(signed.payload);
                        const maximum = record.kind === 'question' ? 1000 : 2000;
                        if (payload.kind !== record.kind || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > maximum) throw new Error('The question format is invalid.');
                        opened.push({ ...record, text: payload.text });
                        if (!currentEpoch && access.isKeyHolder()) reseals.push({ record, text });
                    }
                    cursor = page.nextCursor;
                    if (queued) break;
                    if (cursor !== null) await new Promise(resolve => window.setTimeout(resolve, 125));
                }
                if (!disposed && !queued) {
                    setRecords(opened);
                    setError(current => current.startsWith('Q&A could not sync.') ? '' : current);
                    for (const { record, text } of reseals) {
                        if (disposed || !access.isKeyHolder()) return;
                        await new Promise(resolve => window.setTimeout(resolve, 125));
                        if (disposed) return;
                        const encrypted = await access.manager.sealNotes(text, record.encrypted.revision + 1, 1, record.encrypted.fileId);
                        await signaling.request('putEncryptedQuestion', { kind: record.kind, encrypted });
                    }
                    if (reseals.length) queued = true;
                }
            } catch {
                if (!disposed) setError('Q&A could not sync. Refresh when the meeting key is ready. Your draft is still here.');
            } finally {
                running = false;
                if (!disposed) setLoading(false);
                if (queued && !disposed) { queued = false; schedule(); }
            }
        };
        function schedule() {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => { void refresh(); }, 250);
        }
        reload.current = schedule;
        const remove = signaling.on('encryptedQuestionsChanged', schedule);
        const removeKey = access.manager.onKeyChange(schedule);
        schedule();
        return () => { disposed = true; window.clearTimeout(timer); remove(); removeKey(); reload.current = () => {}; };
    }, [access, connected]);

    const submit = async (kind: 'question' | 'answer', text: string, id: string = crypto.randomUUID()) => {
        if (pending.current || !connected || !text.trim()) return;
        pending.current = true; setBusy(true); setError('');
        try {
            const current = records.find(record => record.kind === kind && record.encrypted.fileId === id);
            const payload = JSON.stringify({ kind, text: text.trim() });
            const signature = await access.manager.signFile(id, payload);
            const encrypted = await access.manager.sealNotes(JSON.stringify({ payload, signature }), (current?.encrypted.revision ?? 0) + 1, 1, id);
            await signaling.request('putEncryptedQuestion', { kind, encrypted });
            if (kind === 'question') setQuestion('');
            else setAnswers(current => ({ ...current, [id]: '' }));
            reload.current();
        } catch { setError('Your contribution could not be saved. Your draft is still here. Refresh and try again.'); }
        finally { pending.current = false; setBusy(false); }
    };
    const vote = async (id: string) => {
        if (pending.current || !connected) return;
        pending.current = true; setBusy(true);
        try { await signaling.request('voteEncryptedQuestion', { id }); reload.current(); }
        catch { setError('Your vote could not be saved. Try again.'); }
        finally { pending.current = false; setBusy(false); }
    };
    return <section hidden={!visible} className="collaboration-form" aria-label="Encrypted questions and answers" aria-busy={loading || busy}>
        {error && <p role="alert">{error} <button type="button" onClick={() => reload.current()}>Refresh Q&A</button></p>}
        <form className="collaboration-form" onSubmit={event => { event.preventDefault(); void submit('question', question); }}>
            <label>Your question<textarea value={question} maxLength={1000} rows={3} required onChange={event => setQuestion(event.currentTarget.value)} /></label>
            <button type="submit" disabled={!connected || busy || loading || !question.trim()}>Ask question</button>
        </form>
        {!loading && !records.some(record => record.kind === 'question') && <p>No questions yet.</p>}
        {records.filter(record => record.kind === 'question').map(record => {
            const id = record.encrypted.fileId!;
            const answer = records.find(item => item.kind === 'answer' && item.encrypted.fileId === id);
            return <section className="collaboration-card" key={id}>
                <p className="collaboration-author">{record.authorName}</p><h3>{record.text}</h3>
                <button type="button" aria-pressed={record.voters.includes(peerId)} disabled={!connected || busy || record.voters.includes(peerId)} onClick={() => { void vote(id); }}>Helpful · {record.voters.length}</button>
                {answer && <p className="collaboration-answer">Host answer · {answer.authorName}: {answer.text}</p>}
                {manager && <form className="collaboration-form" onSubmit={event => { event.preventDefault(); void submit('answer', answers[id] ?? '', id); }}>
                    <label>Answer<textarea rows={2} maxLength={2000} required value={answers[id] ?? ''} onChange={event => { const value = event.currentTarget.value; setAnswers(current => ({ ...current, [id]: value })); }} /></label>
                    <button type="submit" disabled={!connected || busy || !answers[id]?.trim()}>{answer ? 'Update answer' : 'Answer question'}</button>
                </form>}
            </section>;
        })}
        <p className="collaboration-hint">Questions and answers are end-to-end encrypted. Helpful votes use your current meeting connection.</p>
    </section>;
}
