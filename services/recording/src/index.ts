import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config({ path: '../../.env' });

const logger = pino({
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    level: process.env.LOG_LEVEL || 'info',
    name: 'qsvc-recording',
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATION SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const startRecordingBody = z.object({
    meetingId: z.string().uuid('Invalid meeting ID'),
    tenantId: z.string().uuid('Invalid tenant ID'),
    type: z.enum(['composite', 'individual', 'audio']).default('composite'),
});

const uploadChunkBody = z.object({
    chunk: z.string().min(1, 'Chunk data is required'),
    chunkIndex: z.number().int().min(0, 'Chunk index must be >= 0'),
    format: z.enum(['webm', 'mp4', 'ogg']).default('webm'),
    isLast: z.boolean().default(false),
});

const completeRecordingBody = z.object({
    data: z.string().min(1, 'Recording data is required'),
    format: z.enum(['webm', 'mp4', 'ogg']).default('webm'),
    durationSec: z.number().min(0).default(0),
});

function validateBody<T>(schema: z.ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map((i) => ({
                    field: i.path.join('.'),
                    message: i.message,
                })),
            });
        }
        req.body = result.data;
        next();
    };
}

const app = express();

// CORS: restrict origins per environment
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
}));
app.use(express.json({ limit: '100mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

const PORT = parseInt(process.env.RECORDING_PORT || '4004', 10);

// PostgreSQL
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'qsvc',
    user: process.env.POSTGRES_USER || 'qsvc',
    password: process.env.POSTGRES_PASSWORD || 'qsvc_dev_2025',
});

// S3 (MinIO-compatible)
const s3 = new S3Client({
    endpoint: `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'qsvc_minio',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 'qsvc_minio_secret',
    },
    forcePathStyle: true,
});

const BUCKET = process.env.MINIO_BUCKET || 'qsvc-recordings';

// Ensure bucket exists
async function ensureBucket() {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
        logger.info(`S3 bucket "${BUCKET}" exists`);
    } catch {
        try {
            await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
            logger.info(`S3 bucket "${BUCKET}" created`);
        } catch (err: any) {
            logger.error(err, 'Failed to create S3 bucket');
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'qsvc-recording' });
});

// Start recording
app.post('/api/recordings/start', validateBody(startRecordingBody), async (req, res) => {
    try {
        const { meetingId, tenantId, type } = req.body;
        const id = uuidv4();

        await pool.query(
            `INSERT INTO recordings (id, tenant_id, meeting_id, type, status)
       VALUES ($1, $2, $3, $4, 'recording')`,
            [id, tenantId, meetingId, type || 'composite']
        );

        logger.info(`Recording started: ${id} for meeting ${meetingId}`);
        res.status(201).json({ recordingId: id, status: 'recording' });
    } catch (err: any) {
        logger.error(err, 'Failed to start recording');
        res.status(500).json({ error: 'Failed to start recording' });
    }
});

// Upload recording chunk (for server-side recording)
app.post('/api/recordings/:id/upload', validateBody(uploadChunkBody), async (req, res) => {
    try {
        const { id } = req.params;
        const { chunk, chunkIndex, format, isLast } = req.body;

        const key = `recordings/${id}/chunk_${String(chunkIndex).padStart(6, '0')}.${format || 'webm'}`;
        const buffer = Buffer.from(chunk, 'base64');

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: buffer,
            ContentType: `video/${format || 'webm'}`,
        }));

        if (isLast) {
            // Final chunk — mark recording as processing
            await pool.query(
                `UPDATE recordings SET status = 'processing', storage_path = $1, updated_at = NOW() WHERE id = $2`,
                [`s3://${BUCKET}/recordings/${id}/`, id]
            );
        }

        res.json({ uploaded: true, key, chunkIndex });
    } catch (err: any) {
        logger.error(err, 'Failed to upload recording chunk');
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Upload complete recording file (client-side recording via MediaRecorder)
app.post('/api/recordings/:id/complete', validateBody(completeRecordingBody), async (req, res) => {
    try {
        const { id } = req.params;
        const { data, format, durationSec } = req.body;

        const key = `recordings/${id}/recording.${format || 'webm'}`;
        const buffer = Buffer.from(data, 'base64');

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: buffer,
            ContentType: `video/${format || 'webm'}`,
        }));

        await pool.query(
            `UPDATE recordings SET status = 'ready', storage_path = $1, file_size_bytes = $2,
       duration_sec = $3, format = $4, updated_at = NOW() WHERE id = $5`,
            [`s3://${BUCKET}/${key}`, buffer.length, durationSec || 0, format || 'webm', id]
        );

        logger.info(`Recording completed: ${id} (${buffer.length} bytes)`);
        res.json({ completed: true, key, size: buffer.length });
    } catch (err: any) {
        logger.error(err, 'Failed to complete recording');
        res.status(500).json({ error: 'Failed to complete recording' });
    }
});

// Stop recording
app.post('/api/recordings/:id/stop', async (req, res) => {
    try {
        await pool.query(
            `UPDATE recordings SET status = 'processing', updated_at = NOW() WHERE id = $1`,
            [req.params.id]
        );
        res.json({ stopped: true });
    } catch (err: any) {
        logger.error(err, 'Failed to stop recording');
        res.status(500).json({ error: 'Failed to stop recording' });
    }
});

// Get recording info
app.get('/api/recordings/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM recordings WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const r = result.rows[0];
        res.json({
            id: r.id,
            meetingId: r.meeting_id,
            type: r.type,
            status: r.status,
            format: r.format,
            fileSizeBytes: r.file_size_bytes,
            durationSec: r.duration_sec,
            createdAt: r.created_at,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to get recording');
        res.status(500).json({ error: 'Failed to get recording' });
    }
});

// Get download URL (pre-signed)
app.get('/api/recordings/:id/download', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM recordings WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const r = result.rows[0];
        if (r.status !== 'ready' || !r.storage_path) {
            return res.status(400).json({ error: 'Recording not ready for download' });
        }

        // Extract key from s3:// path
        const key = r.storage_path.replace(`s3://${BUCKET}/`, '');

        const url = await getSignedUrl(s3, new GetObjectCommand({
            Bucket: BUCKET,
            Key: key,
        }), { expiresIn: 3600 });

        res.json({ url, expiresIn: 3600 });
    } catch (err: any) {
        logger.error(err, 'Failed to generate download URL');
        res.status(500).json({ error: 'Failed to generate download URL' });
    }
});

// List recordings for a meeting
app.get('/api/meetings/:meetingId/recordings', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM recordings WHERE meeting_id = $1 ORDER BY created_at DESC',
            [req.params.meetingId]
        );

        res.json({
            recordings: result.rows.map((r) => ({
                id: r.id,
                type: r.type,
                status: r.status,
                format: r.format,
                fileSizeBytes: r.file_size_bytes,
                durationSec: r.duration_sec,
                createdAt: r.created_at,
            })),
        });
    } catch (err: any) {
        logger.error(err, 'Failed to list recordings');
        res.status(500).json({ error: 'Failed to list recordings' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLOBAL ERROR HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function start() {
    await ensureBucket();
    app.listen(PORT, () => {
        logger.info(`🎬 QS-VC Recording Service running on port ${PORT}`);
    });
}

start().catch((err) => {
    logger.fatal(err, 'Failed to start recording service');
    process.exit(1);
});

process.on('SIGTERM', () => { pool.end(); process.exit(0); });
process.on('SIGINT', () => { pool.end(); process.exit(0); });
