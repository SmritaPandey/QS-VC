import { useEffect, useState, type FormEvent } from 'react';
import { BRANDING_API, DEFAULT_BRANDING, prepareBrandLogo, type OrganisationBranding as Branding } from '../lib/branding';
import { getToken } from '../lib/session';
import TenantBrand from './TenantBrand';
import '../styles/organisation-branding.css';
export default function OrganisationBranding() {
    const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState('');
    const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });
    useEffect(() => {
        const controller = new AbortController();
        void fetch(BRANDING_API, { headers: headers(), signal: controller.signal, cache: 'no-store' }).then(async response => {
            if (!response.ok) throw new Error('Organisation branding could not be loaded.');
            const value = await response.json(); if (!controller.signal.aborted) setBranding(value);
        }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, []);
    async function save(event: FormEvent) {
        event.preventDefault(); if (busy || loading) return;
        setBusy(true);setError('');setNotice('');
        try {
            const response = await fetch(BRANDING_API, { method: 'PATCH', headers: headers(), body: JSON.stringify(branding) });
            const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Branding could not be saved.');
            setBranding(value);setNotice('Branding saved. New meeting and prejoin pages will use this identity.');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Branding could not be saved.'); }
        finally { setBusy(false); }
    }
    return <section className="system-section organisation-branding" aria-labelledby="organisation-branding-title">
        <h3 id="organisation-branding-title">Organisation branding</h3><p>Set the identity shown in your organisation’s meeting and prejoin pages. Logos stay inside this service.</p>
        {loading && <p role="status">Loading branding…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        <form onSubmit={event => { void save(event); }}><fieldset disabled={loading || busy}><legend className="sr-only">Meeting branding</legend>
            <label htmlFor="organisation-brand-name">Organisation name<input id="organisation-brand-name" required maxLength={80} value={branding.organisationName} onChange={event => setBranding(current => ({ ...current, organisationName: event.target.value }))} /></label>
            <label htmlFor="organisation-brand-logo">Logo image<input id="organisation-brand-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                setBusy(true);setError('');setNotice('');
                void prepareBrandLogo(file).then(logoDataUrl => setBranding(current => ({ ...current, logoDataUrl }))).catch(cause => setError(cause instanceof Error ? cause.message : 'Logo could not be read.')).finally(() => setBusy(false));
            }} /></label><p className="branding-help">PNG, JPEG or WebP, up to 2 MB. Images are resized and saved as a small PNG. External image links are not used.</p>
            {branding.logoDataUrl && <button type="button" onClick={() => setBranding(current => ({ ...current, logoDataUrl: null }))}>Remove logo</button>}
            <label htmlFor="organisation-brand-accent">Accent colour<input id="organisation-brand-accent" type="color" value={branding.accent} onChange={event => setBranding(current => ({ ...current, accent: event.target.value }))} /></label>
            <p className="branding-help">The accent decorates the identity mark. Meeting text and controls keep their accessible theme colours.</p>
            <div className="branding-preview" aria-label="Meeting identity preview"><TenantBrand branding={branding} /></div>
            <button type="submit" className="btn-primary">{busy ? 'Saving…' : 'Save branding'}</button>
        </fieldset></form>
    </section>;
}
