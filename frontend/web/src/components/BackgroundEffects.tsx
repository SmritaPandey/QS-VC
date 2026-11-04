import { useEffect, useRef } from 'react';
import { BACKGROUND_PRESETS, drawPreset, type BackgroundEffect } from '../lib/virtual-background';

interface Props {
    effect: BackgroundEffect;
    onChange: (effect: BackgroundEffect) => void;
    /** your camera as everyone sees it (with the effect applied) */
    preview: MediaStream | null;
    cameraOn: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string;
    onStartCamera: () => void;
    onClose: () => void;
}

function Swatch({ id }: { id: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => { const ctx = ref.current?.getContext('2d'); if (ctx) drawPreset(ctx, id, 160, 90); }, [id]);
    return <canvas ref={ref} width={160} height={90} aria-hidden="true" />;
}

/** Side panel: blur or replace the camera background, with a live preview. */
export default function BackgroundEffects({ effect, onChange, preview, cameraOn, status, error, onStartCamera, onClose }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    useEffect(() => { closeRef.current?.focus(); }, []);
    useEffect(() => { if (videoRef.current) videoRef.current.srcObject = preview; }, [preview]);
    const same = (other: BackgroundEffect) => JSON.stringify({ ...other, src: undefined }) === JSON.stringify({ ...effect, src: undefined });
    const option = (value: BackgroundEffect, label: string, visual: JSX.Element) =>
        <button type="button" key={label} className="effects-option" aria-pressed={same(value)} aria-label={label} title={label} onClick={() => onChange(value)}>{visual}<span>{label}</span></button>;
    const upload = (file?: File) => {
        if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 4_000_000) return;
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' && onChange({ kind: 'image', id: 'upload', src: reader.result });
        reader.readAsDataURL(file);
    };
    return <aside className="side-panel effects-panel" id="meeting-effects" aria-label="Backgrounds and effects" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <div className="panel-header"><div><h3>Backgrounds and effects</h3><p>Only your camera changes. Processing stays on this device.</p></div>
            <button ref={closeRef} type="button" className="panel-close" aria-label="Close backgrounds and effects" onClick={onClose}><span className="mi mi-sm" aria-hidden="true">close</span></button></div>
        <div className="effects-content">
            <div className="effects-preview">
                {cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="effects-preview-off"><span className="mi" aria-hidden="true">videocam_off</span><p>Your camera is off.</p><button type="button" onClick={onStartCamera}>Start camera</button></div>}
                {status === 'loading' && <span className="effects-badge" role="status"><span className="mi" aria-hidden="true">progress_activity</span>Applying…</span>}
            </div>
            {status === 'error' && <p className="effects-error" role="alert">{error || 'Background effects aren’t available in this browser.'}</p>}
            <h4>Blur</h4>
            <div className="effects-grid">
                {option({ kind: 'none' }, 'No effect', <span className="effects-tile"><span className="mi" aria-hidden="true">block</span></span>)}
                {option({ kind: 'blur', strength: 'light' }, 'Slight blur', <span className="effects-tile"><span className="mi" aria-hidden="true">blur_on</span></span>)}
                {option({ kind: 'blur', strength: 'strong' }, 'Blur', <span className="effects-tile effects-tile--strong"><span className="mi" aria-hidden="true">blur_on</span></span>)}
            </div>
            <h4>Backgrounds</h4>
            <div className="effects-grid">
                {BACKGROUND_PRESETS.map(preset => option({ kind: 'image', id: preset.id }, preset.label, <span className="effects-tile"><Swatch id={preset.id} /></span>))}
                {effect.kind === 'image' && effect.id === 'upload' && option(effect, 'Your picture', <span className="effects-tile"><img src={effect.src} alt="" /></span>)}
                <button type="button" className="effects-option" onClick={() => fileRef.current?.click()}><span className="effects-tile"><span className="mi" aria-hidden="true">add_photo_alternate</span></span><span>Upload</span></button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="qs-sr-input" aria-label="Upload a background picture" onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
            <p className="effects-note">Effects use extra processing power. If your video stutters, choose “No effect”.</p>
        </div>
    </aside>;
}
