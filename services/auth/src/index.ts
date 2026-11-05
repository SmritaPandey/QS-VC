import { assertJwtSecret } from '../../../shared/jwt-secret.cjs';
import { profileHandler } from './profile.js';
import { registerBody } from './registration';
import { enterpriseRouter } from './enterprise-access.js';
import { platformAdminAnalyticsRouter } from './platform-admin-analytics.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { databaseConfig } from '../../../shared/database.cjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pino from 'pino';
import { createSession, validateSession, requireEnterpriseTerm, endSession, sessionErrorStatus } from './sessions.js';
import { contactRouter, contactRequestError } from './contact.js';
import { effectiveRole, isPlatformAdmin } from './platform-admins.js';
import { FEATURE_MIN_PLAN, getEntitlements, getPrivateConversationLimitMs } from '../../../shared/entitlements.cjs';

dotenv.config({ path: '../../.env' });
assertJwtSecret();

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


const loginBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(1, 'Password is required').max(128),
    tenantSlug: z.string().min(1).max(100).optional(),
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
app.disable('x-powered-by'); // Do not advertise the framework (OWASP A05).

// CORS: merge env with production defaults so stale Render env can't lock out Vercel
const DEFAULT_CORS_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://qs-vc.vercel.app',
    'https://dist-puce-one-68.vercel.app',
];
const corsOriginsEnv = process.env.CORS_ORIGINS;
const allowedOrigins = corsOriginsEnv === '*'
    ? true
    : [...new Set([
        ...(corsOriginsEnv ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean) : []),
        ...DEFAULT_CORS_ORIGINS,
    ])];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
}));
app.use(express.json());

