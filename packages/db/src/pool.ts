import pg from 'pg';

let pool: pg.Pool | undefined;

export function getPool(connectionString: string): pg.Pool {
  if (!pool) {
    // PG_POOL_MAX: free-tier Postgres (Supabase/Neon) caps connections, and the
    // all-in-one image runs two pools against it. Default unchanged.
    pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX) || 10 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
