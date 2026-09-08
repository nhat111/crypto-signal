import type { Logger } from '@crypto-signal/shared';

/**
 * Waiting out the container we are replacing.
 *
 * Telegram allows exactly one long-polling client per token. On every
 * deploy two containers overlap for a moment, and the arriving one is told
 * so with a 409: "terminated by other getUpdates request". Treated as a
 * fatal error that is a deploy that silently does not land — the new
 * container dies, the old one keeps polling, and the service goes on
 * answering with the previous build while the platform reports the deploy
 * as Active.
 *
 * So a 409 is a wait, not a failure. Anything else still throws: a bad
 * token or a revoked bot should fail loudly and immediately, not spend a
 * minute pretending to hand over.
 */
export const HANDOVER_ATTEMPTS = 6;
const BACKOFF_MS = 5_000;

/** Telegram's own code for "another getUpdates is running". */
export const CONFLICT_CODE = 409;

export function isConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const response = (err as { response?: { error_code?: unknown } }).response;
  return response?.error_code === CONFLICT_CODE;
}

export interface HandoverDeps {
  launch: () => Promise<void>;
  logger: Pick<Logger, 'warn' | 'error'>;
  /** Injected so the test does not spend half a minute proving a backoff. */
  wait?: (ms: number) => Promise<void>;
  attempts?: number;
}

/**
 * Resolves when polling has started, or throws once the old container has
 * had long enough that something else must be wrong — two bots sharing one
 * token permanently is a misconfiguration, and quietly retrying forever
 * would hide it.
 */
export async function launchWithHandover(deps: HandoverDeps): Promise<void> {
  const attempts = deps.attempts ?? HANDOVER_ATTEMPTS;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await deps.launch();
      return;
    } catch (err) {
      if (!isConflict(err)) throw err;
      if (attempt === attempts) {
        deps.logger.error(
          { attempts },
          'another bot instance still holds this token — check for a second deployment sharing TELEGRAM_BOT_TOKEN',
        );
        throw err;
      }
      deps.logger.warn({ attempt, attempts }, 'another instance is still polling; waiting for it to exit');
      await wait(BACKOFF_MS * attempt);
    }
  }
}
