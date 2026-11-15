import BrandLogo from './BrandLogo';
import type { OrganisationBranding } from '../lib/branding';
import '../styles/organisation-branding.css';
export default function TenantBrand({ branding, meeting = false }: { branding: OrganisationBranding; meeting?: boolean }) {
    const custom = branding.organisationName !== 'QS-VC' || !!branding.logoDataUrl;
    if (!custom) return <BrandLogo meeting={meeting} iconOnly={meeting} />;
    return <span className={`tenant-brand${meeting ? ' tenant-brand--meeting' : ''}`} style={{ borderColor: branding.accent }}>
        {branding.logoDataUrl && <img src={branding.logoDataUrl} alt="" width="40" height="32" />}
        <span className="tenant-brand-copy"><strong>{branding.organisationName}</strong><small>Powered by QS-VC</small></span>
    </span>;
}
