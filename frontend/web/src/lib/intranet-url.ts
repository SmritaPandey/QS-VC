export function intranetUrl(value: unknown, portalOrigin?: string): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        if (url.origin === portalOrigin || ['qsvcmeet.com', 'www.qsvcmeet.com'].includes(url.hostname.replace(/\.$/, ''))) return null;
        if (url.pathname === '/') url.pathname = '/app';
        return url.href;
    } catch { return null; }
}
