const { readFileSync } = require('node:fs');

// One deployment has one database; never silently fail over writes to another site.
function databaseConfig(env = process.env) {
    const url = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
    const host = url ? url.hostname : (env.POSTGRES_HOST || 'localhost');
    const local = ['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(host);
    const tls = env.POSTGRES_SSL || (local ? 'disable' : 'verify-full');
    if (!['disable', 'verify-full'].includes(tls)) throw new Error('POSTGRES_SSL must be disable or verify-full');
    if (url) {
        // pg URL SSL options otherwise override the verified TLS configuration below.
        for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    }
    return {
        ...(url ? { connectionString: url.toString() } : {
            host, port: Number(env.POSTGRES_PORT || 5432),
            database: env.POSTGRES_DB || 'qsvc', user: env.POSTGRES_USER || 'qsvc',
            password: env.POSTGRES_PASSWORD || 'qsvc_dev_2025',
        }),
        ssl: tls === 'disable' ? false : {
            rejectUnauthorized: true,
            ...(env.POSTGRES_CA_FILE ? { ca: readFileSync(env.POSTGRES_CA_FILE, 'utf8') } : {}),
        },
        max: 10,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
        statement_timeout: 5000,
        lock_timeout: 2000,
        idle_in_transaction_session_timeout: 10000,
        query_timeout: 8000,
        keepAlive: true,
        application_name: env.DB_APPLICATION_NAME || 'qsvc',
    };
}
module.exports = { databaseConfig };
