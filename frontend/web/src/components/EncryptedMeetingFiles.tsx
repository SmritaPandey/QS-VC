import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import { sharedFileError, SHARED_FILE_TYPES } from '../lib/collaboration-state';
import type { EncryptedNotesAccess } from '../lib/encrypted-notes';
import type { EncryptedNotesRecord } from '../lib/e2ee-data';

const MAX_FILE_BYTES = 18 * 1024;
interface FileRecord extends EncryptedNotesRecord { authorId: string; authorName: string; authorSigningKey: string }
interface OpenFile { id: string; name: string; mime: string; bytes: Uint8Array<ArrayBuffer>; authorId: string; authorName: string }

function decodeFile(payload: string) {
    const file = JSON.parse(payload);
    if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 120 ||
        /[/\\\u0000-\u001f]/.test(file.name) || typeof file.data !== 'string') throw new Error('Invalid file');
    const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
    if (bytes.length > MAX_FILE_BYTES || sharedFileError(bytes.length, file.mime)) throw new Error('Invalid file format or size');
    const text = file.mime === 'text/plain' ? new TextDecoder('utf-8', { fatal:true }).decode(bytes) : '';
    const valid = file.mime === 'image/png' ? /\.png$/i.test(file.name) && [137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte)
        : file.mime === 'image/jpeg' ? /\.jpe?g$/i.test(file.name) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : file.mime === 'application/pdf' ? /\.pdf$/i.test(file.name) && String.fromCharCode(...bytes.subarray(0,5)) === '%PDF-'
        : /\.txt$/i.test(file.name) && !text.includes('\0') && !/<\s*(?:!doctype|html|script|svg|iframe)/i.test(text);
    if (!valid) throw new Error('File contents do not match the format');
    return { name: file.name as string, mime: file.mime as string, bytes };
}

export default function EncryptedMeetingFiles({ access, connected, peerId, manager, visible, canShareFiles }: {
    access: EncryptedNotesAccess; connected: boolean; peerId: string; manager: boolean; visible: boolean; canShareFiles: boolean;
}) {
    const [files, setFiles] = useState<OpenFile[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const reload = useRef<() => void>(() => {});
    useEffect(() => {
        if (!connected) return;
        let disposed = false;
        let running = false;
        let queued = false;
        let timer: number | undefined;
        const refresh = async () => {
            if (disposed) return;
            if (running) { queued = true; return; }
            running = true;
            try {
                const records: FileRecord[] = await signaling.request('getEncryptedFiles');
                const opened: OpenFile[] = [];
                let failed = false;
                for (const record of records) {
                    if (disposed) return;
                    try {
                        const { encrypted } = record;
                        const id = encrypted.fileId;
                        const key = access.signingKeyFor(encrypted.senderPeerId);
                        if (!id || (key && key !== record.signingPublicKey)) throw new Error('File identity changed');
                        const { text, currentEpoch } = await access.manager.openNotes(record);
                        const signed = JSON.parse(text);
                        const authorKey = access.signingKeyFor(record.authorId);
                        if ((authorKey && authorKey !== record.authorSigningKey) ||
                            typeof signed.payload !== 'string' || typeof signed.signature !== 'string' ||
                            !await access.manager.verifyFile(id, signed.payload, signed.signature, record.authorSigningKey)) {
                            throw new Error('File author signature could not be verified');
                        }
                        const file = decodeFile(signed.payload);
                        if (!currentEpoch && access.isKeyHolder() && !disposed) {
                            const resealed = await access.manager.sealNotes(text, encrypted.revision + 1, 1, id);
                            await signaling.request('putEncryptedFile', resealed);
                        }
                        opened.push({ id, ...file, authorId:record.authorId, authorName:record.authorName });
                    } catch { failed = true; }
                }
                if (!disposed) {
                    setFiles(opened);
                    setError(failed ? 'Some files could not sync. Refresh when the meeting key is ready.' : '');
                }
            } catch {
                if (!disposed) setError('Could not load shared files.');
            } finally {
                running = false;
                if (queued && !disposed) { queued = false; schedule(); }
            }
        };
        function schedule() {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => { void refresh(); }, 150);
        }
        reload.current = schedule;
        const unsubscribe = signaling.on('encryptedFilesChanged', schedule);
        const onKey = access.manager.onKeyChange(schedule);
        schedule();
        return () => {
            disposed = true;
            window.clearTimeout(timer);
            unsubscribe();
            onKey();
            reload.current = () => {};
        };
    }, [access, connected]);

    const upload = async (file?: File) => {
        if (!file || !connected || busy || !canShareFiles) return;
        const validation = sharedFileError(file.size, file.type);
        if (validation || file.size > MAX_FILE_BYTES) {
            setError(validation || 'Choose a file up to 18 KB.');
            return;
        }
        setBusy(true);
        try {
            const data = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
            const payload = JSON.stringify({ name:file.name, mime:file.type, data });
            decodeFile(payload);
            const id = crypto.randomUUID();
            const signature = await access.manager.signFile(id, payload);
            const encrypted = await access.manager.sealNotes(JSON.stringify({ payload, signature }), 1, 1, id);
            await signaling.request('putEncryptedFile', encrypted);
            reload.current();
        } catch { setError('The file could not be shared. Check the file format and name, then try again.'); }
        finally { setBusy(false); }
    };
    const remove = async (id: string) => {
        if (busy || !connected) return;
        setBusy(true);
        try { await signaling.request('removeEncryptedFile', { id }); reload.current(); }
        catch { setError('Could not remove the file.'); }
        finally { setBusy(false); }
    };
    const download = (file: OpenFile) => {
        const url = URL.createObjectURL(new Blob([file.bytes], { type:file.mime }));
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return <section hidden={!visible} className="collaboration-form" aria-label="Encrypted shared files">
        {canShareFiles ? <label>Share a file<input type="file" disabled={!connected || busy} accept={SHARED_FILE_TYPES.join(',')}
            onChange={event => { void upload(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label> : <p className="collaboration-hint">The host can allow you to share files.</p>}
        <p className="collaboration-hint">PNG, JPEG, PDF or text · up to 18 KB each · 10 files per room</p>
        {error && <p role="alert">{error} <button type="button" onClick={() => reload.current()}>Refresh files</button></p>}
        {!files.length && !error && <p>No shared files yet.</p>}
        <ul className="collaboration-files">{files.map(file => <li key={file.id}>
            <div><strong>{file.name}</strong><small>{file.authorName}</small></div>
            <button type="button" onClick={() => download(file)}>Download</button>
            {(manager || file.authorId === peerId) && <button type="button" disabled={busy || !connected} onClick={() => { void remove(file.id); }}>Remove</button>}
        </li>)}</ul>
    </section>;
}
