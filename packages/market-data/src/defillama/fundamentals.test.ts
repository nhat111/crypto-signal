import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefiLlamaFundamentalsSource } from './fundamentals.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('DefiLlamaFundamentalsSource', () => {
  it('keeps the protocols that fit and drops the one that does not, instead of failing the whole list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      json([
        { name: 'Uniswap V3', symbol: 'UNI', parentProtocol: 'parent#uniswap', tvl: 1.6e9, change_7d: 2.5, extra: 'ignored' },
        { name: 'Broken', symbol: 'BRK', tvl: 'not a number' },
        { name: 'No Token', symbol: '-', tvl: 5 },
      ]),
    ));
    const protocols = await new DefiLlamaFundamentalsSource({ logger }).protocols();
    expect(protocols).toEqual([
      { name: 'Uniswap V3', symbol: 'UNI', parentProtocol: 'parent#uniswap', category: null, tvl: 1.6e9, change7d: 2.5 },
      { name: 'No Token', symbol: null, parentProtocol: null, category: null, tvl: 5, change7d: null },
    ]);
  });

  it('reads fees out of the overview envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ protocols: [{ name: 'Solana', category: 'Chain', total30d: 27.8e6, total60dto30d: 22.8e6 }] })));
    expect(await new DefiLlamaFundamentalsSource({ logger }).fees()).toEqual([
      { name: 'Solana', category: 'Chain', parentProtocol: null, total30d: 27.8e6, total60dto30d: 22.8e6 },
    ]);
  });

  it('reads a chain’s stablecoin supply from the USD-pegged figure, dates as numbers', async () => {
    const fetchMock = vi.fn(async (_url: string) => json([{ date: '1791849600', totalCirculatingUSD: { peggedUSD: 16.17e9, peggedEUR: 6e7 } }]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DefiLlamaFundamentalsSource({ logger }).chainStablecoins('Hyperliquid L1')).toEqual([{ date: 1791849600, value: 16.17e9 }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/stablecoincharts/Hyperliquid%20L1');
  });
});
