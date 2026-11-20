/**
 * In-memory LRU cache for AI queries.
 *
 * Uses SHA-256 for deterministic, collision-resistant key hashing.
 * Configurable TTL per feature to minimize cost and latency on repeated inquiries.
 */

import { createHash } from 'node:crypto';

interface CacheEntry {
    value: string;
    expiresAt: number;
    hits: number;
}

export class AICache {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly maxEntries: number;

    constructor(maxEntries = 500) {
        this.maxEntries = maxEntries;
    }

    /**
     * Compute a SHA-256 hash key from feature, system prompt, and user prompt.
     */
    static hashKey(feature: string, system: string, prompt: string): string {
        return createHash('sha256')
            .update(`${feature}:${system}:${prompt}`)
            .digest('hex');
    }

    /**
     * Retrieve cached answer if present and not expired.
     */
    get(key: string): string | null {
        const entry = this.entries.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.entries.delete(key);
            return null;
        }

        // LRU refresh
        entry.hits++;
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    /**
     * Store an entry with a TTL in milliseconds.
     */
    set(key: string, value: string, ttlMs: number): void {
        if (ttlMs <= 0) return;

        // Evict oldest if full
        if (this.entries.size >= this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey) this.entries.delete(oldestKey);
        }

        this.entries.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
            hits: 1,
        });
    }

    /**
     * Check if key exists and is valid.
     */
    has(key: string): boolean {
        return this.get(key) !== null;
    }

    /**
     * Clear all cached items.
     */
    clear(): void {
        this.entries.clear();
    }

    /**
     * Get size of cache.
     */
    get size(): number {
        return this.entries.size;
    }
}

export const aiCache = new AICache();
