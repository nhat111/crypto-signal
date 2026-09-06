import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';
import type { ChainId, SafetyReport, SafetySource, SafetyVerdict } from '../types.js';

/**
 * GoPlus adapter — token safety screening for EVM chains.
 *
 * The counterpart to RugCheck, which covers Solana and nothing else. Until
 * this existed, every EVM chain ran with `safety = null`, which meant the
 * scoring gate's `safetyDisqualifies` check could never fire: a honeypot
 * scored like anything else and the only trace was one line in the reasons
 * list. On BSC in particular that is the difference between a screened
 * candidate and a coin flip.
 *
 * The same two rules as RugCheck govern this file, for the same reason:
 *
 * 1. **A screen that could not run reports `unknown`, never `safe`.** Any
 *    failure — network, unmapped chain, unreadable payload, a token the
 *    API has no data for — yields `unknown`, so the gate treats it as
 *    unverified rather than quietly clearing something nobody checked.
 * 2. **Individual checks are `null` when unreported, never `false`.**
 *    "We could not read whether this is a honeypot" and "this is not a
 *    honeypot" mean opposite things to a buyer.
 *
 * GoPlus returns its booleans as the *strings* "0" and "1", and omits keys
 * it has no answer for. Both are handled deliberately: an absent key is
 * null, and any value that is neither "0" nor "1" is null rather than
 * being coerced to false.
 */

/** GoPlus reports booleans as "0"/"1" strings, and omits what it does not know. */
const flagSchema = z.string().nullish();

const tokenSecuritySchema = z
  .object({
    is_honeypot: flagSchema,
    cannot_sell_all: flagSchema,
    is_blacklisted: flagSchema,
    is_proxy: flagSchema,
    is_mintable: flagSchema,
    can_take_back_ownership: flagSchema,
    owner_change_balance: flagSchema,
    hidden_owner: flagSchema,
    selfdestruct: flagSchema,
    transfer_pausable: flagSchema,
    is_open_source: flagSchema,
    buy_tax: z.string().nullish(),
    sell_tax: z.string().nullish(),
    lp_holders: z
      .array(z.object({ is_locked: z.number().nullish(), percent: z.string().nullish() }).passthrough())
      .nullish(),
    holders: z.array(z.object({ percent: z.string().nullish() }).passthrough()).nullish(),
  })
  .passthrough();

const responseSchema = z.object({
  code: z.number().nullish(),
  message: z.string().nullish(),
  /** Keyed by lowercased token address. Absent when GoPlus has no data for it. */
  result: z.record(z.string(), tokenSecuritySchema).nullish(),
});

const BASE_URL = 'https://api.gopluslabs.io/api/v1';

/**
 * DexScreener chain slug to the EVM chain id GoPlus expects.
 *
 * Only chains GoPlus is known to cover are listed. An unmapped chain skips
 * this source and the token is reported unverified — the same discipline
 * as the GeckoTerminal network table, and for the same reason: a guessed
 * id returns an empty result that is indistinguishable from a clean token.
 *
 * Deliberately absent: `robinhood` (chain 4663). The chain id is known,
 * but whether GoPlus indexes a chain that new is not, and claiming a
 * screen ran when it returned nothing is the one failure this file exists
 * to prevent.
 */
const GOPLUS_CHAIN_ID_BY_CHAIN: Record<string, string> = {
  ethereum: '1',
  bsc: '56',
  base: '8453',
  polygon: '137',
  arbitrum: '42161',
  avalanche: '43114',
  optimism: '10',
};

export function toGoPlusChainId(chainId: ChainId): string | null {
  return GOPLUS_CHAIN_ID_BY_CHAIN[chainId] ?? null;
}

/** Tax at or above this share is treated as a trap rather than a fee. */
const PUNITIVE_TAX_PCT = 10;
/** Any single holder above this share of supply is called out. */
const SINGLE_HOLDER_CONCENTRATION_PCT = 20;
/** Combined top-10 share above this is called out too. */
const TOP10_CONCENTRATION_PCT = 60;

