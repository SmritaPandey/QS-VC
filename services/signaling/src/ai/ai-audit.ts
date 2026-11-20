/**
 * AI Audit & Telemetry Tracker.
 *
 * Logs AI operations without leaking confidential transcripts, questions, or keys.
 * Tracks estimated token usage, durations, and success rates.
 */

import { logger } from '../logger.js';

export interface AIAuditRecord {
    feature: string;
    userId?: string;
    model: string;
    inputChars: number;
    outputChars: number;
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
    durationMs: number;
    success: boolean;
    cached: boolean;
    error?: string;
}

export class AIAudit {
    private totalRequests = 0;
    private successfulRequests = 0;
    private failedRequests = 0;
    private cachedHits = 0;
    private totalEstimatedTokens = 0;

    /**
     * Record an AI invocation.
     */
    record(record: AIAuditRecord): void {
        this.totalRequests++;
        if (record.cached) this.cachedHits++;
        if (record.success) this.successfulRequests++;
        else this.failedRequests++;

        const totalTokens = record.estimatedPromptTokens + record.estimatedCompletionTokens;
        this.totalEstimatedTokens += totalTokens;

        logger.info({
            event: 'ai.call',
            feature: record.feature,
            user: record.userId ? record.userId.slice(0, 8) + '...' : 'anonymous',
            model: record.model,
            durationMs: record.durationMs,
            cached: record.cached,
            success: record.success,
            tokens: totalTokens,
            error: record.error,
        }, `AI [${record.feature}]: ${record.success ? 'Success' : 'Failed'} (${record.durationMs}ms)`);
    }

    /**
     * Get aggregated metrics.
     */
    getMetrics() {
        return {
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            cachedHits: this.cachedHits,
            totalEstimatedTokens: this.totalEstimatedTokens,
        };
    }
}

export const aiAudit = new AIAudit();
