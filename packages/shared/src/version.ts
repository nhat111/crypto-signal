/**
 * Which build is actually running.
 *
 * "Did my deploy land?" had no direct answer: the only way to tell was to
 * probe for a behaviour the new code has and the old one does not, which
 * needs you to already know what changed, and silently misleads whenever
 * the two behave the same on the path you happened to poke.
 *
 * Platforms inject the commit under their own name, so several are read
 * rather than assuming one. GIT_COMMIT is listed first as the manual
 * override — if a platform's variable is not among these, setting that one
 * by hand always works.
 */
const COMMIT_ENV_VARS = [
  'GIT_COMMIT',
  'RAILWAY_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'RENDER_GIT_COMMIT',
  'HEROKU_SLUG_COMMIT',
  'SOURCE_VERSION',
] as const;

/** Long enough to identify a commit, short enough to read at a glance. */
const SHORT_SHA_LENGTH = 7;

export interface BuildInfo {
  /** Null when no platform variable is set — say so rather than inventing a version. */
  commit: string | null;
  /** The variable it came from, so a wrong-looking value can be traced. */
  commitSource: string | null;
  startedAt: number;
}

export function resolveBuildInfo(env: NodeJS.ProcessEnv = process.env, startedAt = Date.now()): BuildInfo {
  for (const name of COMMIT_ENV_VARS) {
    const value = env[name]?.trim();
    if (value) {
      return { commit: value.slice(0, SHORT_SHA_LENGTH), commitSource: name, startedAt };
    }
  }
  return { commit: null, commitSource: null, startedAt };
}
