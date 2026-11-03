import { it, expect, vi } from 'vitest';
import { disableDemoPersistence } from './demo-storage-policy';
import type { Request, Response } from 'express';

it('denies stored meeting data without accessing the database', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    disableDemoPersistence({} as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_STORAGE_DISABLED' }));
});
