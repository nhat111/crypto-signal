import { Pool } from 'pg';

/**
 * A pool for tests that need real SQL, or null when none is configured.
 *
 * Every query in this package was verified by hand against a local
 * Postgres and then thrown away, which meant the LATERAL join that fixed
 * the outcome tracker, the census that explains a stuck backlog and the
 * heartbeat upsert had no regression cover at all — the exact code where a
 * silent wrong answer is most expensive, and the only code a unit test
 * with a fake pool cannot check.
 *
 * Gated on an environment variable so `npm test` on a laptop with no
 * database still passes and still runs everything else. CI provides one.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';

export const hasTestDatabase = TEST_DATABASE_URL.length > 0;

export function createTestPool(): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL });
}

/**
 * Serialises test files that truncate the same tables.
 *
 * Vitest runs files in parallel and they share one database, so two suites
 * that both `DELETE FROM gem_outcomes` will read each other's half-built
 * fixtures — passing alone and failing together, which is the worst way
 * for a test to be wrong. Merging the files is not an option when they
 * live in different workspaces: the writer is in apps/worker and the
 * reader is here.
 *
 * A Postgres advisory lock is what this is for, and the migration runner
 * already uses one for the same reason. The lock is held on a dedicated
 * client because advisory locks belong to a connection, not a pool.
 */
export async function lockTestTables(pool: Pool, key: number): Promise<() => Promise<void>> {
  const client = await pool.connect();
  await client.query('SELECT pg_advisory_lock($1)', [key]);
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [key]);
    client.release();
  };
}

/** One key per group of tables a suite clears. Arbitrary, only has to be agreed on. */
export const GEM_TABLES_LOCK = 991_001;

