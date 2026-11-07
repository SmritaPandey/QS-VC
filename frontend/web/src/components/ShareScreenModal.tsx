import { useEffect, useRef, useState } from 'react';

export type ScreenShareSurface = 'browser' | 'window' | 'monitor';

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (surface: ScreenShareSurface) => void;
}

interface ShareOption {
    value: ScreenShareSurface;
    icon: string;
    title: string;
    badge: string;
    description: string;
}

const SHARE_OPTIONS: ShareOption[] = [
    {
        value: 'browser',
        icon: 'tab',
        title: 'Chrome / Browser Tab',
        badge: 'Best for video & sound',
        description: 'Share a single web tab with high frame rate and tab audio.',
    },
    {
        value: 'window',
        icon: 'web_asset',
        title: 'Application Window',
        badge: 'Docs & apps',
        description: 'Share a specific software window without exposing your entire desktop.',
    },
    {
        value: 'monitor',
        icon: 'desktop_windows',
        title: 'Entire Screen',
        badge: 'Full display',
        description: 'Share your complete monitor across multiple applications and windows.',
    },
];

export default function ShareScreenModal({ open, onClose, onSelect }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [selected, setSelected] = useState<ScreenShareSurface>('browser');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);

    if (!open) return null;

    const handleConfirm = () => {
        onSelect(selected);
        onClose();
    };

    return (
        <dialog
            ref={dialogRef}
            className="share-screen-dialog"
            aria-labelledby="share-screen-title"
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div className="share-screen-modal-content">
                <div className="share-screen-header">
                    <div className="share-screen-title-group">
                        <div className="share-screen-icon-bubble">
                            <span className="mi share-screen-icon" aria-hidden="true">screen_share</span>
                        </div>
                        <div>
                            <h2 id="share-screen-title">Choose what to share</h2>
                            <p className="share-screen-lead">Select how you want to present to everyone in the meeting.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="share-screen-close"
                        aria-label="Close screen sharing options"
                        onClick={onClose}
                    >
                        <span className="mi" aria-hidden="true">close</span>
                    </button>
                </div>

                <div className="share-screen-options" role="radiogroup" aria-label="Screen sharing mode">
                    {SHARE_OPTIONS.map((opt) => (
                        <div
                            key={opt.value}
                            role="radio"
                            aria-checked={selected === opt.value}
                            tabIndex={0}
                            className={`share-screen-card ${selected === opt.value ? 'selected' : ''}`}
                            onClick={() => setSelected(opt.value)}
                            onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    setSelected(opt.value);
                                }
                            }}
                        >
                            <div className="share-card-icon-wrapper">
                                <span className="mi" aria-hidden="true">{opt.icon}</span>
                            </div>
                            <div className="share-card-body">
                                <div className="share-card-title-row">
                                    <span className="share-card-title">{opt.title}</span>
                                    <span className="share-card-badge">{opt.badge}</span>
                                </div>
                                <p className="share-card-desc">{opt.description}</p>
                            </div>
                            <div className="share-card-radio">
                                <span className="mi" aria-hidden="true">
                                    {selected === opt.value ? 'radio_button_checked' : 'radio_button_unchecked'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="share-screen-footer">
                    <p className="share-screen-privacy-note">
                        <span className="mi" aria-hidden="true">lock</span>
                        Your browser will prompt for permission before capture begins.
                    </p>
                    <div className="share-screen-actions">
                        <button type="button" className="share-screen-btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="button" className="share-screen-btn-primary" onClick={handleConfirm}>
                            <span className="mi" aria-hidden="true">screen_share</span>
                            Share
                        </button>
                    </div>
                </div>
            </div>
        </dialog>
    );
}

