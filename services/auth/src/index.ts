import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config({ path: '../../.env' });

const logger = pino({
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    level: process.env.LOG_LEVEL || 'info',
    name: 'qsvc-auth',
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATION SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const registerBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    displayName: z.string().min(1, 'Display name is required').max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')),
    tenantSlug: z.string().max(100).optional(),
});

const loginBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(1, 'Password is required').max(128),
});

const updateProfileBody = z.object({
    displayName: z.string().min(1).max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')).optional(),
    avatarUrl: z.string().url('Invalid URL').max(2048).optional(),
    preferences: z.record(z.string(), z.any()).optional(),
}).refine((data) => Object.keys(data).some(k => (data as any)[k] !== undefined), {
    message: 'At least one field must be provided to update',
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
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
}));
app.use(express.json());

// Rate limiting
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many auth attempts, please try again later' } });
app.use(generalLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);

const PORT = parseInt(process.env.PORT || process.env.AUTH_PORT || '4002', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
// Convert time string to seconds for JWT (avoids StringValue branded type issue)
function parseExpiry(val: string): number {
    const match = val.match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return 86400; // default 24h
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 's') return n;
    if (unit === 'm') return n * 60;
    if (unit === 'h') return n * 3600;
    if (unit === 'd') return n * 86400;
    return 86400;
}
const JWT_EXPIRY = parseExpiry(process.env.JWT_EXPIRY || '24h');

// Database pool — supports DATABASE_URL (Render) or individual env vars (local)
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'qsvc',
        user: process.env.POSTGRES_USER || 'qsvc',
        password: process.env.POSTGRES_PASSWORD || 'qsvc_dev_2025',
    });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateToken(user: { id: string; email: string; tenantId: string; role: string; displayName: string }) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            tenantId: user.tenantId,
            role: user.role,
            displayName: user.displayName,
        },
        JWT_SECRET as jwt.Secret,
        { expiresIn: JWT_EXPIRY }
    );
}

function verifyToken(token: string) {
    return jwt.verify(token, JWT_SECRET);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'qsvc-auth' });
});

// Register
app.post('/api/auth/register', validateBody(registerBody), async (req, res) => {
    try {
        const { email, password, displayName, tenantSlug } = req.body;

        // Find or create tenant
        let tenantId: string;
        if (tenantSlug) {
            const tenantResult = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
            if (tenantResult.rows.length === 0) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            tenantId = tenantResult.rows[0].id;
        } else {
            // Default dev tenant
            tenantId = '00000000-0000-0000-0000-000000000001';
        }

        // Check if email exists
        const existing = await pool.query(
            'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
            [email, tenantId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password and create user
        const passwordHash = await bcrypt.hash(password, 12);
        const userId = uuidv4();

        await pool.query(
            `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'member')`,
            [userId, tenantId, email, displayName, passwordHash]
        );

        const token = generateToken({ id: userId, email, tenantId, role: 'member', displayName });

        logger.info(`User registered: ${email} [tenant:${tenantId}]`);
        res.status(201).json({
            token,
            user: { id: userId, email, displayName, role: 'member', tenantId },
        });
    } catch (err: any) {
        logger.error(err, 'Registration failed');
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', validateBody(loginBody), async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await pool.query(
            `SELECT id, tenant_id, email, display_name, password_hash, role, avatar_url
       FROM users WHERE email = $1 AND is_active = true`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last login
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        const token = generateToken({
            id: user.id,
            email: user.email,
            tenantId: user.tenant_id,
            role: user.role,
            displayName: user.display_name,
        });

        logger.info(`User logged in: ${email}`);
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                displayName: user.display_name,
                role: user.role,
                avatarUrl: user.avatar_url,
                tenantId: user.tenant_id,
            },
        });
    } catch (err: any) {
        logger.error(err, 'Login failed');
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify token
app.get('/api/auth/verify', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.slice(7);
        const payload = verifyToken(token);
        res.json({ valid: true, payload });
    } catch (err) {
        res.status(401).json({ valid: false, error: 'Invalid token' });
    }
});

// Get current user profile
app.get('/api/auth/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const payload = verifyToken(authHeader.slice(7)) as any;
        const result = await pool.query(
            `SELECT id, tenant_id, email, display_name, role, avatar_url, preferences, created_at
       FROM users WHERE id = $1`,
            [payload.sub]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        res.json({
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            role: user.role,
            avatarUrl: user.avatar_url,
            preferences: user.preferences,
            tenantId: user.tenant_id,
            createdAt: user.created_at,
        });
    } catch (err: any) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Update profile
app.patch('/api/auth/me', validateBody(updateProfileBody), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const payload = verifyToken(authHeader.slice(7)) as any;
        const { displayName, avatarUrl, preferences } = req.body;

        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (displayName) { fields.push(`display_name = $${idx++}`); values.push(displayName); }
        if (avatarUrl !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(avatarUrl); }
        if (preferences) { fields.push(`preferences = $${idx++}`); values.push(JSON.stringify(preferences)); }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        fields.push(`updated_at = NOW()`);
        values.push(payload.sub);

        await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`,
            values
        );

        res.json({ updated: true });
    } catch (err: any) {
        logger.error(err, 'Profile update failed');
        res.status(500).json({ error: 'Update failed' });
    }
});

// Generate TURN credentials (time-limited)
app.get('/api/auth/turn-credentials', (req, res) => {
    const turnSecret = process.env.TURN_SECRET || 'dev-turn-secret';
    const turnServers = process.env.TURN_SERVERS || 'turn:localhost:3478';
    const ttl = 86400; // 24 hours
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:qsvc`;

    // HMAC-SHA1 credential generation for coturn
    const credential = crypto
        .createHmac('sha1', turnSecret)
        .update(username)
        .digest('base64');

    res.json({
        iceServers: [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
            {
                urls: turnServers.split(',').map((s: string) => s.trim()),
                username,
                credential,
            },
        ],
        ttl,
    });
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

app.listen(PORT, () => {
    logger.info(`🔐 QS-VC Auth running on port ${PORT}`);
});

process.on('SIGTERM', () => { pool.end(); process.exit(0); });
process.on('SIGINT', () => { pool.end(); process.exit(0); });
