import type { TranscriptEntry } from './captions.js';

/**
 * Meeting minutes from a transcript using any OpenAI-compatible chat endpoint
 * (vLLM, Ollama, llama.cpp server, Azure OpenAI, or a hosted provider).
 * Configure: MINUTES_LLM_URL (base, e.g. http://llm:8000/v1), MINUTES_LLM_MODEL, MINUTES_LLM_API_KEY (optional).
 */
export function minutesConfigured() {
    return Boolean(process.env.MINUTES_LLM_URL?.trim() && process.env.MINUTES_LLM_MODEL?.trim());
}

const SYSTEM = `You write meeting minutes from a live-caption transcript. The transcript may contain recognition errors and several languages.
Write in English unless asked otherwise. Use these Markdown sections, and omit a section if there is nothing for it:
## Summary (3-6 bullet points)
## Decisions
## Action items (- [ ] owner: task (due date if said))
## Open questions
Only state what the transcript supports. Never invent names, numbers or dates.`;

export function transcriptText(entries: TranscriptEntry[], maxChars = 60_000): string {
    const lines = entries.map(entry => `[${new Date(entry.timestamp).toISOString().slice(11, 19)}] ${entry.speaker} (${entry.language}): ${entry.text}`);
    let text = lines.join('\n');
    // Keep the most recent part if the meeting was very long.
    if (text.length > maxChars) text = '…\n' + text.slice(text.length - maxChars);
    return text;
}

export async function generateMinutes(entries: TranscriptEntry[], language = 'English'): Promise<string> {
    if (!minutesConfigured()) throw new Error('Meeting minutes are not configured on this server');
    if (!entries.length) throw new Error('There is no transcript yet. Turn on captions and speak first.');
    const base = process.env.MINUTES_LLM_URL!.trim().replace(/\/$/, '');
    const key = process.env.MINUTES_LLM_API_KEY?.trim();
    let response: Response;
    try {
        response = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify({
                model: process.env.MINUTES_LLM_MODEL!.trim(),
                temperature: 0.2,
                max_tokens: 1500,
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: `Write the minutes in ${language.replace(/[^\p{L} ()-]/gu, '').slice(0, 40) || 'English'}.\n\nTranscript:\n${transcriptText(entries)}` },
                ],
            }),
            signal: AbortSignal.timeout(Number(process.env.MINUTES_TIMEOUT_MS) || 120_000),
            redirect: 'error',
        });
    } catch { throw new Error('Minutes service is unavailable'); }
    if (!response.ok) throw new Error('Minutes service rejected the request');
    const body = await response.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Minutes service returned no text');
    return content.trim().slice(0, 20_000);
}
