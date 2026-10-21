import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { AirdropCandidate } from '@crypto-signal/indicators';
import { createTestPool, hasTestDatabase } from './testPool.js';
import {
  addFarmAction,
  deleteFarm,
  getAirdropTvl30dAgo,
  getFarms,
  getLatestAirdropCandidates,
  logFarmAction,
  replaceAirdropCandidates,
  startFarm,
  updateFarm,
} from './airdrop.js';

const CHAT = 'test-airdrop-farms';

function candidate(slug: string, tvlUsd: number): AirdropCandidate {
  return {
    slug,
    name: slug,
    category: 'Lending',
    chains: ['Ethereum'],
    tvlUsd,
    change1dPct: null,
    change7dPct: 5,
    change30dPct: null,
    url: null,
    twitter: null,
    logo: null,
    listedAtMs: Date.UTC(2026, 8, 1),
    audits: 1,
    parentSlug: null,
    reasons: ['r'],
    unknowns: ['u'],
  };
}

describe.skipIf(!hasTestDatabase)('airdrop storage against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query("DELETE FROM airdrop_candidates WHERE slug LIKE 'test-%'");
    await pool.query('DELETE FROM airdrop_farms WHERE chat_id = $1', [CHAT]);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM airdrop_candidates WHERE slug LIKE 'test-%'");
    await pool.query('DELETE FROM airdrop_farms WHERE chat_id = $1', [CHAT]);
    await pool.end();
  });

  it('replaces a day, reads the latest day back and finds TVL 30 days earlier', async () => {
    await replaceAirdropCandidates(pool, '2099-01-01', [candidate('test-a', 100), candidate('test-b', 50)]);
    await replaceAirdropCandidates(pool, '2099-02-01', [candidate('test-a', 300), candidate('test-gone', 1)]);
    // A rerun the same day drops what is no longer on the list.
    await replaceAirdropCandidates(pool, '2099-02-01', [candidate('test-a', 300)]);

    const latest = await getLatestAirdropCandidates(pool);
    expect(latest.day).toBe('2099-02-01');
    expect(latest.candidates.map((c) => c.slug)).toEqual(['test-a']);
    expect(latest.candidates[0]).toMatchObject({ chains: ['Ethereum'], reasons: ['r'], listedAtMs: Date.UTC(2026, 8, 1) });

    const then = await getAirdropTvl30dAgo(pool, '2099-02-01');
    expect(then.get('test-a')).toBe(100);
    expect(then.get('test-b')).toBe(50);
    // Too close to count as 30 days.
    expect((await getAirdropTvl30dAgo(pool, '2099-01-20')).has('test-a')).toBe(false);
  });

  it('keeps one active farm per project, logs actions and nets the reward', async () => {
    const first = await startFarm(pool, { chatId: CHAT, name: 'Symbiotic', slug: 'symbiotic' });
    const again = await logFarmAction(pool, { chatId: CHAT, name: '  symbiotic ', costUsd: 2.5, note: 'restake' });
    expect(again.id).toBe(first.id);
    await addFarmAction(pool, first.id, 1.5, null);

    const done = await updateFarm(pool, first.id, { status: 'claimed', rewardUsd: 40 });
    expect(done.kind).toBe('ok');
    if (done.kind !== 'ok') return;
    expect(done.farm.activity).toMatchObject({ actionCount: 2, totalCostUsd: 4 });
    expect(done.farm.netUsd).toBe(36);
    expect(done.farm.closedAt).not.toBeNull();

    // A new active farm on the same project, then reopening the old one, conflicts.
    const second = await startFarm(pool, { chatId: CHAT, name: 'Symbiotic' });
    expect(second.id).not.toBe(first.id);
    expect((await updateFarm(pool, first.id, { status: 'active' })).kind).toBe('conflict');

    const farms = await getFarms(pool, CHAT);
    expect(farms[0]?.id).toBe(second.id);
    expect(await deleteFarm(pool, first.id)).toBe(true);
    expect((await updateFarm(pool, first.id, { note: 'x' })).kind).toBe('not_found');
  });

  it('rejects a negative cost at the database too', async () => {
    const farm = await startFarm(pool, { chatId: CHAT, name: 'Neg' });
    await expect(addFarmAction(pool, farm.id, -1, null)).rejects.toThrow();
  });
});
