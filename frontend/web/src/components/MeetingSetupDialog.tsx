import SelectionInput from './SelectionInput';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export type MeetingKind = 'instant' | 'conference' | 'team' | 'town_hall' | 'webinar';
export interface MeetingSetup { title: string; meetingKind: MeetingKind; startNow: boolean }

interface Props {
    action: 'link' | 'start';
    creating: boolean;
    guest?: boolean;
    onClose: () => void;
    onCreate: (setup: MeetingSetup) => void | Promise<void>;
}

const kinds: Array<{ value: MeetingKind; label: string; detail: string }> = [
    { value: 'instant', label: 'Instant meeting', detail: 'Start a meeting right away and invite people to join.' },
    { value: 'conference', label: 'Conferencing', detail: 'A speaker-focused room with breakout rooms.' },
    { value: 'team', label: 'Team meeting', detail: 'An equal video grid with shared notes and a whiteboard.' },
    { value: 'town_hall', label: 'Town hall', detail: 'Share updates from the stage and take audience questions.' },
    { value: 'webinar', label: 'Webinar', detail: 'Present or teach with audience Q&A and polls.' },
];

export default function MeetingSetupDialog({ action, creating, guest = false, onClose, onCreate }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [title, setTitle] = useState('');
    const [meetingKind, setMeetingKind] = useState<MeetingKind>(action === 'start' || guest ? 'instant' : 'conference');
    const [error, setError] = useState('');
    const startNow = action === 'start' || meetingKind === 'instant';

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        return () => { if (dialog?.open) dialog.close(); };
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (creating) return;
        setError('');
        const cleanTitle = title.trim();
        if (!cleanTitle) { setError('Enter a title for your meeting.'); return; }
        try {
            await onCreate({ title: cleanTitle, meetingKind, startNow });
            onClose();
        } catch {
            setError('Could not create the meeting. Please try again.');
        }
    };

    return <dialog ref={dialogRef} className="meeting-setup-dialog" aria-labelledby="meeting-setup-title" onCancel={event => { event.preventDefault(); if (!creating) onClose(); }}>
        <form onSubmit={submit}>
            <div className="meeting-setup-heading">
                <div><span className="mi" aria-hidden="true">video_call</span></div>
                <button type="button" className="meeting-setup-close" aria-label="Close meeting setup" disabled={creating} onClick={onClose}><span className="mi" aria-hidden="true">close</span></button>
            </div>
            <h2 id="meeting-setup-title">Set up your meeting</h2>
            <p className="meeting-setup-lead">Choose a meeting type and give it a title.</p>

            <label className="meeting-setup-title-label" htmlFor="new-meeting-title">Meeting title</label>
            <input id="new-meeting-title" className="meeting-setup-title-input" autoComplete="off" maxLength={255} required value={title} onChange={event => setTitle(event.target.value)} placeholder="For example, Product planning" />

            <fieldset className="meeting-setup-kinds">
                <legend>Meeting type</legend>
                {kinds.filter(kind => !guest || kind.value === 'instant' || kind.value === 'team').map(kind => <label key={kind.value} className="meeting-setup-kind" data-selected={meetingKind === kind.value}>
                    <SelectionInput type="radio" name="meeting-kind" value={kind.value} checked={meetingKind === kind.value} onChange={() => setMeetingKind(kind.value)} />
                    <span className="meeting-setup-kind-copy"><span>{kind.label}</span><small>{kind.detail}</small></span>
                </label>)}
            </fieldset>

            <p className="meeting-setup-waiting"><span className="mi" aria-hidden="true">hourglass_top</span><span>Guests wait until you or a co-host admits them.</span></p>
            {error && <p className="meeting-setup-error" role="alert">{error}</p>}
            <div className="meeting-setup-actions">
                <button type="button" className="meeting-setup-secondary" disabled={creating} onClick={onClose}>Cancel</button>
                <button type="submit" className="meeting-setup-primary" disabled={creating} aria-busy={creating}>{creating ? 'Creating…' : startNow ? 'Start meeting' : 'Create invitation link'}</button>
            </div>
        </form>
    </dialog>;
}
