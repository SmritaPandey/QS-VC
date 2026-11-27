/**
 * Admin AI Analytics Insights Generator.
 *
 * Generates executive analytics and anomaly reports from meeting activity telemetry.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OpenRouterRateLimitError, OpenRouterResponseError, askOpenRouter, openRouterConfigured } from './openrouter.js';
import { AICache } from './ai/ai-cache.js';
import { z } from 'zod';
import { OpenRouterModelPolicyError } from './ai/free-openrouter-model.js';
import { logger } from './logger.js';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const telemetry = z.object({ activeUsers: count, activeMeetingRecords: count, scheduledMeetings: count, endedMeetings: count }).strict();

const ADMIN_SYSTEM = `You are the QS-VC Senior Telemetry Analyst.
You review conferencing metrics and generate concise, data-driven executive insights.

Guidelines:
1. Describe the supplied account and meeting counts. A snapshot alone cannot establish a trend.
2. Limit observations to these counts. Do not infer latency, adoption, causes or trends.
3. Keep the insight under 4 bullet points.
4. Never invent statistics not provided in the input data.`;

function providerFailureReason(error: unknown): string {
    if (error instanceof OpenRouterModelPolicyError) return 'free_model_required';
    if (error instanceof OpenRouterRateLimitError) return 'rate_limited';
    const status = error instanceof OpenRouterResponseError ? error.status : undefined;
    if (status === 401 || status === 403) return 'provider_access';
    if (status === 402) return 'provider_credits';
    if (status === 404) return 'provider_routing';
    return 'provider_unavailable';
}

export function adminInsightsRouter(authorize: import('express').RequestHandler): Router {
    const router = Router();
    const cache = new AICache(100);
    const pending = new Map<string, Promise<string>>();
    let nextProviderAttempt = 0;
    let providerFailure = 'provider_unavailable';

    router.post(
        '/',
        authorize,
        rateLimit({ windowMs: 60_000, max: 20, keyGenerator: (_req, res) => res.locals.admin.sub,
            message: { error: 'Too many insight requests. Try again in a minute.' }, standardHeaders: true, legacyHeaders: false }),
        async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');

            const stats = telemetry.safeParse(req.body?.stats);
            if (!stats.success) { res.status(400).json({ error: 'Invalid analytics counts.' }); return; }

            const localSnapshot = (reason: string) => {
                const { activeUsers, activeMeetingRecords, scheduledMeetings, endedMeetings } = stats.data;
                const total = BigInt(activeMeetingRecords) + BigInt(scheduledMeetings) + BigInt(endedMeetings);
                return {
                    insights: `${activeUsers} active user accounts. Of ${total} meeting records, ${activeMeetingRecords} are active, ${scheduledMeetings} scheduled and ${endedMeetings} ended. This snapshot alone cannot show a trend.`,
                    reason, source: 'local', timestamp: Date.now(),
                };
            };
            if (!openRouterConfigured()) {
                res.json(localSnapshot(process.env.QSVC_DEPLOYMENT === 'onprem' ? 'disabled' : 'not_configured'));
                return;
            }
            const key = JSON.stringify(stats.data);
            const cached = cache.get(key);
            if (cached) {
                res.json({ insights: cached, source: 'openrouter', timestamp: Date.now() });
                return;
            }
            if (Date.now() < nextProviderAttempt) {
                res.json(localSnapshot(providerFailure));
                return;
            }
            try {
                const prompt = `Current System Telemetry:\n${JSON.stringify(stats.data)}\n\nPlease generate 3-4 bullet point executive insights:`;
                let analysis = pending.get(key);
                if (!analysis) {
                    analysis = askOpenRouter(ADMIN_SYSTEM, prompt, process.env.OPENROUTER_MODEL_ADMIN_INSIGHTS)
                        .then(answer => { cache.set(key, answer, 10 * 60_000); return answer; })
                        .catch(error => {
                            const status = error instanceof OpenRouterResponseError ? error.status : undefined;
                            const reason = providerFailureReason(error);
                            const retryAt = Date.now() + (reason === 'provider_unavailable' ? 15_000 : 60_000);
                            if (retryAt >= nextProviderAttempt) {
                                providerFailure = reason;
                                nextProviderAttempt = retryAt;
                            }
                            logger.warn({ status, reason }, 'OpenRouter admin insights request failed');
                            throw error;
                        })
                        .finally(() => pending.delete(key));
                    pending.set(key, analysis);
                }
                const insights = await analysis;

                res.json({
                    insights, source: 'openrouter',
                    timestamp: Date.now(),
                });
            } catch (error) {
                res.json(localSnapshot(providerFailureReason(error)));
            }
        }
    );

    return router;
}
