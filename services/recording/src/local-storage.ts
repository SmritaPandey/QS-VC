import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { RecordingStorage } from './storage.js';

const recordingKey = /^recordings\/[a-f0-9]{64}\/[a-f0-9]{64}\/[A-Z0-9-]{1,30}\/[a-f0-9-]{36}\.(webm|mp4|share\.json)$/;
const shareKey = /^shares\/[a-f0-9]{64}\.json$/;
const accountPrefix = /^recordings\/[a-f0-9]{64}\/[a-f0-9]{64}(?:\/[A-Z0-9-]{1,30})?\/$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const contentType = (key: string) => key.endsWith('.webm') ? 'video/webm' : key.endsWith('.mp4') ? 'video/mp4' : 'application/json';

export function createLocalStorage(root: string): RecordingStorage & { playbackFile(token: string): string | null } {
    if (!isAbsolute(root) || !statSync(root).isDirectory()) throw new Error('Local recording storage requires an existing absolute directory.');
    accessSync(root, constants.R_OK | constants.W_OK | constants.X_OK);
    // Playback leases are transient. Restarting the recording service revokes outstanding media URLs.
    const secret = randomBytes(32);
    const sign = (value: string) => createHmac('sha256', secret).update(value).digest();
    const path = (key: string) => {
        if (!recordingKey.test(key) && !shareKey.test(key)) throw new Error('Invalid recording storage key.');
        return join(root, key);
    };
    const head = async (key: string) => {
        try {
            const info = await stat(path(key));
            if (!info.isFile()) return null;
            return { type: contentType(key), size: info.size, modified: info.mtime };
        } catch (error) { if (missing(error)) return null; throw error; }
    };
    async function collect(prefix: string): Promise<string[]> {
        const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(error => {
            if (missing(error)) return [];
            throw error;
        });
        const keys: string[] = [];
        for (const entry of entries) {
            const key = prefix + entry.name;
            if (entry.isFile() && recordingKey.test(key)) keys.push(key);
            else if (entry.isDirectory() && accountPrefix.test(key + '/')) keys.push(...await collect(key + '/'));
        }
        return keys;
    }
    return {
        async put(key, body, _type, ifAbsent) {
            const file = path(key);
            await mkdir(dirname(file), { recursive: true, mode: 0o700 });
            const temp = file + '.' + randomBytes(16).toString('hex') + '.tmp';
            try {
                await writeFile(temp, body, { flag: 'wx', mode: 0o600, flush: true });
                // Hard-link publication preserves the create-once semantics used by retryable uploads.
                if (ifAbsent) await link(temp, file);
                else await rename(temp, file);
            } finally { await rm(temp, { force: true }); }
        },
        async get(key) {
            const info = await head(key);
            if (!info) return null;
            try { return { ...info, body: await readFile(path(key)) }; }
            catch (error) { if (missing(error)) return null; throw error; }
        },
        head,
        async remove(key) { await rm(path(key), { force: true }); },
        async list(prefix, cursor) {
            if (!accountPrefix.test(prefix) || (cursor && (!recordingKey.test(cursor) || !cursor.startsWith(prefix)))) {
                throw new Error('Invalid recording storage prefix or cursor.');
            }
            const keys = (await collect(prefix)).sort().filter(key => !cursor || key > cursor);
            const page = keys.slice(0, 100);
            const objects = (await Promise.all(page.map(async key => {
                const info = await head(key);
                return info ? { key, size: info.size, modified: info.modified } : null;
            }))).filter(item => item !== null);
            return { objects, nextCursor: keys.length > page.length ? page.at(-1) : undefined };
        },
        async playback(key) {
            if (!recordingKey.test(key) || key.endsWith('.json')) throw new Error('Invalid media key.');
            const value = Buffer.from(JSON.stringify([key, Date.now() + 300_000])).toString('base64url');
            return `/api/recordings/media?token=${value}.${sign(value).toString('base64url')}`;
        },
        playbackFile(token) {
            if (!/^[A-Za-z0-9_-]{1,500}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
            const [value, encodedSignature] = token.split('.');
            const signature = Buffer.from(encodedSignature, 'base64url');
            if (signature.length !== 32 || !timingSafeEqual(signature, sign(value))) return null;
            const [key, expiresAt] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
            return recordingKey.test(key) && !key.endsWith('.json') && expiresAt > Date.now() ? path(key) : null;
        },
    };
}
