/**
 * Admin AI Analytics Insights Generator.
 *
 * Generates executive analytics and anomaly reports from meeting activity telemetry.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { askOpenRouter, openRouterConfigured } from './openrouter.js';
import { sanitizeInput } from './ai/ai-sanitizer.js';

export interface AdminAnalyticsData {
    activeRooms: number;
    totalParticipants: number;
    e2eeRoomsCount: number;
    averageLatencyMs: number;
    captionUsersCount: number;
    recordingSessionsCount: number;
    recentPeakTime?: string;
}

const ADMIN_SYSTEM = `You are the QS-VC Senior Telemetry Analyst.
You review conferencing metrics and generate concise, data-driven executive insights.

Guidelines:
1. Focus on: Post-quantum E2EE adoption rate, system health & latency, and feature usage trends (captions, recording).
2. Highlight any potential bottlenecks (e.g. high latency, low encryption adoption in high-compliance settings).
3. Keep the insight under 4 bullet points.
4. Never invent statistics not provided in the input data.`;

export function adminInsightsRouter(verifyAuth?: (token: string) => Promise<any>): Router {
    const router = Router();

    router.post(
        '/',
        rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }),
        async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');

            // Authenticate admin request
            const authHeader = req.headers.authorization;
            if (verifyAuth && (!authHeader || !authHeader.startsWith('Bearer '))) {
                res.status(401).json({ error: 'Administrator authentication required.' });
                return;
            }

            if (!openRouterConfigured()) {
                res.status(503).json({ error: 'AI analytics service is not available.' });
                return;
            }

            const stats: AdminAnalyticsData = req.body?.stats || {};
            const cleanSummary = sanitizeInput(JSON.stringify(stats), 2000);

            try {
                const prompt = `Current System Telemetry:\n${cleanSummary}\n\nPlease generate 3-4 bullet point executive insights:`;
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
