/**
 * Admin AI Analytics Insights Generator.
 *
 * Generates executive analytics and anomaly reports from meeting activity telemetry.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { askOpenRouter, openRouterConfigured } from './openrouter.js';
import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const telemetry = z.object({ activeUsers: count, activeMeetingRecords: count, scheduledMeetings: count, endedMeetings: count }).strict();

const ADMIN_SYSTEM = `You are the QS-VC Senior Telemetry Analyst.
You review conferencing metrics and generate concise, data-driven executive insights.

Guidelines:
1. Describe the supplied account and meeting counts. A snapshot alone cannot establish a trend.
2. Highlight any potential bottlenecks (e.g. high latency, low encryption adoption in high-compliance settings).
3. Keep the insight under 4 bullet points.
4. Never invent statistics not provided in the input data.`;

export function adminInsightsRouter(authorize: import('express').RequestHandler): Router {
    const router = Router();

    router.post(
        '/',
        rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }),
        authorize,
        async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');

            if (!openRouterConfigured()) {
                res.status(503).json({ error: 'AI analytics service is not available.' });
                return;
            }

            const stats = telemetry.safeParse(req.body?.stats);
            if (!stats.success) { res.status(400).json({ error: 'Invalid analytics counts.' }); return; }

            try {
                const prompt = `Current System Telemetry:\n${JSON.stringify(stats.data)}\n\nPlease generate 3-4 bullet point executive insights:`;
                const insights = await askOpenRouter(ADMIN_SYSTEM, prompt);

                res.json({
                    insights,
                    timestamp: Date.now(),
                });
            } catch {
                res.status(503).json({ error: 'Failed to generate AI insights.' });
            }
        }
    );

    return router;
}
