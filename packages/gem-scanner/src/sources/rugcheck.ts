import { z } from 'zod';
import type { Logger } from '@crypto-signal/shared';
import type { ChainId, SafetyReport, SafetySource, SafetyVerdict } from '../types.js';
import { fetchJsonValidated } from './http.js';

/**
 * RugCheck adapter — Solana token safety screening.
 *
 * Two rules govern this file, because getting safety wrong is the most
 * expensive mistake this scanner can make:
 *
 * 1. **A screen that could not run reports `unknown`, never `safe`.** Any
 *    failure — network, auth, unmapped chain, unreadable payload — yields
 *    `unknown` so the scoring gate can treat it as unverified instead of
 *    quietly clearing a token nobody checked.
 * 2. **Individual checks are `null` when unreported, never `false`.**
 *    "We couldn't read whether the mint authority is revoked" and "the mint
 *    authority is NOT revoked" mean opposite things to a buyer.
 *
 * Unlike the market-data adapters, the schema here is deliberately lenient
 * (every field optional): a partial response should still surface whatever
 * flags it does contain rather than throwing away real warnings.
 */

const riskSchema = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
  level: z.string().nullish(),
});

const reportSchema = z.object({
  score: z.number().nullish(),
  /** Present on newer responses; lower is safer on `score_normalised`. */
  score_normalised: z.number().nullish(),
  risks: z.array(riskSchema).nullish(),
  token: z
    .object({
      mintAuthority: z.string().nullish(),
      freezeAuthority: z.string().nullish(),
    })
    .nullish(),
  topHolders: z.array(z.object({ pct: z.number().nullish() }).passthrough()).nullish(),
  markets: z
    .array(
      z
        .object({
          lp: z.object({ lpLockedPct: z.number().nullish() }).passthrough().nullish(),
        })
        .passthrough(),
    )
    .nullish(),
});

const BASE_URL = 'https://api.rugcheck.xyz/v1';

/** Any single top holder above this share of supply is called out as concentration risk. */
const SINGLE_HOLDER_CONCENTRATION_PCT = 20;
/** Combined top-10 share above this is called out too — many medium holders can rug as effectively as one whale. */
const TOP10_CONCENTRATION_PCT = 60;
/** Below this locked share, LP is treated as effectively unlocked. */
const LP_LOCKED_MIN_PCT = 50;

export interface RugCheckOptions {
  logger: Logger;
  /** Optional; RugCheck documents a per-developer key in the X-API-KEY header. Without it, requests are attempted unauthenticated and degrade to `unknown` if rejected. */
  apiKey?: string;
  baseUrl?: string;
}

export class RugCheckSource implements SafetySource {
  readonly name = 'rugcheck';
  private readonly baseUrl: string;

