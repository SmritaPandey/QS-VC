import type { CaptionEntry } from '../components/CaptionOverlay';
import { LANGUAGES } from './realtime-translation';

export interface TranscriptEntry { id: string; peerId?: string; speaker: string; language: string; text: string; timestamp: number }

/** Replace a caption with the same id (interim → final → translated) or append; keep the last 40. */
export function upsertCaption(list: CaptionEntry[], entry: CaptionEntry): CaptionEntry[] {
    const index = list.findIndex(item => item.id === entry.id);
    if (index === -1) return [...list.slice(-39), entry];
    // Never let a late interim overwrite a finished line.
    if (list[index].isFinal && !entry.isFinal) return list;
    const next = list.slice();
    next[index] = entry;
    return next;
}

/**
 * Options for "I speak". With server recognition, only languages the speech service reports;
 * otherwise the browser-recognition languages. The current choice is always kept selectable.
 */
export function captionLanguageOptions(serverLanguages: { code: string; name: string }[] | null, current: string): { code: string; label: string }[] {
    const label = (code: string, fallback: string) => {
        const info = LANGUAGES.find(item => item.code === code) || LANGUAGES.find(item => item.code.split('-')[0] === code.split('-')[0]);
        return info ? `${info.nativeName} · ${info.name}` : fallback;
    };
    let options: { code: string; label: string }[];
    if (serverLanguages) {
        options = serverLanguages.map(language => {
            const regional = LANGUAGES.find(item => item.code.split('-')[0] === language.code && item.code.endsWith('-IN'))
                || LANGUAGES.find(item => item.code.split('-')[0] === language.code);
            return { code: regional?.code || language.code, label: label(language.code, language.name) };
        });
    } else {
        options = LANGUAGES.filter(item => item.sttSupported).map(item => ({ code: item.code, label: `${item.nativeName} · ${item.name}` }));
    }
    const seen = new Set<string>();
    options = options.filter(option => !seen.has(option.code) && seen.add(option.code));
    if (!options.some(option => option.code === current)) options.unshift({ code: current, label: label(current, current) });
    return options;
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');
const clock = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
function srtTime(ms: number) {
    const safe = Math.max(0, Math.round(ms));
    return `${pad(Math.floor(safe / 3_600_000))}:${pad(Math.floor(safe / 60_000) % 60)}:${pad(Math.floor(safe / 1000) % 60)},${pad(safe % 1000, 3)}`;
}

export function transcriptToText(entries: TranscriptEntry[], minutes = ''): string {
    const body = entries.map(entry => `[${clock(entry.timestamp)}] ${entry.speaker}: ${entry.text}`).join('\n');
    return (minutes.trim() ? `${minutes.trim()}\n\n---\n\nTranscript\n\n` : '') + body + '\n';
}

export function transcriptToSrt(entries: TranscriptEntry[]): string {
    if (!entries.length) return '';
    const start = entries[0].timestamp;
    return entries.map((entry, index) => {
        const from = entry.timestamp - start;
        const next = entries[index + 1] ? entries[index + 1].timestamp - start : from + 4000;
        const to = Math.max(Math.min(next, from + 6000), from + 800);
        return `${index + 1}\n${srtTime(from)} --> ${srtTime(to)}\n${entry.speaker}: ${entry.text}\n`;
    }).join('\n');
}

export function downloadText(filename: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename.replace(/[^\w.-]+/g, '-');
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
