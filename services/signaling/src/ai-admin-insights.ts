/**
 * Admin AI Analytics Insights Generator.
 *
 * Generates executive analytics and anomaly reports from meeting activity telemetry.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OpenRouterRateLimitError, askOpenRouter, openRouterConfigured } from './openrouter.js';
import { AICache } from './ai/ai-cache.js';
import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const telemetry = z.object({ activeUsers: count, activeMeetingRecords: count, scheduledMeetings: count, endedMeetings: count }).strict();

const ADMIN_SYSTEM = `You are the QS-VC Senior Telemetry Analyst.
You review conferencing metrics and generate concise, data-driven executive insights.

Guidelines:
1. Describe the supplied account and meeting counts. A snapshot alone cannot establish a trend.
2. Limit observations to these counts. Do not infer latency, adoption, causes or trends.
3. Keep the insight under 4 bullet points.
4. Never invent statistics not provided in the input data.`;

export function adminInsightsRouter(authorize: import('express').RequestHandler): Router {
    const router = Router();
    const cache = new AICache(100);
    const pending = new Map<string, Promise<string>>();
    let nextProviderAttempt = 0;

    router.post(
        '/',
        authorize,
        rateLimit({ windowMs: 60_000, max: 20, keyGenerator: (_req, res) => res.locals.admin.sub,
            message: { error: 'Too many insight requests. Try again in a minute.' }, standardHeaders: true, legacyHeaders: false }),
        async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');

            if (!openRouterConfigured()) {
                res.status(503).json({ error: 'AI analytics service is not available.' });
                return;
            }

            const stats = telemetry.safeParse(req.body?.stats);
            if (!stats.success) { res.status(400).json({ error: 'Invalid analytics counts.' }); return; }

            const key = JSON.stringify(stats.data);
            const cached = cache.get(key);
            if (cached) {
                res.json({ insights: cached, source: 'openrouter', timestamp: Date.now() });
                return;
            }
            const localSnapshot = () => {
                const { activeMeetingRecords, scheduledMeetings, endedMeetings } = stats.data;
                return {
                    insights: `Local analysis · OpenRouter is rate-limited. The dashboard reports ${activeMeetingRecords} active meeting records, ${scheduledMeetings} scheduled meetings and ${endedMeetings} ended meetings. This snapshot alone cannot show a trend.`,
                    source: 'local', timestamp: Date.now(),
                };
            };
            if (Date.now() < nextProviderAttempt) {
                res.json(localSnapshot());
                return;
            }
            try {
                const prompt = `Current System Telemetry:\n${JSON.stringify(stats.data)}\n\nPlease generate 3-4 bullet point executive insights:`;
                let analysis = pending.get(key);
                if (!analysis) {
                    analysis = askOpenRouter(ADMIN_SYSTEM, prompt)
                        .then(answer => { cache.set(key, answer, 10 * 60_000); return answer; })
                        .finally(() => pending.delete(key));
                    pending.set(key, analysis);
                }
                const insights = await analysis;

                res.json({
                    insights, source: 'openrouter',
                    timestamp: Date.now(),
                });
            } catch (error) {
                if (error instanceof OpenRouterRateLimitError) {
                    nextProviderAttempt = Date.now() + 60_000;
                    res.json(localSnapshot());
                    return;
                }
                res.status(503).json({ error: 'Failed to generate AI insights.' });
            }
        }
    );

    return router;
}
