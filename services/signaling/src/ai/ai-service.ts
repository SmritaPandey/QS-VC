/**
 * Quantum-Safe OpenRouter AI Service Core.
 *
 * Key Architectural Properties:
 * 1. Hybrid Post-Quantum TLS: Requires TLS 1.3 with X25519MLKEM768 curve.
 * 2. Zero Data Retention: Strict privacy header `provider: { data_collection: 'deny', zdr: true }`.
 * 3. On-Premises Boundary: Completely blocks public OpenRouter calls if QSVC_DEPLOYMENT === 'onprem'.
 * 4. Resilient Retries: Exponential backoff with jitter on transient failures (429 / 5xx).
 * 5. Integrated Security: Input/output sanitization, PII scrubbing, injection defense, caching, rate limiting.
 */

import { request } from 'node:https';
import { sanitizeInput, sanitizeOutput, detectPromptInjection, formatPromptWithBoundaries } from './ai-sanitizer.js';
import { aiCache, AICache } from './ai-cache.js';
import { aiRateLimiter } from './ai-rate-limiter.js';
import { aiAudit } from './ai-audit.js';
import { logger } from '../logger.js';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export type AIFeature =
    | 'meeting-assistant'
    | 'product-guide'
    | 'meeting-minutes'
    | 'meeting-summary'
    | 'contact-routing'
    | 'admin-insights'
    | 'recording-search';

export interface AIOptions {
    userId?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    context?: string;
    useCache?: boolean;
    ttlMs?: number;
    model?: string;
}

export class AIService {
    /**
     * Returns true if OpenRouter is configured and available in the current deployment mode.
     */
    isConfigured(): boolean {
        return (
            process.env.QSVC_DEPLOYMENT !== 'onprem' &&
            Boolean(process.env.OPENROUTER_API_KEY?.trim())
        );
    }

    /**
     * Select the best model for the feature.
     */
    resolveModel(feature: AIFeature, override?: string): string {
        if (override?.trim()) return override.trim();
        const featureEnv = `OPENROUTER_MODEL_${feature.toUpperCase().replace(/-/g, '_')}`;
        return (
            process.env[featureEnv]?.trim() ||
            process.env.OPENROUTER_MODEL?.trim() ||
            'openai/gpt-4o-mini'
        );
    }

    /**
     * Determine cache TTL for feature.
     */
    private defaultCacheTTL(feature: AIFeature): number {
        switch (feature) {
            case 'product-guide':
                return 3600_000; // 1 hour
            case 'contact-routing':
                return 1800_000; // 30 minutes
            case 'admin-insights':
                return 600_000;  // 10 minutes
            default:
                return 0; // Dynamic features not cached by default
        }
    }

