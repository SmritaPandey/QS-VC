/** Only these same-origin pages may receive the desktop session placeholder. */
export function isDesktopSessionPage(value: string, origin: string | undefined, adminAccess: boolean): boolean {
    try {
        const url = new URL(value);
        return url.origin === origin && !url.username && !url.password
            && (/^\/meeting\/[^/]+(\/preview)?\/?$/.test(url.pathname) || (adminAccess && /^\/admin\/?$/.test(url.pathname)));
    } catch { return false; }
}
