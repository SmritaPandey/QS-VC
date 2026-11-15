import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { inflateSync } from 'node:zlib';
import { z } from 'zod';
import type { AuthPayload } from './auth.js';

export const DEFAULT_BRANDING = { organisationName: 'QS-VC', logoDataUrl: null as string | null, accent: '#006d77' };
const MAX_LOGO_BYTES = 48 * 1024;
/** Only small, non-interlaced RGB/RGBA PNGs produced by the upload preview are stored. No remote URLs or SVG. */
function pngCrc(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
}
export function validBrandLogo(value: string): boolean {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 65558) return false;
    const encoded = value.slice(22), bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length > MAX_LOGO_BYTES || bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
    let offset = 8, width = 0, height = 0, channels = 0, ended = false;
    const chunks: Buffer[] = [];
    while (offset + 12 <= bytes.length) {
        const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
        if (size > MAX_LOGO_BYTES || offset + 12 + size > bytes.length) return false;
        if (pngCrc(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) return false;
        const data = bytes.subarray(offset + 8, offset + 8 + size);
        if (offset === 8) {
            if (type !== 'IHDR' || size !== 13) return false;
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            if (!width || !height || width > 512 || height > 512 || data[8] !== 8 || ![2,6].includes(data[9]) || data[10] || data[11] || data[12]) return false;
            channels = data[9] === 6 ? 4 : 3;
        } else if (type === 'IDAT') chunks.push(data);
        else if (type === 'IEND') { if (size || offset + 12 !== bytes.length) return false; ended = true; break; }
        else if (!['sRGB','gAMA','pHYs','cHRM'].includes(type)) return false;
        offset += 12 + size;
    }
    if (!ended || !chunks.length) return false;
    try {
        const row = width * channels + 1, expected = row * height;
        const pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
        return pixels.length === expected && Array.from({ length: height }, (_, y) => pixels[y * row]).every(filter => filter <= 4);
    } catch { return false; }
}
export const brandingBody = z.object({
    organisationName: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
    logoDataUrl: z.string().max(65558).refine(validBrandLogo).nullable(),
    accent: z.string().regex(/^#[a-f0-9]{6}$/i),
}).strict();
type Database = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>; runWithTenant: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T> };
export function registerBrandingRoutes(app: Express, pool: Database, rawPool: Pick<Pool, 'query'>, auth: RequestHandler) {
    const read = async (tenantId: string) => (await pool.query('SELECT organisation_name AS "organisationName", logo_data_url AS "logoDataUrl", accent FROM tenant_branding WHERE tenant_id = $1', [tenantId])).rows[0] || DEFAULT_BRANDING;
    app.get('/api/meetings/branding', auth, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try { return res.json(await read(((req as any).user as AuthPayload).tenantId)); }
        catch { return res.status(503).json({ error: 'Organisation branding is unavailable.' }); }
    });
    app.patch('/api/meetings/branding', auth, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const user = (req as any).user as AuthPayload;
        if (user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
        const parsed = brandingBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Use an organisation name, a six-digit colour and a PNG logo under 48 KB and 512 pixels.' });
        const { organisationName, logoDataUrl, accent } = parsed.data;
        try {
            await pool.query(`INSERT INTO tenant_branding(tenant_id, organisation_name, logo_data_url, accent) VALUES ($1,$2,$3,$4)
                ON CONFLICT(tenant_id) DO UPDATE SET organisation_name=EXCLUDED.organisation_name, logo_data_url=EXCLUDED.logo_data_url, accent=EXCLUDED.accent, updated_at=NOW()`, [user.tenantId, organisationName, logoDataUrl, accent]);
            return res.json(parsed.data);
        } catch { return res.status(503).json({ error: 'Organisation branding could not be saved.' }); }
    });
    app.get('/api/meetings/code/:code/branding', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const code = String(req.params.code).toUpperCase();
        if (!/^[A-Z0-9-]{1,30}$/.test(code)) return res.status(400).json({ error: 'Invalid meeting code.' });
        try {
            const tenant = await rawPool.query('SELECT public.qsvc_tenant_id_by_meeting_code($1) AS tenant_id', [code]);
            const tenantId = tenant.rows[0]?.tenant_id;
            if (!tenantId) return res.sendStatus(404);
            return res.json(await pool.runWithTenant(tenantId, () => read(tenantId)));
        } catch { return res.status(503).json({ error: 'Organisation branding is unavailable.' }); }
    });
}
