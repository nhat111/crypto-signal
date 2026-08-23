import pg from 'pg';

let pool: pg.Pool | undefined;

export function getPool(connectionString: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
