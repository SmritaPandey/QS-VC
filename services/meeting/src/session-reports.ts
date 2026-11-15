import type { Express, RequestHandler } from 'express';
import type { QueryResult } from 'pg';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { serviceSecret } from '../../../shared/service-secrets.cjs';
import type { AuthPayload } from './auth.js';
const metric = z.number().finite().min(0).max(60000).nullable();
const metrics = z.object({ rttMs: metric, jitterMs: metric, packetLossPercent: z.number().finite().min(0).max(100).nullable(), audioActive: z.boolean().nullable() });
const moment = z.string().datetime();
export const sessionReportBody = z.object({
    sessionId: z.string().uuid(), startedAt: moment, incomplete: z.boolean(),
    participant: z.object({ peerId: z.string().min(1).max(128), displayName: z.string().max(100), joinedAt: moment, leftAt: moment.nullable(),
        durationMs: z.number().finite().min(0).max(31 * 86400000), estimatedSpeakingMs: z.number().finite().min(0).max(31 * 86400000),
        samples: z.number().int().min(0).max(10000000), latest: metrics.nullable(), lastSampleAt: moment.nullable(),
        qualityWindow: z.array(z.object({ receivedAt: moment, rttMs: metric, jitterMs: metric, packetLossPercent: z.number().finite().min(0).max(100).nullable() })).max(12),
        issues: z.object({ poorQualitySamples: z.number().int().min(0), metricsUnavailableSamples: z.number().int().min(0) }), version: z.number().int().min(1).max(2147483647),
    }).refine(value => value.estimatedSpeakingMs <= value.durationMs, 'Sound activity cannot exceed attendance duration'),
});
type QueryDatabase = { query: (sql: string, values?: unknown[]) => Promise<QueryResult> };
type Database = QueryDatabase & { runWithTenant: <T>(tenantId: string, fn: () => T) => T };
export function registerSessionReportRoutes(app: Express, pool: Database, rawPool: QueryDatabase, auth: RequestHandler) {
    app.post('/api/internal/meetings/:code/session-report', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try { jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), serviceSecret('MEETING_POLICY_SECRET'), { algorithms: ['HS256'], audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', maxAge: 30 }); }
        catch { return res.status(401).json({ error: 'Invalid service authentication' }); }
        const parsed = sessionReportBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid session report' });
        const code = String(req.params.code).toUpperCase().slice(0, 30);
        try {
            const tenant = await rawPool.query('SELECT public.qsvc_tenant_id_by_meeting_code($1) AS tenant_id', [code]);
            if (!tenant.rows[0]?.tenant_id) return res.status(404).json({ error: 'Meeting not found' });
            const { sessionId, startedAt, incomplete, participant } = parsed.data;
            const stored = await pool.runWithTenant(tenant.rows[0].tenant_id, async () => {
                const meeting = await pool.query('SELECT id, tenant_id FROM meetings WHERE meeting_code = $1 AND tenant_id = $2', [code, tenant.rows[0].tenant_id]);
                if (!meeting.rows.length) return false;
                await pool.query(`INSERT INTO vc_session_reports (tenant_id, meeting_id, session_id, peer_id, started_at, version, incomplete, participant)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
                    ON CONFLICT (session_id, peer_id) DO UPDATE SET version=EXCLUDED.version, incomplete=EXCLUDED.incomplete,
                        participant=EXCLUDED.participant, updated_at=NOW()
                    WHERE vc_session_reports.meeting_id = EXCLUDED.meeting_id AND vc_session_reports.version < EXCLUDED.version`,
                    [meeting.rows[0].tenant_id, meeting.rows[0].id, sessionId, participant.peerId, startedAt, participant.version, incomplete, JSON.stringify(participant)]);
                // Actual deletion, scoped by RLS to this tenant, as new reports arrive.
                await pool.query("DELETE FROM vc_session_reports WHERE started_at < NOW() - INTERVAL '90 days'");
                return true;
            });
            return stored ? res.status(201).json({ stored: true }) : res.status(404).json({ error: 'Meeting not found' });
        } catch { return res.status(503).json({ error: 'Session report storage unavailable' }); }
    });
    app.get('/api/meetings/code/:code/session-reports', auth, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const user = (req as any).user as AuthPayload;
        const code = String(req.params.code).toUpperCase().slice(0, 30);
        const limit = z.coerce.number().int().min(1).max(100).safeParse(req.query.limit ?? 50);
        const offset = z.coerce.number().int().min(0).max(100000).safeParse(req.query.offset ?? 0);
        if (!limit.success || !offset.success) return res.status(400).json({ error: 'Invalid report page' });
        try {
            const meeting = await pool.query('SELECT id, host_id FROM meetings WHERE meeting_code = $1 AND tenant_id = $2', [code, user.tenantId]);
            if (!meeting.rows.length) return res.status(404).json({ error: 'Meeting not found' });
            if (meeting.rows[0].host_id !== user.sub && user.role !== 'admin') return res.status(403).json({ error: 'Only the meeting owner or tenant administrator can open this report' });
            const result = await pool.query(`SELECT session_id AS "sessionId", started_at AS "startedAt", incomplete, participant, updated_at AS "updatedAt"
                FROM vc_session_reports WHERE meeting_id = $1 AND started_at >= NOW() - INTERVAL '90 days'
                ORDER BY started_at DESC, peer_id LIMIT $2 OFFSET $3`, [meeting.rows[0].id, limit.data + 1, offset.data]);
            return res.json({ reports: result.rows.slice(0, limit.data), nextOffset: result.rows.length > limit.data ? offset.data + limit.data : null,
                metricSource: 'Attendance is server-observed. Network metrics and estimated speaking time are client-reported; sound activity is not speaker identity.', retentionDays: 90 });
        } catch { return res.status(503).json({ error: 'Session reports unavailable' }); }
    });
}
