/**
 * Meeting security code: a short number derived from every participant's ML-DSA-87 identity key.
 * Everyone in the meeting sees the same code only if nobody's keys were swapped in transit — the
 * signaling server relays keys, so comparing the code out loud detects a man-in-the-middle.
 */
export async function meetingSecurityCode(meetingCode: string, identities: Array<{ peerId: string; signingPublicKey: string }>): Promise<string> {
    const lines = identities.map(({ peerId, signingPublicKey }) => `${peerId}:${signingPublicKey}`).sort();
    const input = new TextEncoder().encode(`QS-VC-SECURITY-CODE:v1|${meetingCode}|${lines.join('|')}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    // 4 groups of 5 digits (≈66 bits), easy to read aloud.
    const groups: string[] = [];
    for (let i = 0; i < 4; i++) {
        const value = ((digest[i * 4] << 24) | (digest[i * 4 + 1] << 16) | (digest[i * 4 + 2] << 8) | digest[i * 4 + 3]) >>> 0;
        groups.push(String(value % 100000).padStart(5, '0'));
    }
    return groups.join(' ');
}
