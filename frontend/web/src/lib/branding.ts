import { useEffect, useState } from 'react';
export type OrganisationBranding = { organisationName: string; logoDataUrl: string | null; accent: string };
export const DEFAULT_BRANDING: OrganisationBranding = { organisationName: 'QS-VC', logoDataUrl: null, accent: '#006d77' };
const base = (import.meta.env.VITE_API_URL || import.meta.env.VITE_MEETING_URL || '').replace(/\/+$/, '');
export const BRANDING_API = `${base.endsWith('/api/meetings') ? base : `${base}/api/meetings`}/branding`;
export function useMeetingBranding(meetingCode?: string): OrganisationBranding {
    const [branding, setBranding] = useState(DEFAULT_BRANDING);
    useEffect(() => {
        setBranding(DEFAULT_BRANDING);
        if (!meetingCode) return;
        const controller = new AbortController();
        const url = `${BRANDING_API.replace(/\/branding$/, '')}/code/${encodeURIComponent(meetingCode)}/branding`;
        void fetch(url, { signal: controller.signal, cache: 'no-store' }).then(async response => {
            if (!response.ok) return;
            const value = await response.json();
            if (!controller.signal.aborted) setBranding(value);
        }).catch(() => {});
        return () => controller.abort();
    }, [meetingCode]);
    return branding;
}
/** Re-encode local raster uploads, removing metadata and bounding both dimensions and stored size. */
export async function prepareBrandLogo(file: File): Promise<string> {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image under 2 MB.');
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, 256 / bitmap.width, 128 / bitmap.height);
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d'); if (!context) throw new Error('Logo preparation is unavailable in this browser.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const value = canvas.toDataURL('image/png');
        if (value.length > 65558) throw new Error('This logo has too much image detail. Choose a simpler or smaller image.');
        return value;
    } finally { bitmap.close(); }
}
