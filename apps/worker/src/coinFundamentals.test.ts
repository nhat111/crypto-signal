import { describe, expect, it, vi } from 'vitest';
import { readCoinFundamentals, type FundamentalsSource } from './coinFundamentals.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const DAY = 86_400;
const series = (from: number, to: number) => Array.from({ length: 31 }, (_, i) => ({ date: 1_790_000_000 + i * DAY, value: from + ((to - from) * i) / 30 }));

function source(overrides: Partial<FundamentalsSource> = {}): FundamentalsSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chains: async () => [
      { name: 'Solana', tokenSymbol: 'SOL', tvl: 6e9 },
      { name: 'Doge', tokenSymbol: 'DOGE', tvl: 1.8e6 },
    ],
    protocols: async () => [{ name: 'Uniswap V3', symbol: 'UNI', parentProtocol: 'parent#uniswap', tvl: 1.6e9, change7d: 0 }],
    fees: async () => [{ name: 'Uniswap V3', category: 'Dexs', parentProtocol: 'parent#uniswap', total30d: 160e6, total60dto30d: 100e6 }],
    chainTvl: async (chain) => {
      calls.push(`tvl:${chain}`);
      return series(5e9, 6e9);
    },
    chainStablecoins: async (chain) => {
      calls.push(`stables:${chain}`);
      return series(15e9, 15e9);
    },
    ...overrides,
  };
}

describe('readCoinFundamentals', () => {
  it('reads each coin against the shared lists and fetches history only for chains big enough to read', async () => {
    const src = source();
    const out = await readCoinFundamentals(src, ['SOL', 'UNI', 'DOGE', 'XYZ'], logger);
    expect(src.calls).toEqual(['tvl:Solana', 'stables:Solana']);
    expect(out.get('SOL')?.bull[0]).toContain('TVL trên chain Solana 30N +20%');
    expect(out.get('UNI')?.bull[0]).toContain('Phí của protocol uniswap 30N +60%');
    expect(out.get('DOGE')?.chain?.name).toBe('Doge');
    expect(out.get('XYZ')?.unknowns[0]).toContain('Không khớp');
  });

  it('loses one driver, not the coin, when a chain history fails', async () => {
    const out = await readCoinFundamentals(source({ chainTvl: async () => Promise.reject(new Error('502')) }), ['SOL'], logger);
    expect(out.get('SOL')?.chain?.tvlChange30dPct).toBeNull();
    expect(out.get('SOL')?.unknowns.join(' ')).toContain('lịch sử TVL');
  });
});
