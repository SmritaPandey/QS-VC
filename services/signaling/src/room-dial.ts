import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { serviceSecret } from '../../../shared/service-secrets.cjs';
import { roomManager } from './room-manager.js';

const resultSchema = z.object({
    meetingCode: z.string().regex(/^[a-zA-Z0-9-]{1,30}$/),
    displayName: z.string().max(100), ownerUserId: z.string().uuid().nullable(),
    autoAdmit: z.boolean(), maxParticipants: z.number().int().min(1).max(1000),
    encryption: z.enum(['required', 'optional']), pinRequired: z.boolean(), pinVerified: z.boolean(),
});
const inputSchema = z.object({ pin: z.string().regex(/^[0-9]{4,12}$/).optional() });

export async function roomDialHandler(req: Request, res: Response) {
    const token = process.env.BRIDGE_API_TOKEN?.trim();
    const tenantId = z.string().uuid().safeParse(process.env.POLY_TENANT_ID);
    if (!token || !tenantId.success) return res.status(503).json({ error: 'Room dialing is not configured' });
    const expected = Buffer.from('Bearer ' + token);
    const provided = Buffer.from(req.headers.authorization || '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return res.status(401).end();
    const input = inputSchema.safeParse(req.body);
    if (!/^[0-9]{3,10}$/.test(String(req.params.number)) || !input.success) return res.status(400).end();
    try {
        const authorization = jwt.sign({ tenantId: tenantId.data }, serviceSecret('MEETING_POLICY_SECRET'),
            { audience: 'qsvc-room-dial', issuer: 'qsvc-signaling', expiresIn: 30 });
        const base = process.env.MEETING_INTERNAL_URL || 'http://127.0.0.1:4003';
        const response = await fetch(base + '/api/internal/room-numbers/' + req.params.number + '/resolve', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authorization },
            body: JSON.stringify(input.data),
        });
        if ([403, 404].includes(response.status)) return res.status(404).json({ error: 'Room unavailable' });
        if (!response.ok) throw new Error('Room lookup failed');
        const policy = resultSchema.parse(await response.json());
        const existing = roomManager.getRoomByCode(policy.meetingCode);
        if (existing && (existing.settings.e2eeRequired || existing.settings.locked)) {
            return res.status(409).json({ error: 'Room is locked or requires end-to-end encryption' });
        }
        const room = roomManager.getOrCreatePersistentRoom(policy.meetingCode, { ...policy, ownerUserId: policy.ownerUserId ?? undefined });
        return res.json({
            roomId: room.id, meetingCode: policy.meetingCode, autoAdmit: policy.autoAdmit,
            encryption: policy.encryption, pinRequired: policy.pinRequired, pinVerified: policy.pinVerified,
        });
    } catch { return res.status(503).json({ error: 'Room lookup unavailable' }); }
}
