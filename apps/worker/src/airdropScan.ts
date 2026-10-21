import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import { DefiLlamaProtocolSource } from '@crypto-signal/market-data';
import { screenAirdropCandidates, type AirdropThresholds } from '@crypto-signal/indicators';
import { JOB_AIRDROP_SCAN, getAirdropTvl30dAgo, recordJobFailure, recordJobSuccess, replaceAirdropCandidates } from '@crypto-signal/db';

export interface AirdropScanDeps {
  pool: Pool;
  logger: Logger;
  thresholds: AirdropThresholds;
  /** Injected for tests. */
  source?: Pick<DefiLlamaProtocolSource, 'fetchProtocols'>;
  nowMs?: number;
}

/**
 * Refreshes today's airdrop research list from DefiLlama.
 *
 * Off the Binance pipeline like the stablecoin series: its own timer, its
 * own try/catch, and DefiLlama being down changes nothing else. The day is
 * the UTC calendar day; reruns replace it, so the latest pass wins and a
 * protocol that launched a token since the last one drops off.
 */
export async function runAirdropScanCycle(deps: AirdropScanDeps): Promise<void> {
  const { pool, logger } = deps;
  try {
    const source = deps.source ?? new DefiLlamaProtocolSource({ logger });
    const { protocols, dropped } = await source.fetchProtocols();
    if (protocols.length === 0) {
      await recordJobFailure(pool, JOB_AIRDROP_SCAN, new Error('upstream returned no usable protocols'));
      logger.warn({ dropped }, 'airdrop scan: no usable protocols');
      return;
    }

    const nowMs = deps.nowMs ?? Date.now();
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const history = await getAirdropTvl30dAgo(pool, day);
    const candidates = screenAirdropCandidates(protocols, deps.thresholds, history, nowMs);
    await replaceAirdropCandidates(pool, day, candidates);
    await recordJobSuccess(pool, JOB_AIRDROP_SCAN);

    logger.info({ day, protocols: protocols.length, dropped, candidates: candidates.length }, 'airdrop scan stored');
  } catch (err) {
    await recordJobFailure(pool, JOB_AIRDROP_SCAN, err).catch(() => {
      // Recording the failure must not mask the failure itself.
    });
    throw err;
  }
}
