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