// Rate limiting
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many auth attempts, please try again later' } });
// Signaling verifies each authenticated RPC, so do not apply the low browser API quota here.
app.use('/api/auth/verify', rateLimit({ windowMs: 15 * 60 * 1000, max: 3000, skip: req => { try { const value = jwt.verify(String(req.headers['x-qsvc-service-token'] || ''), process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production') as jwt.JwtPayload; return value.aud === 'qsvc-auth-verify' && value.iss === 'qsvc-internal'; } catch { return false; } }, keyGenerator: req => req.headers.authorization ? crypto.createHash('sha256').update(req.headers.authorization).digest('hex') : ipKeyGenerator(req.ip || 'unknown'), standardHeaders: true, legacyHeaders: false }));
app.use((req, res, next) => req.path === '/api/auth/verify' ? next() : generalLimiter(req, res, next));
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

const pool = new Pool(databaseConfig({ ...process.env, DATABASE_URL: process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL }));
// Idle connections can fail during database restarts without a pending request.
pool.on('error', () => logger.warn('Database connection lost; the pool will reconnect on demand'));

app.use('/api/auth/contact', contactRouter(pool));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateToken(user: { id: string; email: string; tenantId: string; role: string; displayName: string }, sessionId: string) {
    return jwt.sign(
        {
            sub: user.id,
            sessionId,
            email: user.email,
            tenantId: user.tenantId,
            role: user.role,
            displayName: user.displayName,
        },
        JWT_SECRET as jwt.Secret,
        { expiresIn: JWT_EXPIRY }
    );
}

/**
 * The free tenant that public sign-ups join. Created on demand when a database was set up
 * without migration 004, which otherwise made every sign-up fail with "temporarily unavailable".
 */
async function personalTenantId(): Promise<string | null> {
    const find = () => pool.query(
        "SELECT id FROM tenants WHERE slug = 'personal-free' AND plan = 'free' AND is_active = true"
    );
    let result = await find();
    if (result.rows.length === 1) return result.rows[0].id;
    try {
        await pool.query(
            `INSERT INTO tenants (name, slug, plan, max_participants, max_duration_min, storage_quota_gb)
             VALUES ('Personal accounts', 'personal-free', 'free', 100, 60, 0)
             ON CONFLICT (slug) DO NOTHING`
        );
        result = await find();
        if (result.rows.length === 1) {
            logger.warn('Created the missing personal-free tenant; run db/migrate.js on this database');
            return result.rows[0].id;
        }
        logger.error("A tenant with slug 'personal-free' exists but is inactive or not on the free plan");
    } catch (err) {
        logger.error(err, "The personal-free tenant is missing and could not be created; run db/migrate.js (migration 005 grants this)");
    }
    return null;
}

async function verifyToken(token: string) {
    const payload = jwt.verify(token, JWT_SECRET);
    if (typeof payload === 'string') throw new Error('Invalid token');
    await validateSession(pool, payload);
    return payload;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use('/api/auth/enterprise', enterpriseRouter(verifyToken, pool));
app.use('/api/auth/admin', platformAdminAnalyticsRouter(verifyToken, pool));

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'qsvc-auth' });
});

app.get('/ready', async (_req, res) => {
    try {
        await pool.query('SELECT 1 FROM enterprise_access_terms LIMIT 0');
        res.json({ status: 'ready' });
    } catch {
        res.status(503).json({ status: 'unavailable', dependency: 'database' });
    }
});

// Register
app.post('/api/auth/register', validateBody(registerBody), async (req, res) => {
    if (process.env.QSVC_ENTERPRISE_TERMS_REQUIRED === 'yes') {
        return res.status(403).json({ error: 'Your organisation provisions accounts for this workspace.' });
    }
    try {
        const { password, displayName, tenantSlug } = req.body;
        const email = String(req.body.email).trim().toLowerCase();

        // Public signup cannot enrol users into an organisation or a paid tenant.
        if (tenantSlug) {
            return res.status(403).json({ error: 'Enterprise access requires organisation SSO / SAML.' });
        }
        const tenantId = await personalTenantId();
        if (!tenantId) {
            return res.status(503).json({ error: 'Account creation is temporarily unavailable. Please try again later.' });
        }
        // Platform-admin addresses cannot be claimed through public sign-up (there is no email
        // verification yet). Operators open this briefly with QSVC_ADMIN_SIGNUP_OPEN=yes.
        if (isPlatformAdmin(email) && process.env.QSVC_ADMIN_SIGNUP_OPEN !== 'yes') {
            return res.status(403).json({ error: 'This address is reserved. Contact QS-VC support to set up this account.' });
        }
        const role = effectiveRole(email, 'member');

        // Check if email exists
        // An address that already belongs to any organisation must not get a second account:
        // the duplicate would make the original user's sign-in ambiguous and lock them out.
        const existing = await pool.query(
            'SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1',
            [email]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password and create user
        const passwordHash = await bcrypt.hash(password, 12);
        const userId = uuidv4();

        await pool.query(
            `INSERT INTO users (id, tenant_id, email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, tenantId, email, displayName, passwordHash, role]
        );

        const sessionId = await createSession(pool, userId);
        await pool.query(
            `UPDATE users SET subscription_plan = 'starter_trial', trial_started_at = NOW(),
                              trial_ends_at = NOW() + INTERVAL '7 days', updated_at = NOW()
             WHERE id = $1 AND subscription_plan IS NULL AND trial_started_at IS NULL`,
            [userId],
        );
        const token = generateToken({ id: userId, email, tenantId, role, displayName }, sessionId);

        logger.info(`User registered: ${email} [tenant:${tenantId}]`);
        res.status(201).json({
            token,
            user: { id: userId, email, displayName, role, tenantId },
        });
    } catch (err: any) {
        logger.error(err, 'Registration failed');
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', validateBody(loginBody), async (req, res) => {
    try {
        const { email, password, tenantSlug } = req.body;

        const result = await pool.query(
            `SELECT id, tenant_id, email, display_name, password_hash, role, avatar_url
       FROM users WHERE lower(email) = lower($1) AND is_active = true
       AND tenant_id IN (SELECT id FROM tenants WHERE is_active = true AND ($2::text IS NULL OR slug = $2))`,
            [email, tenantSlug || null]
        );

        if (result.rows.length !== 1) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];
        const validPassword = user.password_hash && await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Existing free-account guests receive one trial on their first sign-in after this rollout.
        await pool.query(
            `UPDATE users SET subscription_plan = 'starter_trial', trial_started_at = NOW(),
                              trial_ends_at = NOW() + INTERVAL '7 days', updated_at = NOW()
             WHERE id = $1 AND subscription_plan IS NULL AND trial_started_at IS NULL
               AND tenant_id IN (SELECT id FROM tenants WHERE plan = 'free')`,
            [user.id],
        );

        try {
            await requireEnterpriseTerm(pool, user.id);
        } catch (error) {
            if (sessionErrorStatus(error) === 401) return res.status(403).json({ error: 'Your enterprise access term is missing or expired.' });
            throw error;
        }

        // Listed platform admins are promoted on sign-in, so existing accounts get full access too.
        const role = effectiveRole(user.email, user.role);
        if (role !== user.role) {
            await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, user.id]);
            user.role = role;
            logger.info(`Platform admin role applied: ${user.email}`);
        }

        // Update last login
        const sessionId = await createSession(pool, user.id);

        const token = generateToken({
            id: user.id,
            email: user.email,
            tenantId: user.tenant_id,
            role: user.role,
            displayName: user.display_name,
        }, sessionId);

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
app.get('/api/auth/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.slice(7);
        const payload = await verifyToken(token);
        const result = await pool.query(
            `SELECT u.role, u.subscription_plan, u.trial_ends_at, u.enterprise_status, t.plan AS tenant_plan
             FROM users u JOIN tenants t ON t.id = u.tenant_id
             WHERE u.id = $1 AND u.tenant_id = $2 AND u.is_active AND t.is_active`,
            [payload.sub, payload.tenantId],
        );
        if (!result.rows.length) return res.status(401).json({ valid: false, error: 'Invalid token' });
        const now = new Date();
        if (process.env.NODE_ENV === 'development' && process.env.QSVC_TRIAL_NOW) {
            const fakeNow = new Date(process.env.QSVC_TRIAL_NOW);
            if (!Number.isNaN(fakeNow.getTime())) now.setTime(fakeNow.getTime());
        }
        const entitlements = getEntitlements(result.rows[0], now);
        res.set('Cache-Control', 'no-store');
        res.json({ valid: true, payload: {
            ...payload,
            role: result.rows[0].role,
            plan: entitlements.plan,
            status: entitlements.status,
            privateConversationLimitMs: getPrivateConversationLimitMs({ sub: payload.sub, role: result.rows[0].role, ...entitlements }),
        } });
    } catch (err) {
        const status = sessionErrorStatus(err);
        res.status(status).json({ valid: false, error: status === 401 ? 'Invalid token' : 'Authentication temporarily unavailable' });
    }
});

// Invalidate this account session on the server, not just in browser storage.
app.post('/api/auth/logout', async (req, res) => {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
        const payload = await verifyToken(header.slice(7));
        await endSession(pool, payload);
        res.json({ loggedOut: true });
    } catch (error) {
        const status = sessionErrorStatus(error);
        res.status(status).json({ error: status === 401 ? 'Invalid token' : 'Sign out could not finish. Please retry.' });
    }
});

// Get current user profile
app.get('/api/auth/me', profileHandler(verifyToken, pool));

app.get('/api/auth/me/entitlements', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const authorization = req.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
        return res.json({ plan: 'guest', status: 'paid_active', trialEndsAt: null, features: [], featureMinimumPlans: FEATURE_MIN_PLAN, privateConversationLimitSeconds: 0 });
    }
    try {
        const user = await verifyToken(authorization.slice(7));
        const result = await pool.query(
            `SELECT u.role, u.subscription_plan, u.trial_ends_at, u.enterprise_status, t.plan AS tenant_plan
             FROM users u JOIN tenants t ON t.id = u.tenant_id
             WHERE u.id = $1 AND u.tenant_id = $2 AND u.is_active AND t.is_active`,
            [user.sub, user.tenantId],
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Account not found' });
        const row = result.rows[0];
        let now = new Date();
        if (process.env.NODE_ENV === 'development' && process.env.QSVC_TRIAL_NOW) {
            const fakeNow = new Date(process.env.QSVC_TRIAL_NOW);
            if (!Number.isNaN(fakeNow.getTime())) now = fakeNow;
        }
        const entitlements = getEntitlements(row, now);
        const privateConversationLimitMs = getPrivateConversationLimitMs({ sub: user.sub, role: row.role, ...entitlements });
        res.json({
            ...entitlements,
            privateConversationLimitSeconds: privateConversationLimitMs === null ? null : Math.floor(privateConversationLimitMs / 1000),
        });
    } catch (error) {
        const status = sessionErrorStatus(error);
        res.status(status).json({ error: status === 401 ? 'Invalid session' : 'Entitlements unavailable' });
    }
});

// Administrative plan information is scoped to the verified caller's tenant.
app.get('/api/auth/admin/plan', async (req, res) => {
    const authorization = req.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in required' });
    try {
        const user = await verifyToken(authorization.slice(7));
        if (user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
        const result = await pool.query(
            `SELECT name, plan, max_participants AS "maxParticipants",
                    max_duration_min AS "maxDurationMinutes", storage_quota_gb AS "storageQuotaGb"
             FROM tenants WHERE id = $1 AND is_active`,
            [user.tenantId],
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Organisation not found' });
        res.set('Cache-Control', 'no-store').json(result.rows[0]);
    } catch (error) {
        const status = sessionErrorStatus(error);
        res.status(status).json({ error: status === 401 ? 'Invalid session' : 'Plan information unavailable' });
    }
});

// Update profile
app.patch('/api/auth/me', validateBody(updateProfileBody), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const payload = await verifyToken(authHeader.slice(7));
        const { displayName, avatarUrl, preferences } = req.body;

        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (displayName) { fields.push(`display_name = $${idx++}`); values.push(displayName); }
        if (avatarUrl !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(avatarUrl); }
        if (preferences) {
            delete preferences._authSessionId;
            fields.push(`preferences = (COALESCE(preferences, '{}'::jsonb) - '_authSessionId') || $${idx++}::jsonb || jsonb_build_object('_authSessionId', preferences->'_authSessionId')`);
            values.push(JSON.stringify(preferences));
        }

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

app.use(contactRequestError);
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
