import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from backend directory or workspace root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const { Pool } = pg;

let defaultPool: pg.Pool | null = null;

export function createPool(connectionString?: string): pg.Pool {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return new Pool({ connectionString: url });
}

export function getPool(connectionString?: string): pg.Pool {
  if (connectionString) {
    return createPool(connectionString);
  }
  if (!defaultPool) {
    defaultPool = createPool();
  }
  return defaultPool;
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const p = getPool();
    const value = (p as any)[prop];
    if (typeof value === 'function') {
      return value.bind(p);
    }
    return value;
  },
});

export async function closePool(): Promise<void> {
  if (defaultPool) {
    await defaultPool.end();
    defaultPool = null;
  }
}

export { Pool };
