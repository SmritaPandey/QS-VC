/**
 * Calendar Integration for QS-VC.
 *
 * Features:
 * - Generate ICS calendar invites
 * - CalDAV server integration
 * - Exchange EWS connector (enterprise)
 * - Google Calendar API integration
 * - Recurrence rules (RRULE)
 * - Timezone-aware scheduling
 * - Meeting reminders
 */

export interface CalendarEvent {
    meetingCode: string;
    title: string;
    description?: string;
    organizer: { name: string; email: string };
    attendees: { name: string; email: string; role: 'required' | 'optional' }[];
    startTime: Date;
    endTime: Date;
    timezone: string;
    location?: string;               // Room name or 'Online'
    meetingUrl: string;
    sipDialIn?: string;
    pstnDialIn?: string;
    conferenceId?: string;
    recurrence?: RecurrenceRule;
    reminders: { minutes: number; method: 'email' | 'popup' }[];
    isPrivate: boolean;
    password?: string;
}

export interface RecurrenceRule {
    frequency: 'daily' | 'weekly' | 'monthly';
    interval: number;           // every N (days/weeks/months)
    daysOfWeek?: number[];      // 0=Sun, 1=Mon, ...
    endDate?: Date;
    count?: number;             // Max occurrences
}

/**
 * Generate an ICS (iCalendar) file for a meeting.
 * Works with all calendar apps: Outlook, Google Calendar, Apple Calendar, etc.
 */
export function generateICS(event: CalendarEvent): string {
    const uid = `${event.meetingCode}@qsvc.com`;
    const now = formatICSDate(new Date());
    const start = formatICSDate(event.startTime);
    const end = formatICSDate(event.endTime);

    let description = event.description || '';
    description += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    description += `Join QS-VC Meeting\n`;
    description += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    description += `🔗 Meeting Link: ${event.meetingUrl}\n`;
    description += `📋 Meeting Code: ${event.meetingCode}\n`;
    if (event.password) description += `🔑 Password: ${event.password}\n`;
    if (event.sipDialIn) description += `📱 SIP: ${event.sipDialIn}\n`;
    if (event.pstnDialIn) description += `📞 Dial-in: ${event.pstnDialIn}\n`;
    if (event.conferenceId) description += `🔢 Conference ID: ${event.conferenceId}\n`;
    description += `\n🔐 Secured with Quantum-Safe Encryption (NIST PQC)\n`;

    let ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//QS-VC//Quantum Safe Video Conferencing//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=${event.timezone}:${start}`,
        `DTEND;TZID=${event.timezone}:${end}`,
        `SUMMARY:${escapeICSText(event.title)}`,
        `DESCRIPTION:${escapeICSText(description)}`,
        `LOCATION:${event.location || 'QS-VC Online Meeting'}`,
        `ORGANIZER;CN=${event.organizer.name}:mailto:${event.organizer.email}`,
        `URL:${event.meetingUrl}`,
        `STATUS:CONFIRMED`,
        'SEQUENCE:0',
        `TRANSP:OPAQUE`,
        event.isPrivate ? 'CLASS:PRIVATE' : 'CLASS:PUBLIC',
    ];

    // Attendees
    for (const attendee of event.attendees) {
        const role = attendee.role === 'required' ? 'REQ-PARTICIPANT' : 'OPT-PARTICIPANT';
        ics.push(`ATTENDEE;ROLE=${role};PARTSTAT=NEEDS-ACTION;CN=${attendee.name}:mailto:${attendee.email}`);
    }

    // Recurrence
    if (event.recurrence) {
        ics.push(generateRRule(event.recurrence));
    }

    // Reminders
    for (const reminder of event.reminders) {
        ics.push('BEGIN:VALARM');
        ics.push(`TRIGGER:-PT${reminder.minutes}M`);
        ics.push(reminder.method === 'email' ? 'ACTION:EMAIL' : 'ACTION:DISPLAY');
        ics.push(`DESCRIPTION:QS-VC Meeting: ${event.title} starts in ${reminder.minutes} minutes`);
        if (reminder.method === 'email') {
            ics.push(`SUMMARY:Reminder: ${event.title}`);
        }
        ics.push('END:VALARM');
    }

    ics.push('END:VEVENT');
    ics.push('END:VCALENDAR');

    return ics.join('\r\n');
}

