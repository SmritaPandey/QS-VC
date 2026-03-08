import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

export const config = {
    port: parseInt(process.env.PORT || process.env.SIGNALING_PORT || '4001', 10),
    sfuUrl: process.env.SFU_INTERNAL_URL || 'http://localhost:4000',

    jwt: {
        secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
        expiry: process.env.JWT_EXPIRY || '24h',
    },

    // Redis — supports REDIS_URL (Render) or individual env vars (local)
    redisUrl: process.env.REDIS_URL || undefined,
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },

    // DB — supports DATABASE_URL (Render) or individual env vars (local)
    databaseUrl: process.env.DATABASE_URL || undefined,
    db: {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'qsvc',
        user: process.env.POSTGRES_USER || 'qsvc',
        password: process.env.POSTGRES_PASSWORD || 'qsvc_dev_2025',
    },
};
