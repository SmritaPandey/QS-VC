import type { Pool, QueryResult, QueryResultRow } from 'pg';
export function tenantDatabase(pool: Pool): {
    runWithTenant<T>(tenantId: string, action: () => T): T;
    query<T extends QueryResultRow = any>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
};
