import { useRef, useState } from 'react';
import { STICKY_COLORS, type BoardStickyNote, type StickyColor } from '../lib/collaboration-state';

type StickyAction =
    | { type: 'sticky:add'; text: string; color: StickyColor }
    | { type: 'sticky:update'; id: string; version: number; text: string; color: StickyColor }
    | { type: 'sticky:remove'; id: string; version: number };

interface Props {
    notes: BoardStickyNote[];
    myPeerId: string;
    manager: boolean;
    disabled: boolean;
    onAction: (action: StickyAction) => Promise<unknown>;
}

export default function WhiteboardStickyNotes({ notes, myPeerId, manager, disabled, onAction }: Props) {
    const [draft, setDraft] = useState<{ original?: BoardStickyNote; text: string; color: StickyColor } | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const groups = new Map<string, BoardStickyNote[]>();
    for (const note of notes) {
        const group = groups.get(note.authorId);
        if (group) group.push(note);
        else groups.set(note.authorId, [note]);
    }
    const closeEditor = () => { setDraft(null); headingRef.current?.focus(); };
    const latest = draft?.original && notes.find(note => note.id === draft.original?.id);
    const stale = !!draft?.original && latest?.version !== draft.original.version;

    return <section className="sticky-board" aria-labelledby="sticky-board-title">
        <header className="sticky-board-header">
            <h3 ref={headingRef} tabIndex={-1} id="sticky-board-title">Sticky notes</h3>
            <button type="button" disabled={disabled || !!draft || notes.length >= 60}
                onClick={() => setDraft({ text: '', color: 'yellow' })}>
                <span className="mi" aria-hidden="true">add</span>Add note
            </button>
        </header>
        {draft && <form className="sticky-editor" onSubmit={async event => {
            event.preventDefault();
            const text = draft.text.trim();
            if (!text || stale) return;
            const action: StickyAction = draft.original
                ? { type: 'sticky:update', id: draft.original.id, version: draft.original.version, text, color: draft.color }
                : { type: 'sticky:add', text, color: draft.color };
            if (await onAction(action)) closeEditor();
        }}>
            <label>Note<textarea autoFocus required maxLength={240} rows={3} value={draft.text}
                onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
            <label>Color<select value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value as StickyColor })}>
                {STICKY_COLORS.map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
            </select></label>
            {stale && <p role="status">This note changed. Your draft is here to copy before you cancel.</p>}
            <div className="sticky-editor-actions">
                <button type="submit" disabled={disabled || stale || !draft.text.trim()}>{draft.original ? 'Save changes' : 'Post note'}</button>
                <button type="button" onClick={closeEditor}>Cancel</button>
            </div>
        </form>}
        {!notes.length && !draft && <p className="sticky-empty">Add an idea to start the board.</p>}
        {notes.length >= 60 && <p className="sticky-empty">The board has reached its 60-note limit.</p>}
        {[...groups].map(([authorId, group]) => <section key={authorId} className="sticky-group">
            <h4>{authorId === myPeerId ? 'You' : group[0].authorName}</h4>
            <ul className="sticky-grid">{group.map(note => <li key={note.id} data-color={note.color} className="sticky-card">
                <p>{note.text}</p>
                {(manager || note.authorId === myPeerId) && <div className="sticky-card-actions">
                    <button type="button" aria-label="Edit sticky note" title="Edit sticky note" disabled={disabled || !!draft}
                        onClick={() => setDraft({ original: note, text: note.text, color: note.color })}><span className="mi" aria-hidden="true">edit</span></button>
                    <button type="button" aria-label="Remove sticky note" title="Remove sticky note" disabled={disabled || !!draft}
                        onClick={async () => { if (await onAction({ type: 'sticky:remove', id: note.id, version: note.version })) headingRef.current?.focus(); }}>
                        <span className="mi" aria-hidden="true">delete</span>
                    </button>
                </div>}
            </li>)}</ul>
        </section>)}
    </section>;
}