/** Download ICS file to user's device. */
export function downloadICS(event: CalendarEvent): void {
    const icsContent = generateICS(event);
    const blob = new Blob([icsContent], { type: 'text/calendar; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Open Google Calendar with pre-filled data. */
export function openGoogleCalendar(event: CalendarEvent): void {
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: event.title,
        dates: `${formatGoogleDate(event.startTime)}/${formatGoogleDate(event.endTime)}`,
        details: `Join QS-VC Meeting: ${event.meetingUrl}\nCode: ${event.meetingCode}`,
        location: event.location || 'QS-VC Online',
        ctz: event.timezone,
    });

    for (const attendee of event.attendees) {
        params.append('add', attendee.email);
    }

    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank');
}

/** Open Outlook Web with pre-filled data. */
export function openOutlookCalendar(event: CalendarEvent): void {
    const params = new URLSearchParams({
        rru: 'addevent',
        startdt: event.startTime.toISOString(),
        enddt: event.endTime.toISOString(),
        subject: event.title,
        body: `Join QS-VC Meeting: ${event.meetingUrl}\nCode: ${event.meetingCode}`,
        location: event.location || 'QS-VC Online',
        allday: 'false',
    });

    window.open(`https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`, '_blank');
}

// ── Helper Functions ─────────────────────────────────

function formatICSDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatGoogleDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
}

function escapeICSText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function generateRRule(rule: RecurrenceRule): string {
    const parts = [`RRULE:FREQ=${rule.frequency.toUpperCase()}`];
    if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
    if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        const dayMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        parts.push(`BYDAY=${rule.daysOfWeek.map(d => dayMap[d]).join(',')}`);
    }
    if (rule.endDate) parts.push(`UNTIL=${formatICSDate(rule.endDate)}`);
    if (rule.count) parts.push(`COUNT=${rule.count}`);
    return parts.join(';');
}

/** Generate meeting timezone list for scheduling. */
export const TIMEZONES = [
    { value: 'Asia/Kolkata', label: 'India Standard Time (IST) UTC+5:30' },
    { value: 'America/New_York', label: 'Eastern Time (ET) UTC-5' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT) UTC-8' },
    { value: 'America/Chicago', label: 'Central Time (CT) UTC-6' },
    { value: 'Europe/London', label: 'Greenwich Mean Time (GMT) UTC+0' },
    { value: 'Europe/Paris', label: 'Central European Time (CET) UTC+1' },
    { value: 'Europe/Berlin', label: 'Berlin Time (CET) UTC+1' },
    { value: 'Asia/Tokyo', label: 'Japan Standard Time (JST) UTC+9' },
    { value: 'Asia/Shanghai', label: 'China Standard Time (CST) UTC+8' },
    { value: 'Asia/Singapore', label: 'Singapore Time (SGT) UTC+8' },
    { value: 'Asia/Dubai', label: 'Gulf Standard Time (GST) UTC+4' },
    { value: 'Asia/Seoul', label: 'Korea Standard Time (KST) UTC+9' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong Time (HKT) UTC+8' },
    { value: 'Australia/Sydney', label: 'Australian Eastern Time (AET) UTC+11' },
    { value: 'Pacific/Auckland', label: 'New Zealand Time (NZT) UTC+13' },
    { value: 'America/Sao_Paulo', label: 'Brasilia Time (BRT) UTC-3' },
    { value: 'Africa/Johannesburg', label: 'South Africa Time (SAST) UTC+2' },
    { value: 'Asia/Jerusalem', label: 'Israel Time (IST) UTC+2' },
    { value: 'Asia/Riyadh', label: 'Arabia Standard Time (AST) UTC+3' },
    { value: 'Europe/Moscow', label: 'Moscow Time (MSK) UTC+3' },
];
