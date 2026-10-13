import {
  FUNDAMENTAL_THRESHOLDS,
  matchChain,
  readFundamentals,
  type CoinFundamentals,
  type DayValue,
  type LlamaChain,
  type LlamaFees,
  type LlamaProtocol,
} from '@crypto-signal/indicators';
import type { Logger } from '@crypto-signal/shared';

/** What the fundamentals read needs from DefiLlama — an interface so it can be tested without a network. */
export interface FundamentalsSource {
  chains(): Promise<LlamaChain[]>;
  protocols(): Promise<LlamaProtocol[]>;
  fees(): Promise<LlamaFees[]>;
  chainTvl(chain: string): Promise<DayValue[]>;
  chainStablecoins(chain: string): Promise<DayValue[]>;
}

/**
 * Fundamentals for every scanned coin, keyed by base symbol (SOL, UNI…).
 *
 * The three big lists are fetched one after another rather than at once:
 * together they are ~15 MB of JSON, and parsing them side by side doubles
 * the peak on a 512 MB host for a job that has a whole day to finish.
 * Per-chain history is fetched only for chains big enough to be read at
 * all, and a failed history costs that one coin a driver, not the scan.
 */
export async function readCoinFundamentals(source: FundamentalsSource, bases: string[], logger: Logger): Promise<Map<string, CoinFundamentals>> {
  const chains = await source.chains();
  const protocols = await source.protocols();
  const fees = await source.fees();

  const out = new Map<string, CoinFundamentals>();
  for (const base of bases) {
    const chain = matchChain(base, chains);
    let chainTvl: DayValue[] | null | undefined;
    let chainStablecoins: DayValue[] | null | undefined;
    if (chain && chain.tvl >= FUNDAMENTAL_THRESHOLDS.minTvlUsd) {
      chainTvl = await source.chainTvl(chain.name).catch((err: unknown) => {
        logger.warn({ err, chain: chain.name }, 'defillama chain TVL history failed');
        return null;
      });
      // Not every chain has a stablecoin series; an empty answer is "none", not a failure.
      chainStablecoins = await source.chainStablecoins(chain.name).catch(() => undefined);
    }
    out.set(base, readFundamentals({ base, chains, protocols, fees, chainTvl, chainStablecoins }));
  }
  return out;
}
