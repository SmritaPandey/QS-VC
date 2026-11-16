import { useEffect, useRef, useState, type FormEvent } from 'react';
import { signaling } from '../lib/signaling';
import type { EncryptedNotesAccess } from '../lib/encrypted-notes';
import type { EncryptedNotesRecord } from '../lib/e2ee-data';
import { POLL_RESULT_LABELS, type PollResults } from '../lib/collaboration-state';
interface PollRecord extends EncryptedNotesRecord {
    authorId: string;
    authorSigningKey: string;
}
interface Definition {
    question: string;
    options: string[];
    policy: PollResults;
}
interface Totals {
    counts: number[];
    total: number;
    ballotRevision: number;
}
interface Poll {
    id: string;
    definition: Definition;
    closed: boolean;
    results: PollResults;
    total: number;
    myRevision: number;
    record: PollRecord;
    published: PollRecord | null;
    counts?: number[];
    counted: number;
    incomplete: boolean;
    ballotRevision: number;
}
type Ballot = Parameters<EncryptedNotesAccess['manager']['openBallot']>[0];
const policies = Object.keys(POLL_RESULT_LABELS) as PollResults[];
async function seal(access: EncryptedNotesAccess, id: string, revision: number, kind: string, data: unknown) {
    const payload = JSON.stringify({ domain: 'secure-poll-v1', kind, data });
    const signature = await access.manager.signFile(id, payload);
    return access.manager.sealNotes(JSON.stringify({ payload, signature }), revision, 1, id);
}
async function open(access: EncryptedNotesAccess, id: string, record: PollRecord, kind: string) {
    if (record.encrypted.fileId !== id)
        throw new Error('Poll binding is invalid');
    const known = access.signingKeyFor(record.authorId);
    if (known && known !== record.authorSigningKey)
        throw new Error('Moderator identity changed');
    const outerKey = access.signingKeyFor(record.encrypted.senderPeerId);
    if (outerKey && outerKey !== record.signingPublicKey)
        throw new Error('Poll sender changed');
    const { text, currentEpoch } = await access.manager.openNotes(record);
    const wrapper = JSON.parse(text);
    if (typeof wrapper.payload !== 'string' || typeof wrapper.signature !== 'string' ||
        !await access.manager.verifyFile(id, wrapper.payload, wrapper.signature, record.authorSigningKey))
        throw new Error('Poll author verification failed');
    const body = JSON.parse(wrapper.payload);
    if (body.domain !== 'secure-poll-v1' || body.kind !== kind)
        throw new Error('Invalid poll record');
    if (!currentEpoch && access.isKeyHolder()) {
        const encrypted = await access.manager.sealNotes(text, record.encrypted.revision + 1, 1, id);
        await signaling.request('rewrapEncryptedPoll', { id, field: kind === 'definition' ? 'definition' : 'published', encrypted });
    }
    return body.data;
}
export default function EncryptedPolls({ access, peerId, manager, connected, visible }: {
    access: EncryptedNotesAccess;
    peerId: string;
    manager: boolean;
    connected: boolean;
    visible: boolean;
}) {
    const [polls, setPolls] = useState<Poll[]>([]);
    const [choices, setChoices] = useState<Record<string, number>>({});
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState('');
    const [policy, setPolicy] = useState<PollResults>('live');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const refreshRef = useRef<() => void>(() => { });
    useEffect(() => {
        if (!connected)
            return;
        let disposed = false, running = false, queued = false;
        let timer: number | undefined;
        const refresh = async () => {
            if (disposed)
                return;
            if (running) {
                queued = true;
                return;
            }
            running = true;
            try {
                const index: {
                    polls: {
                        id: string;
                    }[];
                } = await signaling.request('getEncryptedPollIndex');
                const list: Poll[] = [];
                let invalidPolls = 0;
                for (const { id } of index.polls) {
                    if (disposed)
                        return;
                    try {
                        const record = await signaling.request('getEncryptedPoll', { id });
                        record.published = await signaling.request('getEncryptedPollResults', { id });
                        const definition: Definition = await open(access, id, record.definition, 'definition');
                        if (typeof definition.question !== 'string' || !definition.question.trim() || definition.question.length > 300 || !Array.isArray(definition.options) || definition.options.length < 2 || definition.options.length > 6 || definition.options.some(value => typeof value !== 'string' || !value.trim() || value.length > 120) || definition.policy !== record.results)
                            throw new Error('Invalid poll');
                        let counts: number[] | undefined, counted = 0;
                        if (record.published) {
                            const totals: Totals = await open(access, id, record.published, 'results');
                            if (!Array.isArray(totals.counts) || totals.counts.length !== definition.options.length || totals.counts.some(count => !Number.isInteger(count) || count < 0) || totals.counts.reduce((sum, count) => sum + count, 0) !== totals.total || totals.ballotRevision !== record.ballotRevision)
                                throw new Error('Invalid results');
                            counts = totals.counts;
                            counted = totals.total;
                        }
                        let incomplete = false;
                        if (manager) {
                            counts = definition.options.map(() => 0);
                            counted = 0;
                            let cursor: number | null = 0;
                            let revision: number | undefined;
                            do {
                                const page: {
                                    revision: number;
                                    records: {
                                        encrypted: Ballot;
                                        signingPublicKey: string;
                                    }[];
                                    nextCursor: number | null;
                                    total: number;
                                } = await signaling.request('getEncryptedBallots', { id, cursor, revision });
                                revision = page.revision;
                                for (const ballot of page.records) {
                                    const key = access.signingKeyFor(ballot.encrypted.senderPeerId);
                                    if (key && key !== ballot.signingPublicKey)
                                        throw new Error('Voter identity changed');
                                    const choice = await access.manager.openBallot(ballot.encrypted, ballot.signingPublicKey);
                                    if (choice >= counts.length)
                                        throw new Error('Invalid vote');
                                    counts[choice]++;
                                    counted++;
                                }
                                cursor = page.nextCursor;
                                if (cursor !== null)
                                    await new Promise(resolve => window.setTimeout(resolve, 25));
                            } while (cursor !== null && !disposed);
                            incomplete = counted !== record.total;
                        }
                        list.push({ id, definition, closed: record.closed, results: record.results, total: record.total, myRevision: record.myRevision, ballotRevision: record.ballotRevision, record: record.definition, published: record.published, counts, counted, incomplete });
                    }
                    catch {
                        invalidPolls++;
                    }
                }
                if (!disposed) {
                    setPolls(list);
                    setError(invalidPolls ? 'Some polls could not be verified. Refresh when the meeting key is ready.' : '');
                }
            }
            catch {
                if (!disposed)
                    setError('Polls could not sync. Your draft is kept. Refresh after the secure connection is ready.');
            }
            finally {
                running = false;
                if (queued && !disposed) {
                    queued = false;
                    schedule();
                }
            }
        };
        function schedule() { window.clearTimeout(timer); timer = window.setTimeout(() => { void refresh(); }, 200); }
        refreshRef.current = schedule;
        const remove = signaling.on('encryptedPollsChanged', schedule);
        const key = access.manager.onKeyChange(schedule);
        const role = signaling.on('roleChanged', schedule);
        schedule();
        return () => { disposed = true; window.clearTimeout(timer); remove(); key(); role(); refreshRef.current = () => { }; };
    }, [access, connected, manager, peerId]);
    const run = async (action: () => Promise<void>) => {
        if (busy || !connected)
            return;
        setBusy(true);
        setError('');
        try {
            await action();
            refreshRef.current();
        }
        catch {
            setError('That poll action could not be saved. Refresh and try again.');
        }
        finally {
            setBusy(false);
        }
    };
    const create = (event: FormEvent) => {
        event.preventDefault();
        const choices = options.split('\n').map(value => value.trim()).filter(Boolean);
        if (choices.length < 2 || choices.length > 6 || new Set(choices).size !== choices.length || choices.some(value => value.length > 120)) {
            setError('Use 2 to 6 different options, up to 120 characters each.');
            return;
        }
        void run(async () => {
            const id = crypto.randomUUID();
            const encrypted = await seal(access, id, 1, 'definition', { question: question.trim(), options: choices, policy });
            await signaling.request('createEncryptedPoll', { id, encrypted, results: policy });
            setQuestion('');
            setOptions('');
        });
    };
    return <section hidden={!visible} aria-label="Encrypted polls">
        {error && <p role="alert">{error}<button type="button" onClick={() => refreshRef.current()}>Refresh polls</button></p>}
        <p className="collaboration-hint">Ballots are encrypted for current moderators. A moderator publishes shared totals. If all original moderators reconnect, earlier ballots may be unavailable to them.</p>
        {manager && <form className="collaboration-form" onSubmit={create}>
            <label>Question<input required maxLength={300} value={question} onChange={event => setQuestion(event.target.value)}/></label>
            <label>Options, one per line<textarea required maxLength={726} rows={3} value={options} onChange={event => setOptions(event.target.value)}/></label>
            <label>Who can see results<select value={policy} onChange={event => setPolicy(event.target.value as PollResults)}>{policies.map(value => <option key={value} value={value}>{value === 'live' ? 'Everyone, when a moderator publishes' : POLL_RESULT_LABELS[value]}</option>)}</select></label>
            <button type="submit" disabled={busy || !connected}>Launch poll</button>
        </form>}
        {!polls.length && !error && <p>No encrypted polls yet.</p>}
        {polls.map(poll => <section className="collaboration-card" key={poll.id}>
            <h3>{poll.definition.question}</h3><p>{poll.closed ? 'Closed' : 'Open'} · {poll.total} votes</p>
            <fieldset disabled={busy || !connected || poll.closed}><legend className="collaboration-sr">{poll.definition.question}</legend>
                {poll.definition.options.map((option, index) => <label className="collaboration-poll-choice" key={index}>
                    <input type="radio" name={poll.id} checked={choices[poll.id] === index} onChange={() => {
                    void run(async () => {
                        const recipients = access.moderators?.() ?? [];
                        if (!recipients.length)
                            throw new Error('Moderator keys unavailable');
                        const copies = await Promise.all(recipients.map(target => access.manager.sealBallot(poll.id, target.peerId, target.kemPublicKey, index, poll.myRevision + 1)));
                        await signaling.request('voteEncryptedPoll', { id: poll.id, copies });
                        setChoices(current => ({ ...current, [poll.id]: index }));
                    });
                }}/><span>{option}</span>{poll.counts && !poll.incomplete && <span>{poll.counts[index]}</span>}
                </label>)}
            </fieldset>
            {poll.incomplete && <p role="status">Some earlier ballots are unavailable to this moderator. Totals cannot be published.</p>}
            {!manager && poll.results === 'hosts' && <p>Only moderators can see results.</p>}
            {!manager && poll.results === 'afterClose' && !poll.closed && <p>Results appear after closing and publication.</p>}
            {!manager && poll.counts && poll.counted !== poll.total && <p>Published totals cover {poll.counted} votes. Waiting for updated results.</p>}
            {manager && !poll.closed && <button type="button" disabled={busy || !connected} onClick={() => { void run(async () => { await signaling.request('closeEncryptedPoll', { id: poll.id }); }); }}>Close poll</button>}
            {manager && poll.results !== 'hosts' && (poll.results === 'live' || poll.closed) && <button type="button" disabled={busy || !connected || poll.incomplete} onClick={() => {
                    void run(async () => {
                        const encrypted = await seal(access, poll.id, (poll.published?.encrypted.revision ?? 0) + 1, 'results', { counts: poll.counts, total: poll.counted, ballotRevision: poll.ballotRevision });
                        await signaling.request('publishEncryptedPoll', { id: poll.id, encrypted, ballotRevision: poll.ballotRevision });
                    });
                }}>Publish results</button>}
        </section>)}
    </section>;
}