  constructor(private readonly opts: RugCheckOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  supportsChain(chainId: ChainId): boolean {
    return chainId === 'solana';
  }

  async screen(chainId: ChainId, tokenAddress: string): Promise<SafetyReport> {
    const unknownReport = (reason: string): SafetyReport => ({
      chainId,
      tokenAddress,
      verdict: 'unknown',
      flags: [reason],
      topHolderPct: null,
      lpLocked: null,
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      checkedAt: Date.now(),
    });

    if (!this.supportsChain(chainId)) {
      return unknownReport(`Safety screening is not available for ${chainId} — this token was not checked.`);
    }

    try {
      const report = await fetchJsonValidated({
        url: `${this.baseUrl}/tokens/${encodeURIComponent(tokenAddress)}/report`,
        schema: reportSchema,
        source: this.name,
        logger: this.opts.logger,
        headers: this.opts.apiKey ? { 'X-API-KEY': this.opts.apiKey } : {},
        // A failed safety check must not stall a whole scan.
        timeoutMs: 10_000,
        maxRetries: 1,
      });
      return interpretRugCheckReport(chainId, tokenAddress, report);
    } catch (err) {
      this.opts.logger.warn({ err, tokenAddress }, 'rugcheck screen failed — reporting unknown, not safe');
      return unknownReport('Safety screen could not be completed — treat this token as unverified.');
    }
  }
}

type RugCheckReport = z.infer<typeof reportSchema>;

/**
 * Pure translation from RugCheck's payload to our verdict, so the
 * decision logic is unit-testable without a network call.
 *
 * On Solana, an authority field that is present and non-empty means the
 * authority still exists (i.e. NOT revoked); `null` means it was revoked.
 * An absent field means the report didn't say — mapped to `null` in our
 * report, not to a guess.
 */
export function interpretRugCheckReport(chainId: ChainId, tokenAddress: string, report: RugCheckReport): SafetyReport {
  const flags: string[] = [];

  const mintAuthorityRevoked = report.token === null || report.token === undefined ? null : report.token.mintAuthority == null;
  const freezeAuthorityRevoked = report.token === null || report.token === undefined ? null : report.token.freezeAuthority == null;

  if (mintAuthorityRevoked === false) flags.push('Mint authority is still active — supply can be inflated.');
  if (freezeAuthorityRevoked === false) flags.push('Freeze authority is still active — transfers can be frozen.');

  const holderPcts = (report.topHolders ?? []).map((h) => h.pct).filter((p): p is number => typeof p === 'number');
  const topHolderPct = holderPcts.length > 0 ? Math.max(...holderPcts) : null;
  const top10Pct = holderPcts.slice(0, 10).reduce((a, b) => a + b, 0);

  if (topHolderPct !== null && topHolderPct >= SINGLE_HOLDER_CONCENTRATION_PCT) {
    flags.push(`Largest holder controls ${topHolderPct.toFixed(1)}% of supply.`);
  }
  if (holderPcts.length > 0 && top10Pct >= TOP10_CONCENTRATION_PCT) {
    flags.push(`Top holders together control ${top10Pct.toFixed(1)}% of supply.`);
  }

  const lockedPcts = (report.markets ?? [])
    .map((m) => m.lp?.lpLockedPct)
    .filter((p): p is number => typeof p === 'number');
  const lpLocked = lockedPcts.length > 0 ? Math.max(...lockedPcts) >= LP_LOCKED_MIN_PCT : null;
  if (lpLocked === false) flags.push('Liquidity pool is not meaningfully locked — it can be pulled.');

  for (const risk of report.risks ?? []) {
    const level = (risk.level ?? '').toLowerCase();
    if (level === 'danger' || level === 'warn' || level === 'warning') {
      flags.push(risk.description ?? risk.name ?? 'Unnamed risk reported by the safety screen.');
    }
  }

  return {
    chainId,
    tokenAddress,
    verdict: verdictFrom({ mintAuthorityRevoked, freezeAuthorityRevoked, lpLocked, topHolderPct, top10Pct, flagCount: flags.length }),
    flags,
    topHolderPct,
    lpLocked,
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    checkedAt: Date.now(),
  };
}

interface VerdictInputs {
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  lpLocked: boolean | null;
  topHolderPct: number | null;
  top10Pct: number;
  flagCount: number;
}

function verdictFrom(inputs: VerdictInputs): SafetyVerdict {
  // Any one of these alone is enough to hand the holder's money to someone
  // else, so they're outright dangerous rather than merely worrying.
  const criticalFailure =
    inputs.mintAuthorityRevoked === false || inputs.freezeAuthorityRevoked === false || inputs.lpLocked === false;
  if (criticalFailure) return 'danger';

  // Nothing verifiable came back — say so rather than implying a clean bill.
  const nothingConfirmed =
    inputs.mintAuthorityRevoked === null && inputs.freezeAuthorityRevoked === null && inputs.lpLocked === null;
  if (nothingConfirmed) return 'unknown';

  const concentrated =
    (inputs.topHolderPct !== null && inputs.topHolderPct >= SINGLE_HOLDER_CONCENTRATION_PCT) ||
    inputs.top10Pct >= TOP10_CONCENTRATION_PCT;
  if (concentrated || inputs.flagCount > 0) return 'caution';

  return 'safe';
}

export const SAFETY_THRESHOLDS = {
  SINGLE_HOLDER_CONCENTRATION_PCT,
  TOP10_CONCENTRATION_PCT,
  LP_LOCKED_MIN_PCT,
};
