import { request } from 'node:https';
import { aiService, AIFeature, AIOptions } from './ai/index.js';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const unavailable = () => new Error('AI service is unavailable');
let pending = 0;

export function openRouterConfigured(): boolean {
    return process.env.QSVC_DEPLOYMENT !== 'onprem' && Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/**
 * Direct post-quantum OpenRouter call enforcing X25519MLKEM768 hybrid TLS 1.3 key agreement.
 * Maintained for high-performance direct paths and exact backward compatibility.
 */
export async function askOpenRouter(system: string, prompt: string, modelOverride?: string): Promise<string> {
    if (!openRouterConfigured() || pending >= 16 || !prompt.trim() || prompt.length > 65_536) throw unavailable();
    const payload = JSON.stringify({
        model: modelOverride?.trim() || process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        max_tokens: 2000,
        provider: { data_collection: 'deny', zdr: true },
        stream: false,
    });
    pending++;
    try {
        return await new Promise<string>((resolve, reject) => {
            const fail = () => reject(unavailable());
            const req = request(endpoint, {
                method: 'POST', agent: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
                ecdhCurve: 'X25519MLKEM768', rejectUnauthorized: true,
                signal: AbortSignal.timeout(45_000),
                headers: { Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY!.trim(), 'Content-Type': 'application/json' },
            }, res => {
                res.on('error', fail);
                res.on('aborted', fail);
                if (res.statusCode !== 200) { res.destroy(); fail(); return; }
                const chunks: Buffer[] = [];
                let bytes = 0;
                res.on('data', (chunk: Buffer) => {
                    bytes += chunk.length;
                    if (bytes > 512 * 1024) { res.destroy(); fail(); return; }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    try {
                        const content = JSON.parse(Buffer.concat(chunks).toString('utf8')).choices?.[0]?.message?.content;
                        if (typeof content !== 'string' || !content.trim()) { fail(); return; }
                        resolve(content.trim().slice(0, 20_000));
                    } catch { fail(); }
                });
            });
            req.on('error', fail);
            req.end(payload);
        });
    } catch { throw unavailable(); }
    finally { pending--; }
}

/**
 * Advanced quantum-safe AI invocation with sanitization, caching, and rate limiting.
 */
export async function askAI(feature: AIFeature, system: string, prompt: string, options?: AIOptions): Promise<string> {
    return aiService.ask(feature, system, prompt, options);
}

export * from './ai/index.js';