export interface GoPlusOptions {
  logger: Logger;
  baseUrl?: string;
}

export class GoPlusSource implements SafetySource {
  readonly name = 'goplus';
  private readonly baseUrl: string;

  constructor(private readonly opts: GoPlusOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  supportsChain(chainId: ChainId): boolean {
    return toGoPlusChainId(chainId) !== null;
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

    const goPlusChainId = toGoPlusChainId(chainId);
    if (goPlusChainId === null) {
      return unknownReport(`Safety screening is not available for ${chainId} — this token was not checked.`);
    }

    try {
      const res = await fetchJsonValidated({
        url: `${this.baseUrl}/token_security/${goPlusChainId}?contract_addresses=${encodeURIComponent(tokenAddress)}`,
        schema: responseSchema,
        source: this.name,
        logger: this.opts.logger,
        // A failed safety check must not stall a whole scan.
        timeoutMs: 10_000,
        maxRetries: 1,
      });

      // GoPlus keys its result by the lowercased address, and returns an
      // empty object for a token it has never seen. No data is not a clean
      // bill of health.
      const security = res.result?.[tokenAddress.toLowerCase()] ?? res.result?.[tokenAddress];
      if (!security) {
        return unknownReport('Safety screen returned no data for this token — treat it as unverified.');
      }

      return interpretGoPlusReport(chainId, tokenAddress, security);
    } catch (err) {
      this.opts.logger.warn({ err, chainId, tokenAddress }, 'goplus screen failed — reporting unknown, not safe');
      return unknownReport('Safety screen could not be completed — treat this token as unverified.');
    }
  }
}

type GoPlusSecurity = z.infer<typeof tokenSecuritySchema>;

/**
 * GoPlus's "0"/"1" strings, read without guessing.
 *
 * An absent key, an empty string or anything unexpected is `null`. Mapping
 * those to `false` would turn "we don't know" into "it is fine", which is
 * exactly the direction this must never fail in.
 */
export function readFlag(value: string | null | undefined): boolean | null {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

/** GoPlus returns taxes as decimal-fraction strings ("0.05" = 5%). Unparseable is null, not zero. */
export function readTaxPct(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 100 : null;
}

/**
 * Pure translation from GoPlus's payload to our verdict, so the decision
 * logic is unit-testable without a network call.
 */
export function interpretGoPlusReport(chainId: ChainId, tokenAddress: string, s: GoPlusSecurity): SafetyReport {
  const flags: string[] = [];

  const honeypot = readFlag(s.is_honeypot);
  const cannotSellAll = readFlag(s.cannot_sell_all);
  const blacklisted = readFlag(s.is_blacklisted);
  const transferPausable = readFlag(s.transfer_pausable);
  const canTakeBackOwnership = readFlag(s.can_take_back_ownership);
  const ownerChangeBalance = readFlag(s.owner_change_balance);
  const selfdestruct = readFlag(s.selfdestruct);
  const hiddenOwner = readFlag(s.hidden_owner);
  const mintable = readFlag(s.is_mintable);
  const openSource = readFlag(s.is_open_source);

  if (honeypot === true) flags.push('Honeypot: the contract prevents selling.');
  if (cannotSellAll === true) flags.push('Cannot sell the full balance — a partial exit trap.');
  if (blacklisted === true) flags.push('Contract can blacklist addresses from selling.');
  if (transferPausable === true) flags.push('Transfers can be paused by the owner.');
  if (canTakeBackOwnership === true) flags.push('Ownership can be reclaimed after being renounced.');
  if (ownerChangeBalance === true) flags.push('Owner can change balances directly.');
  if (selfdestruct === true) flags.push('Contract can self-destruct.');
  if (hiddenOwner === true) flags.push('Contract has a hidden owner.');
  if (mintable === true) flags.push('Supply can be minted — it can be inflated.');
  if (openSource === false) flags.push('Contract source is not verified — nobody can read what it does.');

  const buyTax = readTaxPct(s.buy_tax);
  const sellTax = readTaxPct(s.sell_tax);
  if (buyTax !== null && buyTax >= PUNITIVE_TAX_PCT) flags.push(`Buy tax is ${buyTax.toFixed(1)}%.`);
  if (sellTax !== null && sellTax >= PUNITIVE_TAX_PCT) flags.push(`Sell tax is ${sellTax.toFixed(1)}%.`);

  // LP is "locked" when a majority of it sits in locked holders. Anything
  // less is a pool that can be pulled.
  const lpHolders = s.lp_holders ?? [];
  const lockedShare = lpHolders
    .filter((h) => h.is_locked === 1)
    .reduce((sum, h) => sum + (Number(h.percent) || 0), 0);
  const lpLocked = lpHolders.length > 0 ? lockedShare >= 0.5 : null;
  if (lpLocked === false) flags.push('Liquidity pool is not meaningfully locked — it can be pulled.');

  const holderPcts = (s.holders ?? [])
    .map((h) => Number(h.percent))
    .filter((p) => Number.isFinite(p))
    .map((p) => p * 100);
  const topHolderPct = holderPcts.length > 0 ? Math.max(...holderPcts) : null;
  const top10Pct = holderPcts.slice(0, 10).reduce((a, b) => a + b, 0);

  if (topHolderPct !== null && topHolderPct >= SINGLE_HOLDER_CONCENTRATION_PCT) {
    flags.push(`Largest holder controls ${topHolderPct.toFixed(1)}% of supply.`);
  }
  if (holderPcts.length > 0 && top10Pct >= TOP10_CONCENTRATION_PCT) {
    flags.push(`Top holders together control ${top10Pct.toFixed(1)}% of supply.`);
  }

  return {
    chainId,
    tokenAddress,
    verdict: verdictFrom({
      honeypot,
      cannotSellAll,
      ownerChangeBalance,
      selfdestruct,
      lpLocked,
      buyTax,
      sellTax,
      openSource,
      topHolderPct,
      top10Pct,
      flagCount: flags.length,
    }),
    flags,
    topHolderPct,
    lpLocked,
    // EVM has no mint/freeze authority in Solana's sense. `is_mintable` is
    // the closest analogue for minting; there is no freeze equivalent, and
    // null says so rather than implying a check that never happened.
    mintAuthorityRevoked: mintable === null ? null : !mintable,
    freezeAuthorityRevoked: null,
    checkedAt: Date.now(),
  };
}

interface VerdictInputs {
  honeypot: boolean | null;
  cannotSellAll: boolean | null;
  ownerChangeBalance: boolean | null;
  selfdestruct: boolean | null;
  lpLocked: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  openSource: boolean | null;
  topHolderPct: number | null;
  top10Pct: number;
  flagCount: number;
}

function verdictFrom(i: VerdictInputs): SafetyVerdict {
  // Each of these alone hands the holder's money to someone else, so they
  // are outright dangerous rather than merely worrying.
  const criticalFailure =
    i.honeypot === true ||
    i.cannotSellAll === true ||
    i.ownerChangeBalance === true ||
    i.selfdestruct === true ||
    i.lpLocked === false ||
    (i.sellTax !== null && i.sellTax >= PUNITIVE_TAX_PCT);
  if (criticalFailure) return 'danger';

  // Nothing verifiable came back — say so rather than implying a clean
  // bill. The three checks that matter most are the ones that must have
  // been readable for a "safe" to mean anything.
  const nothingConfirmed = i.honeypot === null && i.lpLocked === null && i.openSource === null;
  if (nothingConfirmed) return 'unknown';

  const concentrated =
    (i.topHolderPct !== null && i.topHolderPct >= SINGLE_HOLDER_CONCENTRATION_PCT) ||
    i.top10Pct >= TOP10_CONCENTRATION_PCT;
  if (concentrated || i.flagCount > 0) return 'caution';

  return 'safe';
}

export const GOPLUS_THRESHOLDS = {
  PUNITIVE_TAX_PCT,
  SINGLE_HOLDER_CONCENTRATION_PCT,
  TOP10_CONCENTRATION_PCT,
};
