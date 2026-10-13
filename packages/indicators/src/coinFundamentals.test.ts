import { describe, expect, it } from 'vitest';
import { matchChain, matchProtocol, readFundamentals, FUNDAMENTAL_THRESHOLDS, type LlamaFees, type LlamaProtocol } from './coinFundamentals.js';

const T = FUNDAMENTAL_THRESHOLDS;
const DAY = 86_400;
const series = (from: number, to: number, days = 31) =>
  Array.from({ length: days }, (_, i) => ({ date: 1_790_000_000 + i * DAY, value: from + ((to - from) * i) / (days - 1) }));

const proto = (name: string, symbol: string, parent: string | null, tvl: number, change7d: number | null = 0): LlamaProtocol => ({ name, symbol, parentProtocol: parent, tvl, change7d });
const fee = (name: string, parent: string | null, total30d: number, total60dto30d: number, category = 'Dexs'): LlamaFees => ({ name, category, parentProtocol: parent, total30d, total60dto30d });

describe('matchChain', () => {
  it('matches the gas token, the biggest chain when several claim it', () => {
    const chains = [{ name: 'Binance', tokenSymbol: 'BNB', tvl: 0 }, { name: 'BSC', tokenSymbol: 'BNB', tvl: 5e9 }, { name: 'Solana', tokenSymbol: 'SOL', tvl: 6e9 }];
    expect(matchChain('bnb', chains)?.name).toBe('BSC');
    expect(matchChain('LINK', chains)).toBeNull();
  });
});

describe('matchProtocol', () => {
  it('sums a protocol family across its versions, TVL and fees alike', () => {
    const p = matchProtocol(
      'UNI',
      [proto('Uniswap V3', 'UNI', 'parent#uniswap', 1.6e9, 10), proto('Uniswap V2', 'UNI', 'parent#uniswap', 1e9, 0)],
      [fee('Uniswap V3', 'parent#uniswap', 40e6, 50e6), fee('Uniswap V4', 'parent#uniswap', 80e6, 100e6)],
      T,
    );
    expect(p?.name).toBe('uniswap');
    expect(p?.tvlUsd).toBe(2.6e9);
    expect(p?.fees30dUsd).toBe(120e6);
    expect(p?.feesChangePct).toBeCloseTo(-20, 9);
    // 1.6B was +10% on the week, so it was 1.4545B; 1B was flat.
    expect(p?.tvlChange7dPct).toBeCloseTo((2.6e9 / (1.6e9 / 1.1 + 1e9) - 1) * 100, 9);
  });

  it('picks the family with the most fees when a ticker is shared, and ignores a family too small to mean anything', () => {
    const protocols = [proto('PumpSwap', 'PUMP', 'parent#pump', 3e8), proto('PumpBTC', 'PUMP', null, 2.9e7)];
    const fees = [fee('PumpSwap', 'parent#pump', 118e6, 130e6), fee('pump.fun', 'parent#pump', 60e6, 62e6)];
    expect(matchProtocol('PUMP', protocols, fees, T)?.name).toBe('pump');
    expect(matchProtocol('TINY', [proto('Tiny', 'TINY', null, 1e6)], [], T)).toBeNull();
  });
});

describe('protocol matching on a chain token', () => {
  const chains = [{ name: 'BSC', tokenSymbol: 'BNB', tvl: 5.4e9 }, { name: 'Hyperliquid L1', tokenSymbol: 'HYPE', tvl: 1.1e9 }, { name: 'Solana', tokenSymbol: 'SOL', tvl: 6e9 }];
  const chainFees = [fee('BSC', null, 17.8e6, 17e6, 'Chain'), fee('Hyperliquid L1', null, 0.6e6, 1.8e6, 'Chain'), fee('Solana', null, 27.8e6, 22.8e6, 'Chain')];

  it('drops a side protocol that earns less than the chain it shares a ticker with', () => {
    const f = readFundamentals({ base: 'BNB', chains, protocols: [proto('Binance Alpha', 'BNB', null, 2e8)], fees: [...chainFees, fee('Binance Alpha', null, 1.5e6, 2.3e6)] });
    expect(f.chain?.name).toBe('BSC');
    expect(f.protocol).toBeNull();
  });

  it('keeps the protocol when it is where the money is', () => {
    const f = readFundamentals({
      base: 'HYPE',
      chains,
      protocols: [proto('Hyperliquid Bridge', 'HYPE', 'parent#hyperliquid', 6.9e9)],
      fees: [...chainFees, fee('Hyperliquid Perps', 'parent#hyperliquid', 84e6, 80e6, 'Derivatives')],
    });
    expect(f.protocol?.name).toBe('hyperliquid');
  });

  it('never counts a chain’s own fee row again as a protocol of the same name', () => {
    const f = readFundamentals({ base: 'SOL', chains, protocols: [proto('Solana', 'SOL', null, 1e8)], fees: chainFees });
    expect(f.protocol).toBeNull();
    expect(f.bull.filter((b) => b.startsWith('Phí'))).toHaveLength(1);
  });

  it('ignores exchange reserves listed under a token’s ticker', () => {
    expect(matchProtocol('OKB', [{ ...proto('OKX', 'OKB', null, 2e10), category: 'CEX' }], [], T)).toBeNull();
  });
});

describe('readFundamentals', () => {
  const chains = [{ name: 'Solana', tokenSymbol: 'SOL', tvl: 6e9 }];

  it('turns big enough changes into bull and bear drivers with their numbers', () => {
    const f = readFundamentals({
      base: 'SOL',
      chains,
      protocols: [],
      fees: [fee('Solana', null, 27.8e6, 22.8e6, 'Chain')],
      chainTvl: series(7e9, 6e9),
      chainStablecoins: series(15e9, 16.2e9),
    });
    expect(f.chain?.feesChangePct).toBeCloseTo((27.8 / 22.8 - 1) * 100, 6);
    expect(f.bull).toEqual([
      'Phí trên chain Solana 30N +22% so với 30N trước ($27.8M).',
      'Stablecoin trên chain Solana 30N +8% ($16.2B).',
    ]);
    expect(f.bear).toEqual(['TVL trên chain Solana 30N -14% ($6.0B).']);
    expect(f.unknowns).toEqual([]);
  });

  it('does not read a change on a base too small to mean anything', () => {
    const f = readFundamentals({
      base: 'DOGE',
      chains: [{ name: 'Doge', tokenSymbol: 'DOGE', tvl: 1.8e6 }],
      protocols: [],
      fees: [fee('Doge', null, 23e3, 10e3, 'Chain')],
      chainTvl: series(0.9e6, 1.8e6),
    });
    expect(f.bull).toEqual([]);
    expect(f.chain?.feesChangePct).toBeNull();
  });

  it('says when a coin matches nothing, and when a chain history could not be read', () => {
    expect(readFundamentals({ base: 'XYZ', chains, protocols: [], fees: [] }).unknowns[0]).toContain('Không khớp');
    expect(readFundamentals({ base: 'SOL', chains, protocols: [], fees: [], chainTvl: null }).unknowns[0]).toContain('lịch sử TVL');
  });
});
