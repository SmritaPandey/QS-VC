export interface ProductReply { text: string; link?: { to: string; label: string } }

/** Product guidance only; no meeting access, model calls or message storage. */
export function productReply(question: string): ProductReply {
    const text = question.toLowerCase();
    if (/\b(whiteboard|poll|polls|questions|notes|files|activities)\b/.test(text)) return { text: 'Open More, then Activities in your meeting for a shared whiteboard, polls, Q&A, notes and small files. Supported files are limited to 32 KB. Save notes and files before the room closes; these are live-room tools.', link: { to: '/app', label: 'Open meeting app' } };
    if (/\b(record|recording|recordings|transcript|transcripts)\b/.test(text)) return { text: 'Recording is not currently available. Paid recording is planned; storage and retention terms need confirmation.', link: { to: '/pricing', label: 'Review plans' } };
    if (/\b(quantum|encryption|encrypted|security|secure|privacy)\b/.test(text)) return { text: 'Quantum-safe security is part of QS-VC’s design for the long-term privacy of conversations. Contact the team to review protection and deployment requirements for your organisation.', link: { to: '/contact', label: 'Discuss your requirements' } };
    if (/\b(intranet|offline|vpn|hosting|hosted|network|premise|premises)\b/.test(text)) return { text: 'Organisation-hosted meetings need a review of your local network and remote-access needs. Offline operation requires separate validation.', link: { to: '/contact?interest=Enterprise', label: 'Talk about organisation hosting' } };
    if (/\b(language|languages|translate|translation|translated|caption|captions|hindi|english|telugu|japanese|chinese|spanish)\b/.test(text)) return { text: 'Open Language beside the camera controls in your meeting. Choose captions and available translated audio independently. Languages and voices depend on your meeting setup and device.' };
    if (/\b(plan|plans|price|prices|pricing|cost|paid|free|subscription)\b/.test(text)) return { text: 'The Plans page shows proposed rates and inclusions. Confirm current availability and commercial terms with the team before choosing a plan.', link: { to: '/pricing', label: 'Explore plans' } };
    if (/\b(join|meeting|invitation|invite|code|start|schedule)\b/.test(text)) return { text: 'Open an invitation link or enter your meeting code in the app. Check your display name, camera and microphone before joining.', link: { to: '/app', label: 'Open meeting app' } };
    return { text: 'I can help with joining, languages, plans and organisation hosting. For anything else, send the team your question through the contact form.', link: { to: '/contact', label: 'Contact the team' } };
}
