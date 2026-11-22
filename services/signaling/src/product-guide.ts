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
    const pending = new Map<string, Promise<string>>();
    const providerAttempts: number[] = [];
    let retryProviderAt = 0;
    const localReply = {
        source: 'local',
        answer: 'From the built-in QS-VC guide: open Meetings to join with a code, check Plans for recording access, or use Contact for help with your workspace.',
    };
    router.post('/', rateLimit({ windowMs: 60_000, max: 20, message: { error: 'Too many guide requests. Try again in a minute.' }, standardHeaders: true, legacyHeaders: false }),
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
            if (!openRouterConfigured()) {
                res.status(503).json({ error: 'AI product guidance is unavailable.' });
                return;
            }
            const prompt = question.trim();
            const now = Date.now();
            while (providerAttempts.length && providerAttempts[0] <= now - 3_600_000) providerAttempts.shift();
            try {
                let completion = pending.get(prompt);
                if (!completion) {
                    if (pending.size >= 4 || providerAttempts.length >= 100) {
                        res.json(localReply);
                        return;
                    }
                    providerAttempts.push(now);
                    completion = askOpenRouter(productInstructions, prompt).finally(() => pending.delete(prompt));
                    pending.set(prompt, completion);
                }
                const answer = await completion;
                res.json({ answer });
            } catch (error) {
                if (error instanceof OpenRouterRateLimitError) {
                    retryProviderAt = Date.now() + 60_000;
                    res.json(localReply);
                    return;
                }
                res.status(503).json({ error: 'AI product guidance is unavailable.' });
            }
        });
    return router;
}
