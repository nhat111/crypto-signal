-- Which build each service is running.
--
-- /health and /api/status report the commit of the process answering the
-- request — the api. The worker has no HTTP surface, so its build was only
-- visible in a boot log line, which means the question "is the worker on
-- the new code?" could not be answered from the dashboard at all. Deploying
-- services separately is normal here, so that gap came up on every deploy.
--
-- Keyed by service name rather than being worker-specific: the api can
-- record itself the same way, and then one page shows both.

CREATE TABLE service_build (
  service TEXT PRIMARY KEY,
  -- Null when no platform variable was set. Not an error, and it must not
  -- be confused with "not deployed" — see packages/shared/src/version.ts.
  commit TEXT,
  commit_source TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
