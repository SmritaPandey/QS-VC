export interface ProductReply { text: string; link?: { to: string; label: string } }

/** Product guidance only; no meeting access, model calls or message storage. */
export function productReply(question: string): ProductReply {
    const text = question.toLowerCase();
    if (/\b(whiteboard|poll|polls|questions|notes|files|activities)\b/.test(text)) return { text: 'Open More, then Activities in your meeting for a shared whiteboard, polls, Q&A, notes and small files. Supported files are limited to 32 KB. Save notes and files before the room closes; these are live-room tools.', link: { to: '/app', label: 'Open meeting app' } };
    if (/\b(record|recording|recordings|transcript|transcripts)\b/.test(text)) return { text: 'Eligible signed-in hosts can record where their workspace and meeting allow it. Check the plans for recording availability.', link: { to: '/pricing', label: 'Review plans' } };
    if (/\b(quantum|encryption|encrypted|security|secure|privacy)\b/.test(text)) return { text: 'QS-VC supports end-to-end encryption with NIST-standardised post-quantum protection. Open the security badge in your meeting to check its protection and compare the security code with other participants.', link: { to: '/contact', label: 'Ask about meeting security' } };
    if (/\b(intranet|offline|vpn|hosting|hosted|network|premise|premises)\b/.test(text)) return { text: 'Ask us about a private workspace, remote access and which features can work offline.', link: { to: '/contact?interest=Enterprise', label: 'Talk about organisation hosting' } };
    if (/\b(language|languages|translate|translation|translated|caption|captions|hindi|english|telugu|japanese|chinese|spanish)\b/.test(text)) return { text: 'Open Language beside the camera controls in your meeting. Choose captions and available translated audio independently. Languages and voices depend on your meeting setup and device.' };
    if (/\b(plan|plans|price|prices|pricing|cost|paid|free|subscription)\b/.test(text)) return { text: 'Compare plans and prices on the Plans page. Checkout shows your total and renewal terms before you approve payment.', link: { to: '/pricing', label: 'Explore plans' } };
    if (/\b(join|meeting|invitation|invite|code|start|schedule)\b/.test(text)) return { text: 'Open an invitation link or enter your meeting code in the app. Check your display name, camera and microphone before joining.', link: { to: '/app', label: 'Open meeting app' } };
    return { text: 'I can help with joining, languages, plans and organisation hosting. For anything else, send the team your question through the contact form.', link: { to: '/contact', label: 'Contact the team' } };
}
