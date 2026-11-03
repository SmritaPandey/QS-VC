import type { Request, Response } from 'express';

// Guest demo chat stays transient in signaling; do not expose unauthenticated stored history or writes.
export function disableDemoPersistence(_req: Request, res: Response) {
    return res.status(403).json({
        error: 'Stored participant history and chat are disabled for this demo.',
        code: 'DEMO_STORAGE_DISABLED',
    });
}
