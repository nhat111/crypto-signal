import type { z } from 'zod';
import type { Logger } from '@crypto-signal/shared';

export class UpstreamShapeError extends Error {
  constructor(
    public readonly source: string,
    public readonly url: string,
    public readonly issues: string,
    public readonly received: unknown,
  ) {
    super(`${source} returned an unexpected shape for ${url}: ${issues}`);
    this.name = 'UpstreamShapeError';
  }
}

export interface FetchJsonOptions<T> {
  url: string;
  /** Input is `unknown` on purpose: the schema's job is to turn an untrusted payload into T, including via transforms. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  source: string;
  logger: Logger;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Fetch + validate in one step.
 *
 * The response shape is validated against a zod schema at the boundary
 * rather than trusted. These upstream APIs could not be probed from the
 * build environment (see ASSUMPTIONS.md §16), so a field name being wrong
 * is a real possibility — this makes that fail loudly, with the actual
 * payload logged, instead of silently producing scores from `undefined`.
 * A scanner quietly ranking tokens on garbage numbers would be far worse
 * than one that refuses to run.
 */
export async function fetchJsonValidated<T>(opts: FetchJsonOptions<T>): Promise<T> {
  const { url, schema, source, logger } = opts;
  const maxRetries = opts.maxRetries ?? 2;

  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let raw: unknown;
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });

      if (res.status === 429) {
        const delayMs = 1000 * 2 ** attempt;
        logger.warn({ source, url, attempt, delayMs }, 'upstream rate limited, backing off');
        await sleep(delayMs);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      raw = await res.json();
    } catch (err) {
      lastNetworkError = err;
      if (attempt <= maxRetries) {
        await sleep(500 * attempt);
        continue;
      }
      throw err;
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      // Not retried: a shape mismatch is a contract change, not a transient
      // fault, and retrying would just repeat it.
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      logger.error({ source, url, issues, receivedSample: sampleOf(raw) }, 'upstream response failed schema validation');
      throw new UpstreamShapeError(source, url, issues, raw);
    }
    return parsed.data;
  }

  throw lastNetworkError ?? new Error(`${source}: exhausted retries for ${url}`);
}

/** Keeps the error log readable when the payload is a huge array. */
function sampleOf(raw: unknown): unknown {
  if (Array.isArray(raw)) return { arrayLength: raw.length, first: raw[0] };
  return raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
