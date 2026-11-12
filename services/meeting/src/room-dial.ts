import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { serviceSecret } from '../../../shared/service-secrets.cjs';

const input = z.object({ pin: z.string().regex(/^[0-9]{4,12}$/).optional() });
const tenant = z.string().uuid();

type Database = {
    runWithTenant<T>(tenantId: string, action: () => Promise<T>): Promise<T>;
    query(sql: string, values: unknown[]): Promise<{ rows: Record<string, any>[] }>;
};

/** Only the configured site tenant can resolve its inventory through service authentication. */
export function roomDialHandler(db: Database) {
    return async (req: Request, res: Response) => {
        let tenantId: string;
        try {
            const payload = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''),
                serviceSecret('MEETING_POLICY_SECRET'),
                { algorithms: ['HS256'], audience: 'qsvc-room-dial', issuer: 'qsvc-signaling', maxAge: 30 });
            tenantId = tenant.parse(typeof payload === 'object' ? payload.tenantId : null);
        } catch { return res.status(401).json({ error: 'Unauthorized' }); }
        if (!/^[0-9]{3,10}$/.test(String(req.params.number))) return res.status(400).json({ error: 'Invalid room number' });
        const parsed = input.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid PIN format' });
        try {
            const result = await db.runWithTenant(tenantId, () => db.query(
                `SELECT number, meeting_code, display_name, pin_hash, auto_admit,
                        max_participants, encryption, created_by
                 FROM room_numbers WHERE number = $1 AND tenant_id = $2`,
                [req.params.number, tenantId]));
            const row = result.rows[0];
            if (!row) return res.status(404).json({ error: 'Room unavailable' });
            const pinRequired = Boolean(row.pin_hash);
            if (pinRequired && (!parsed.data.pin || !await bcrypt.compare(parsed.data.pin, row.pin_hash))) {
                return res.status(403).json({ error: 'Room unavailable or PIN incorrect' });
            }
            return res.json({
                meetingCode: row.meeting_code, displayName: row.display_name, ownerUserId: row.created_by,
                autoAdmit: row.auto_admit, maxParticipants: row.max_participants,
                encryption: row.encryption, pinRequired, pinVerified: pinRequired,
            });
        } catch { return res.status(503).json({ error: 'Room lookup unavailable' }); }
    };
}
