import { z } from 'zod';

/** Pure helpers for transcript storage and export (unit-tested; no database here). */
export const transcriptBody = z.object({
    startedAt: z.string().datetime(),
    segments: z.array(z.object({
        id: z.string().min(1).max(140),
        speaker: z.string().trim().min(1).max(100),
        language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/),
        text: z.string().trim().min(1).max(2000),
        timestamp: z.number().int().positive(),
    })).max(2000),
    minutes: z.string().max(20000).optional(),
});
export type TranscriptRow = { segment_id: string; speaker: string; language: string; text: string; spoken_at: Date | string };

const pad = (value: number, size = 2) => String(value).padStart(size, '0');
function srtTime(ms: number) {
    const safe = Math.max(0, ms);
    return `${pad(Math.floor(safe / 3_600_000))}:${pad(Math.floor(safe / 60_000) % 60)}:${pad(Math.floor(safe / 1000) % 60)},${pad(safe % 1000, 3)}`;
}

export function transcriptAsText(rows: TranscriptRow[], minutes?: string | null) {
    const lines = rows.map(row => `[${new Date(row.spoken_at).toISOString().slice(11, 19)}] ${row.speaker}: ${row.text}`);
    return (minutes ? `${minutes.trim()}\n\n---\n\nTranscript\n\n` : '') + lines.join('\n') + '\n';
}

/** SubRip subtitles: each segment shown from its time until the next (max 6 s). */
export function transcriptAsSrt(rows: TranscriptRow[]) {
    if (!rows.length) return '';
    const start = new Date(rows[0].spoken_at).getTime();
    return rows.map((row, index) => {
        const from = new Date(row.spoken_at).getTime() - start;
        const next = rows[index + 1] ? new Date(rows[index + 1].spoken_at).getTime() - start : from + 4000;
        const to = Math.min(next, from + 6000);
        return `${index + 1}\n${srtTime(from)} --> ${srtTime(Math.max(to, from + 800))}\n${row.speaker}: ${row.text}\n`;
    }).join('\n');
}
