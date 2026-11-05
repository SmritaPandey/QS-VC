async function copyInviteLink(url: string) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            return;
        }
    } catch { /* Try the browser's local copy fallback. */ }

    const input = document.createElement('textarea');
    input.value = url;
    input.readOnly = true;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Could not copy the meeting link.');
}

export async function shareMeetingInvite(title: string, meetingCode: string, url: string): Promise<'shared' | 'copied' | 'cancelled'> {
    if (typeof navigator.share === 'function') {
        try {
            await navigator.share({ title, text: `Join my meeting with code ${meetingCode}.`, url });
            return 'shared';
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
        }
    }
    await copyInviteLink(url);
    return 'copied';
}
