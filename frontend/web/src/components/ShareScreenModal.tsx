import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_TABS, type CollaborationTab } from './MeetingCollaboration';

export type ScreenShareSurface = 'browser' | 'window' | 'monitor';
const surfaces = [['browser', 'tab', 'Browser tab'], ['window', 'web_asset', 'Window'], ['monitor', 'desktop_windows', 'Entire screen']] as const;

interface Props {
    open: boolean;
    canCapture: boolean;
    canShareActivity: boolean;
    onClose: () => void;
    onSelect: (surface: ScreenShareSurface, sound: boolean) => void;
    onActivity: (tab: CollaborationTab) => void;
}

export default function ShareScreenModal({ open, canCapture, canShareActivity, onClose, onSelect, onActivity }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [surface, setSurface] = useState<ScreenShareSurface>('browser');
    const [sound, setSound] = useState(false);
    useEffect(() => {
        if (open) dialog.current?.showModal();
    }, [open]);
    if (!open) return null;
    return <dialog ref={dialog} aria-labelledby="share-screen-title" className="share-screen-dialog"
        onCancel={event => { event.preventDefault(); onClose(); }}>
        <div className="share-screen-modal-content">
            <header className="share-screen-header">
                <h2 id="share-screen-title">Share with the meeting</h2>
                <button type="button" className="share-screen-close" aria-label="Close sharing options" onClick={onClose}><span aria-hidden="true" className="mi">close</span></button>
            </header>
            {canCapture && <fieldset className="share-picker-group">
                <legend>Present your screen</legend>
                <div className="share-picker-grid">{surfaces.map(([value, icon, label]) =>
                    <label key={value} className="share-picker-option">
                        <input type="radio" name="share-surface" value={value} checked={surface === value} onChange={() => setSurface(value)} />
                        <span className="mi" aria-hidden="true">{icon}</span>{label}
                    </label>)}</div>
                <label className="share-picker-sound"><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} />Include sound when available</label>
                <button type="button" className="share-screen-btn-primary" onClick={() => { onSelect(surface, sound); onClose(); }}>Choose {surfaces.find(([value]) => value === surface)?.[2].toLowerCase()}…</button>
            </fieldset>}
            {canShareActivity && <section className="share-picker-activities" aria-labelledby="share-activity-heading">
                <h3 id="share-activity-heading">Share an activity</h3>
                <p>Opens for everyone alongside the call.</p>
                <div className="share-picker-grid">{ACTIVITY_TABS.map(([tab, icon, title]) =>
                    <button type="button" key={tab} className="share-picker-option" onClick={() => { onActivity(tab); onClose(); }}>
                        <span className="mi" aria-hidden="true">{icon}</span>{title}
                    </button>)}</div>
            </section>}
        </div>
    </dialog>;
}
