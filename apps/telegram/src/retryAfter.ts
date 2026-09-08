/**
 * Telegram's rate limit, honoured rather than fought.
 *
 * A 429 carries `parameters.retry_after` — the number of seconds the API
 * wants before the next attempt. Retrying sooner than that earns another
 * 429, so the only useful retry is the one that waits exactly as long as
 * it was told to.
 */
export function retryAfterSeconds(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const response = (err as { response?: { error_code?: unknown; parameters?: { retry_after?: unknown } } }).response;
  if (response?.error_code !== 429) return null;
  const seconds = response.parameters?.retry_after;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * The longest we will hold up a boot for a cosmetic call.
 *
 * Telegram can ask for a wait measured in minutes after a burst of
 * deploys. The command menu is worth a few seconds and not a few minutes:
 * past this the boot continues with a stale menu, which costs a label
 * being out of date, while blocking would cost the bot being absent.
 */
export const MAX_RETRY_WAIT_SECONDS = 20;

export interface RetryOn429Deps {
  attempt: () => Promise<void>;
  logger: { warn: (obj: object, msg: string) => void };
  wait?: (ms: number) => Promise<void>;
  maxWaitSeconds?: number;
}

/**
 * Runs `attempt`, retrying once if Telegram asks for a wait it is worth
 * honouring. Never throws: the caller treats this as decoration, and a
 * failed menu update must not take the bot down with it.
 */
export async function retryOn429(deps: RetryOn429Deps): Promise<boolean> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxWait = deps.maxWaitSeconds ?? MAX_RETRY_WAIT_SECONDS;

  try {
    await deps.attempt();
    return true;
  } catch (err) {
    const seconds = retryAfterSeconds(err);
    if (seconds === null) {
      deps.logger.warn({ err }, 'setMyCommands failed (non-fatal)');
      return false;
    }
    if (seconds > maxWait) {
      deps.logger.warn({ retryAfter: seconds, maxWait }, 'rate limited for longer than a boot should wait — menu stays stale');
      return false;
    }

    deps.logger.warn({ retryAfter: seconds }, 'rate limited; waiting the requested time before one more try');
    await wait(seconds * 1000);
    try {
      await deps.attempt();
      return true;
    } catch (retryErr) {
      deps.logger.warn({ err: retryErr }, 'setMyCommands failed again (non-fatal)');
      return false;
    }
  }
}
