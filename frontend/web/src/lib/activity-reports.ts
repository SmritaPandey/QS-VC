import { downloadText } from './caption-stream';

interface PollReportEntry { question: string; closed: boolean; options: string[]; counts: number[] }
interface QuestionReportEntry { text: string; authorName: string; answer?: string; voters: string[] }

function csv(rows: (string | number)[][]) {
    return rows.map(row => row.map(value => {
        const text = String(value);
        const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(text) ? "'" + text : text;
        return '"' + safe.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
}

export function pollReport(polls: PollReportEntry[]) {
    return csv([['Question', 'Status', 'Option', 'Votes'], ...polls.flatMap(poll =>
        poll.options.map((option, index) => [poll.question, poll.closed ? 'Closed' : 'Open', option, poll.counts[index]]))]);
}

export function questionReport(questions: QuestionReportEntry[]) {
    return csv([['Question', 'Asked by', 'Helpful votes', 'Answer'], ...questions.map(item =>
        [item.text, item.authorName, item.voters.length, item.answer ?? ''])]);
}

export function downloadReport(name: string, report: string) {
    downloadText(name, '\uFEFF' + report, 'text/csv;charset=utf-8');
}
