import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { shareMeetingInvite } from '../lib/meeting-sharing';

interface Props {
    open: boolean;
    meetingCode: string;
    joinUrl: string;
    meetingTitle: string;
    onClose: () => void;
}

async function copyText(value: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.readOnly = true;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Copy failed');
}

export default function MeetingInformation({ open, meetingCode, joinUrl, meetingTitle, onClose }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [copyStatus, setCopyStatus] = useState('');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    const copy = async (value: string, label: string) => {
        try {
            await copyText(value);
            setCopyStatus(`${label} copied.`);
        } catch {
            setCopyStatus(`Could not copy the ${label.toLowerCase()}. Select it and copy it manually.`);
        }
    };
    const share = async () => {
        try {
            const result = await shareMeetingInvite(meetingTitle || 'QS-VC meeting', meetingCode, joinUrl);
            setCopyStatus(result === 'shared' ? 'Share sheet closed.' : result === 'copied' ? 'Invite link copied.' : 'Sharing canceled.');
        } catch {
            setCopyStatus('Could not share the invite link. Copy it and try again.');
        }
    };

    return <dialog ref={dialogRef} className="meeting-information-dialog" aria-labelledby="meeting-information-title"
        onClose={onClose} onClick={event => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}>
        <div className="meeting-information-content">
            <header className="meeting-information-header">
                <div className="meeting-information-heading">
                    <span className="mi" aria-hidden="true">info</span>
                    <div>
                        <h2 id="meeting-information-title">Information</h2>
                        <p>{meetingTitle || 'Meeting details and join options'}</p>
                    </div>
                </div>
                <button type="button" className="meeting-information-close" aria-label="Close meeting information" onClick={() => dialogRef.current?.close()}>
                    <span className="mi" aria-hidden="true">close</span>
                </button>
            </header>

            {meetingCode && joinUrl ? <>
                <div className="meeting-information-qr">
                    <div className="meeting-information-qr-image">
                        <QRCodeSVG value={joinUrl} size={224} level="M" includeMargin title={`QR code to join meeting ${meetingCode}`} />
                    </div>
                    <p>Scan to join this meeting</p>
                </div>

                <div className="meeting-information-code">
                    <div>
                        <span>Meeting code</span>
                        <strong>{meetingCode}</strong>
                    </div>
                    <button type="button" className="meeting-information-copy-code" onClick={() => void copy(meetingCode, 'Meeting code')}>
                        <span className="mi" aria-hidden="true">content_copy</span>Copy code
                    </button>
                </div>
                <button type="button" className="meeting-information-copy-link" onClick={() => void copy(joinUrl, 'Invite link')}>
                    <span className="mi" aria-hidden="true">link</span>Copy invite link
                </button>
                <button type="button" className="meeting-information-share" onClick={() => void share()}>
                    <span className="mi" aria-hidden="true">ios_share</span>Share invite
                </button>
                <p className="meeting-information-status" role="status" aria-live="polite">{copyStatus}</p>
            </> : <p className="meeting-information-unavailable">Meeting information is not available right now.</p>}
        </div>
    </dialog>;
}
