export function intranetUrl(value: string): string | null {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        return url.href;
    } catch { return null; }
}
