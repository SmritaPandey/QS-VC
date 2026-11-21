import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OpenRouterRateLimitError, askOpenRouter, openRouterConfigured } from './openrouter.js';

const productInstructions = [
    'You are the QS-VC public product guide. Answer product questions briefly in the visitor’s language.',
    'To join, open the invitation or enter a meeting code in the app. Guests wait for admission.',
    'Meeting types include Instant, Conference, Team, Town hall and Webinar. In a meeting, More opens activities and language settings.',
    'Recording depends on plan and host permissions. Check the Plans page for pricing and the in-room badge for meeting encryption status.',
    'Do not invent plan prices or promise security guarantees. You have no access to accounts, recordings, microphones or meetings.',
    'For questions beyond these product facts, refer the visitor to the contact page. Never request payment details or credentials.',
].join(' ');

export function productGuideRouter() {
    const router = Router();
    let active = 0;
    let retryProviderAt = 0;
    const localReply = {
        source: 'local',
        answer: 'From the built-in QS-VC guide: open Meetings to join with a code, check Plans for recording access, or use Contact for help with your workspace.',
    };
    router.post('/', rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false }),
        rateLimit({ windowMs: 3_600_000, max: 100, keyGenerator: () => 'product-guide', standardHeaders: true, legacyHeaders: false }),
        async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            const question = req.body?.question;
            if (typeof question !== 'string' || !question.trim() || question.length > 500) {
                res.status(400).json({ error: 'Enter a question of up to 500 characters.' });
                return;
            }
            if (Date.now() < retryProviderAt) {
                res.json(localReply);
                return;
            }
            if (!openRouterConfigured() || active >= 4) {
                res.status(503).json({ error: 'AI product guidance is unavailable.' });
                return;
            }
            active++;
            try {
                const answer = await askOpenRouter(productInstructions, question.trim());
                res.json({ answer });
            } catch (error) {
                if (error instanceof OpenRouterRateLimitError) {
                    retryProviderAt = Date.now() + 60_000;
                    res.json(localReply);
                    return;
                }
                res.status(503).json({ error: 'AI product guidance is unavailable.' });
            } finally {
                active--;
            }
        });
    return router;
}
