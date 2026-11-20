/**
 * Contact Query AI Classifier & Assistant.
 *
 * Analyzes visitor inquiries from the public Contact page, suggests fast solutions,
 * and categorizes them for the support/sales team without leaking confidential info.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { askOpenRouter, openRouterConfigured } from './openrouter.js';
import { sanitizeInput, detectPromptInjection } from './ai/ai-sanitizer.js';

const CONTACT_SYSTEM = `You are the QS-VC Contact Concierge.
You assist visitors who have questions about QS-VC (Quantum-Safe Video Conferencing).

Categories:
- "sales": Pricing, enterprise licenses, volume discounts, demo requests.
- "support": Connection issues, audio/video troubleshooting, browser permissions.
- "security": Post-quantum cryptography (ML-KEM-1024, ML-DSA-87), compliance (NIST FIPS 203/204), on-premise air-gapped deployment.
- "general": General questions or feedback.

Format your response as valid JSON with these exact keys:
{
  "category": "sales" | "support" | "security" | "general",
  "priority": "low" | "medium" | "high",
  "summary": "one sentence summary of the inquiry",
  "suggestedAnswer": "brief helpful answer to give the user immediately (max 3 sentences)",
  "recommendedAction": "e.g. Schedule enterprise consultation, review documentation, check audio settings"
}
Only output the JSON object, nothing else. Do not invent plan prices or make binding legal/security guarantees.`;

export function contactRouterMiddleware(): Router {
    const router = Router();

    router.post(
        '/',
        rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false }),
        rateLimit({ windowMs: 3600_000, max: 25, keyGenerator: () => 'contact-ai', standardHeaders: true, legacyHeaders: false }),
        async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');

            const message = sanitizeInput(req.body?.message, 1500);
            const name = sanitizeInput(req.body?.name, 100);
            const email = sanitizeInput(req.body?.email, 150);

            if (!message || message.length < 5) {
                res.status(400).json({ error: 'Please provide a message with at least 5 characters.' });
                return;
            }

            if (detectPromptInjection(message).isSuspicious) {
                res.status(400).json({ error: 'Inquiry contains disallowed characters or instructions.' });
                return;
            }

            if (!openRouterConfigured()) {
                res.status(503).json({ error: 'AI contact assistant is currently unavailable.' });
                return;
            }

            try {
                const userPrompt = `Visitor: ${name || 'Anonymous'}\nEmail: ${email ? '[Provided]' : '[None]'}\nInquiry: ${message}`;
                const rawResponse = await askOpenRouter(CONTACT_SYSTEM, userPrompt);

                // Parse structured JSON response
                let parsed: any;
                try {
                    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
                    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
                } catch {
                    parsed = null;
                }

                if (!parsed) {
                    parsed = {
                        category: 'general',
                        priority: 'medium',
                        summary: message.slice(0, 100),
                        suggestedAnswer: 'Thank you for reaching out to the QS-VC team. We will review your message promptly.',
                        recommendedAction: 'Direct to sales or support team',
                    };
                }

                res.json({
                    success: true,
                    result: parsed,
                });
            } catch {
                res.status(503).json({ error: 'Could not process contact query at this time.' });
            }
        }
    );

    return router;
}
