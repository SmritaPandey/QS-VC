export function isOnlineTestWorkspace(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' && !url.username && !url.password
            && ['qsvcmeet.com', 'www.qsvcmeet.com'].includes(url.hostname.replace(/\.$/, '').toLowerCase());
    } catch { return false; }
}

export function intranetUrl(value: unknown, portalOrigin?: string, allowOnlineDemo = false): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        const onlineDemoHost = isOnlineTestWorkspace(value);
        if (onlineDemoHost) {
            if (!allowOnlineDemo) return null;
            if (url.pathname === '/') url.pathname = '/app';
            return url.href;
        }
        if (url.origin === portalOrigin) return null;
        if (url.pathname === '/') url.pathname = '/app';
        return url.href;
    } catch { return null; }
}
