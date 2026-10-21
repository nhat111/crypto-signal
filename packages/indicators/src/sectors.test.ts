import { describe, expect, it } from 'vitest';
import { classifySector, median, readSector, type SectorCoinInput } from './sectors.js';

const btc = { change7dPct: 2, change30dPct: -5 };
const coin = (id: string, change7dPct: number | null, change30dPct: number | null, marketCapUsd: number | null = 1e9): SectorCoinInput => ({
  id,
  symbol: id.toUpperCase(),
  name: id,
  marketCapUsd,
  change7dPct,
  change30dPct,
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('classifySector', () => {
  it('reads the two windows into four labels', () => {
    expect(classifySector(1, 1)).toBe('leading');
    expect(classifySector(1, -1)).toBe('emerging');
    expect(classifySector(-1, 1)).toBe('fading');
    expect(classifySector(0, 0)).toBe('lagging');
  });
});

describe('readSector', () => {
  it('measures the median coin and breadth against BTC', () => {
    const coins = [coin('a', 10, 0), coin('b', 8, 5), coin('c', 6, -2), coin('d', 1, -10), coin('e', -3, -20)];
    const r = readSector('ai', 'AI', coins, btc, new Set());
    expect(r?.median7dPct).toBe(6);
    expect(r?.rs7d).toBe(4);
    expect(r?.rs30d).toBe(3);
    expect(r?.label).toBe('leading');
    expect(r?.breadth7dPct).toBe(60);
    expect(r?.leaders.map((l) => l.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('drops stablecoins and coins with a missing return, and needs five coins', () => {
    const coins = [coin('usdt', 0, 0), coin('a', 5, 5), coin('b', 5, 5), coin('c', 5, 5), coin('d', 5, null), coin('e', 5, 5)];
    expect(readSector('x', 'X', coins, btc, new Set(['usdt']))).toBeNull();
    expect(readSector('x', 'X', [...coins, coin('f', 5, 5)], btc, new Set(['usdt']))?.coinCount).toBe(5);
  });

  it('leaves out coins too small to speak for the sector', () => {
    const coins = [coin('a', 1, 0), coin('b', 1, 0), coin('c', 1, 0), coin('d', 1, 0), coin('e', 1, 0), coin('dust', 1600, 0, 2e6), coin('nocap', 50, 0, null), coin('launch', 56_000, 0)];
    const r = readSector('o', 'Oracle', coins, btc, new Set());
    expect(r?.coinCount).toBe(5);
    expect(r?.leaders[0]?.symbol).toBe('A');
  });

  it('calls out a sector carried by a few coins', () => {
    const coins = [coin('a', 80, 0), coin('b', 50, 0), coin('c', 1, 0), coin('d', 0, 0), coin('e', -1, 0), coin('f', -2, 0), coin('g', -4, 0)];
    const r = readSector('m', 'Meme', coins, btc, new Set());
    expect(r?.label).toBe('fading');
    expect(r?.reasons.join(' | ')).toContain('Hẹp');
  });

  it('says when the big coins and the median disagree', () => {
    const coins = [coin('big', 40, 0, 100e9), coin('a', 1, 0), coin('b', 1, 0), coin('c', 1, 0), coin('d', 1, 0)];
    expect(readSector('l1', 'L1', coins, btc, new Set())?.reasons.join(' | ')).toContain('Coin lớn kéo');
  });
});
