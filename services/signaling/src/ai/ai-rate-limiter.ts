/**
 * Sliding-Window AI Rate Limiter.
 *
 * Protects OpenRouter API quotas, prevents DDoS, and enforces per-feature fairness.
 */

export interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
}

export const FEATURE_RATE_LIMITS: Record<string, RateLimitConfig> = {
    'meeting-assistant': { windowMs: 60_000, maxRequests: 6 },
    'product-guide': { windowMs: 60_000, maxRequests: 5 },
    'meeting-minutes': { windowMs: 3600_000, maxRequests: 10 },
    'meeting-summary': { windowMs: 3600_000, maxRequests: 10 },
    'contact-routing': { windowMs: 3600_000, maxRequests: 5 },
    'admin-insights': { windowMs: 3600_000, maxRequests: 20 },
    'default': { windowMs: 60_000, maxRequests: 10 },
};

interface WindowEntry {
    timestamps: number[];
}

export class AIRateLimiter {
    private readonly userWindows = new Map<string, WindowEntry>();
    private pendingRequests = 0;
    private readonly maxGlobalConcurrency: number;

    constructor(maxGlobalConcurrency = 16) {
        this.maxGlobalConcurrency = maxGlobalConcurrency;

        // Periodic cleanup every 2 minutes
        const cleanup = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.userWindows) {
                entry.timestamps = entry.timestamps.filter(ts => now - ts < 3600_000);
                if (!entry.timestamps.length) this.userWindows.delete(key);
            }
        }, 120_000);
        cleanup.unref();
    }

    /**
     * Check whether a request can proceed.
     */
    check(identifier: string, feature: string): { allowed: boolean; retryAfterMs?: number; reason?: string } {
        if (this.pendingRequests >= this.maxGlobalConcurrency) {
            return { allowed: false, retryAfterMs: 1000, reason: 'AI service is currently busy' };
        }

        const config = FEATURE_RATE_LIMITS[feature] || FEATURE_RATE_LIMITS.default;
        const key = `${feature}:${identifier}`;
        const now = Date.now();

        let entry = this.userWindows.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            this.userWindows.set(key, entry);
        }

        // Filter timestamps within the current window
        entry.timestamps = entry.timestamps.filter(ts => now - ts < config.windowMs);

        if (entry.timestamps.length >= config.maxRequests) {
            const oldest = entry.timestamps[0];
            const retryAfterMs = Math.max(0, config.windowMs - (now - oldest));
            return { allowed: false, retryAfterMs, reason: 'Rate limit exceeded for this feature' };
        }

        return { allowed: true };
    }

    /**
     * Track a started request.
     */
    acquire(identifier: string, feature: string): boolean {
        const check = this.check(identifier, feature);
        if (!check.allowed) return false;

        const key = `${feature}:${identifier}`;
        const entry = this.userWindows.get(key)!;
        entry.timestamps.push(Date.now());
        this.pendingRequests++;
        return true;
    }

    /**
     * Release concurrency slot when request finishes.
     */
    release(): void {
        this.pendingRequests = Math.max(0, this.pendingRequests - 1);
    }

    /**
     * Current active in-flight requests.
     */
    get activeConcurrency(): number {
        return this.pendingRequests;
    }
}

export const aiRateLimiter = new AIRateLimiter();
