#!/usr/bin/env node
// Minimal migration runner: applies db/migrations/*.sql in filename order,
// tracked in a schema_migrations table. No down-migrations for MVP — good
// enough for a project at this stage (rule: don't over-engineer).
//
// Both `worker` and `api` run this at boot (see their Dockerfiles), so that
// neither service can ever come up ahead of the schema it queries — an api
// deployed before the worker used to serve 500s ("relation … does not
// exist") until the worker caught up. That means two runners can race on
// startup, so the whole run is serialized behind a Postgres advisory lock:
// the second one blocks, then finds every migration already applied and
// no-ops.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

/**
 * Arbitrary but fixed application-wide key. Advisory locks live in their own
 * namespace and touch no table, so this can't collide with anything the app
 * itself locks — it only has to be the same number in every runner.
 */
const MIGRATION_LOCK_KEY = 4_071_923_517;

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://crypto:crypto@localhost:5432/crypto_market_health';
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Taken before the schema_migrations bootstrap, not just around the
    // apply loop: concurrent CREATE TABLE IF NOT EXISTS can still fail on a
    // duplicate pg_type entry, and reading the applied set before the lock
    // would let both runners decide to apply the same file.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
      const { rows } = await client.query('SELECT filename FROM schema_migrations');
      const applied = new Set(rows.map((r) => r.filename));

      for (const file of files) {
        if (applied.has(file)) {
          console.log(`skip (already applied): ${file}`);
          continue;
        }
        const sql = await readFile(join(migrationsDir, file), 'utf8');
        console.log(`applying: ${file}`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }

      console.log('migrations up to date');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
