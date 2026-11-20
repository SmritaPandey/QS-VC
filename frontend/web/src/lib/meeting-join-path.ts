export function meetingJoinPath(input: string, origin: string): string | undefined {
    const value = input.trim();
    const rawUrl = value.match(/https?:\/\/[^\s]+/i)?.[0];
    let code = value;
    const params = new URLSearchParams();
    if (rawUrl) {
        try {
            const url = new URL(rawUrl);
            if (url.origin !== origin) return;
            code = url.pathname.match(/^\/meeting\/([^/]+)(?:\/preview)?\/?$/)?.[1] || '';
            for (const key of ['invite', 'guest']) {
                const credential = url.searchParams.get(key);
                if (credential) params.set(key, credential);
            }
        } catch { return; }
    }
    if (!/^[a-z0-9-]{3,40}$/i.test(code) || (/^QS-S-[0-9A-F]{24}$/i.test(code) && !params.has('invite'))) return;
    return `/meeting/${encodeURIComponent(code.toUpperCase())}/preview${params.size ? `?${params}` : ''}`;
}