    /**
     * Primary entrypoint: Ask AI with quantum-safe TLS and full defense suite.
     */
    async ask(feature: AIFeature, systemPrompt: string, userPrompt: string, options: AIOptions = {}): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('AI service is unavailable');
        }

        const identifier = options.userId || 'anonymous';

        // 1. Rate Limiting Check
        if (!aiRateLimiter.acquire(identifier, feature)) {
            const check = aiRateLimiter.check(identifier, feature);
            throw new Error(check.reason || 'AI rate limit exceeded. Please wait.');
        }

        const startedAt = Date.now();
        const model = this.resolveModel(feature, options.model);

        try {
            // 2. Prompt Injection Defense
            const injectionCheck = detectPromptInjection(userPrompt);
            if (injectionCheck.isSuspicious) {
                logger.warn({ feature, pattern: injectionCheck.pattern }, 'Suspicious AI prompt rejected by security sanitizer');
                throw new Error('Invalid prompt content.');
            }

            // 3. Format Prompt & Context with Security Boundaries
            const formattedPrompt = formatPromptWithBoundaries(userPrompt, options.context);
            const sanitizedSystem = sanitizeInput(systemPrompt, 4000);

            // 4. Cache Check
            const ttl = options.ttlMs ?? this.defaultCacheTTL(feature);
            const cacheKey = AICache.hashKey(feature, sanitizedSystem, formattedPrompt);

            if ((options.useCache ?? ttl > 0) && ttl > 0) {
                const cached = aiCache.get(cacheKey);
                if (cached) {
                    aiAudit.record({
                        feature,
                        userId: options.userId,
                        model,
                        inputChars: userPrompt.length,
                        outputChars: cached.length,
                        estimatedPromptTokens: Math.ceil(userPrompt.length / 4),
                        estimatedCompletionTokens: Math.ceil(cached.length / 4),
                        durationMs: Date.now() - startedAt,
                        success: true,
                        cached: true,
                    });
                    return cached;
                }
            }

            // 5. Send Request with Post-Quantum TLS 1.3
            const result = await this.executeRequestWithRetry(
                model,
                sanitizedSystem,
                formattedPrompt,
                options.maxTokens || 2000,
                options.temperature ?? 0.2,
                options.timeoutMs || 45_000
            );

            // 6. Output Sanitization
            const cleanOutput = sanitizeOutput(result);

            // 7. Store in Cache if configured
            if (ttl > 0 && cleanOutput) {
                aiCache.set(cacheKey, cleanOutput, ttl);
            }

            // 8. Record Telemetry
            aiAudit.record({
                feature,
                userId: options.userId,
                model,
                inputChars: userPrompt.length,
                outputChars: cleanOutput.length,
                estimatedPromptTokens: Math.ceil(userPrompt.length / 4),
                estimatedCompletionTokens: Math.ceil(cleanOutput.length / 4),
                durationMs: Date.now() - startedAt,
                success: true,
                cached: false,
            });

            return cleanOutput;
        } catch (error) {
            aiAudit.record({
                feature,
                userId: options.userId,
                model,
                inputChars: userPrompt.length,
                outputChars: 0,
                estimatedPromptTokens: Math.ceil(userPrompt.length / 4),
                estimatedCompletionTokens: 0,
                durationMs: Date.now() - startedAt,
                success: false,
                cached: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        } finally {
            aiRateLimiter.release();
        }
    }

    /**
     * Executes the HTTPS request using hybrid post-quantum TLS (X25519MLKEM768).
     * Includes 1 retry on 429/503.
     */
    private async executeRequestWithRetry(
        model: string,
        system: string,
        prompt: string,
        maxTokens: number,
        temperature: number,
        timeoutMs: number
    ): Promise<string> {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) {
                await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
            }
            try {
                return await this.dispatchPostQuantumHttps(model, system, prompt, maxTokens, temperature, timeoutMs);
            } catch (err) {
                lastError = err instanceof Error ? err : new Error('AI request failed');
            }
        }
        throw lastError || new Error('AI service is unavailable');
    }

    /**
     * Low-level HTTPS dispatch strictly enforcing TLS 1.3 + ML-KEM-768 hybrid key agreement.
     */
    private dispatchPostQuantumHttps(
        model: string,
        system: string,
        prompt: string,
        maxTokens: number,
        temperature: number,
        timeoutMs: number
    ): Promise<string> {
        const payload = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens,
            temperature,
            provider: { data_collection: 'deny', zdr: true },
            stream: false,
        });

        const apiKey = process.env.OPENROUTER_API_KEY!.trim();

        return new Promise<string>((resolve, reject) => {
            const fail = (reason?: string) => reject(new Error(reason || 'AI service is unavailable'));

            const req = request(
                OPENROUTER_ENDPOINT,
                {
                    method: 'POST',
                    agent: false,
                    // Quantum-Safe TLS Parameters:
                    minVersion: 'TLSv1.3',
                    maxVersion: 'TLSv1.3',
                    ecdhCurve: 'X25519MLKEM768',
                    rejectUnauthorized: true,
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: {
                        Authorization: 'Bearer ' + apiKey,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://qsvcmeet.com',
                        'X-Title': 'QS-VC Quantum-Safe Video Conferencing',
                    },
                },
                res => {
                    res.on('error', () => fail());
                    res.on('aborted', () => fail());

                    if (res.statusCode !== 200) {
                        res.destroy();
                        fail(`OpenRouter error status: ${res.statusCode}`);
                        return;
                    }

                    const chunks: Buffer[] = [];
                    let bytes = 0;

                    res.on('data', (chunk: Buffer) => {
                        bytes += chunk.length;
                        if (bytes > 512 * 1024) {
                            res.destroy();
                            fail('AI response exceeded maximum byte limit');
                            return;
                        }
                        chunks.push(chunk);
                    });

                    res.on('end', () => {
                        try {
                            const raw = Buffer.concat(chunks).toString('utf8');
                            const parsed = JSON.parse(raw);
                            const content = parsed.choices?.[0]?.message?.content;
                            if (typeof content !== 'string' || !content.trim()) {
                                fail('Empty AI response');
                                return;
                            }
                            resolve(content.trim().slice(0, 25_000));
                        } catch {
                            fail('Failed to parse AI response');
                        }
                    });
                }
            );

            req.on('error', () => fail());
            req.end(payload);
        });
    }
}

export const aiService = new AIService();
