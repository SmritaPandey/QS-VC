import type { PoolConfig } from 'pg';
export function databaseConfig(env?: Record<string, string | undefined>): Omit<PoolConfig, 'Client'>;
