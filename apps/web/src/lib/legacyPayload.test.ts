import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GemCard } from '@/components/gems/GemCard';
import { GemPerformancePanel } from '@/components/gems/PerformancePanels';
import { JournalSummary } from '@/components/journal/JournalSummary';
import { TradeTable } from '@/components/journal/TradeTable';
import type { Gem, GemPerformance, Trade, TradeSummary } from './types';

/**
 * The rule at the top of lib/types.ts, enforced instead of merely written
 * down.
 *
 * Web and API deploy separately, so on every release a new client meets an
 * old response for a few minutes. A field added to an API payload must
 * therefore be OPTIONAL here — and when somebody forgets, the symptom is
 * not a type error but a page that throws in the browser during those
 * minutes. It has happened: a required-but-missing field took out /gems
 * outright.
 *
 * So the optional fields are read out of the type definitions with the
 * TypeScript AST rather than listed by hand. A field added tomorrow is
 * stripped by these tests tomorrow, with nobody remembering to add it —
 * which is the only version of this that keeps working.
 */

const TYPES_PATH = fileURLToPath(new URL('./types.ts', import.meta.url));

/** Every property an interface marks with `?`, straight from the AST. */
export function optionalFieldsOf(interfaceName: string): string[] {
  const source = ts.createSourceFile(
    TYPES_PATH,
    readFileSync(TYPES_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  const found: string[] = [];
  let seen = false;
  source.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== interfaceName) return;
    seen = true;
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.questionToken && ts.isIdentifier(member.name)) {
        found.push(member.name.text);
      }
    }
  });

  if (!seen) throw new Error(`interface ${interfaceName} not found in types.ts — did it get renamed?`);
  return found;
}

/** The same payload as an older API would have sent: every optional key absent. */
function asLegacy<T extends object>(payload: T, interfaceName: string): T {
  const stripped: Record<string, unknown> = { ...payload };
  for (const key of optionalFieldsOf(interfaceName)) delete stripped[key];
  return stripped as T;
}

/**
 * Every payload worth rendering: the fully-old one, plus one variant per
 * optional field with only that field missing.
 *
 * Stripping everything at once turned out to cover far less than it looks.
 * A guard on one field can shield a second, unguarded one by never letting
 * its branch run — so the all-missing payload takes an early exit and the
 * unsafe line is never reached. Removing fields one at a time is what
 * reaches those branches, and it is how a real half-shipped field behaves
 * anyway: present, but null or absent on its own.
 */
function legacyVariants<T extends object>(payload: T, interfaceName: string): Array<{ label: string; payload: T }> {
  const optional = optionalFieldsOf(interfaceName);
  const variants = [{ label: 'every optional field missing', payload: asLegacy(payload, interfaceName) }];
  for (const key of optional) {
    const one: Record<string, unknown> = { ...payload };
    delete one[key];
    variants.push({ label: `only ${key} missing`, payload: one as T });
  }
  return variants;
}

const fullSummary: TradeSummary = {
  openCount: 3,
  closedCount: 2,
  wins: 1,
  losses: 1,
  winRatePct: 50,
  totalPnlUsd: 120,
  avgPnlPct: 4.2,
  unrealizedPnlUsd: 90,
  unrealizedPricedCount: 2,
};

const fullTrade: Trade = {
  id: '1',
  chatId: 'web',
  symbol: 'NOVALUE',
  side: 'spot',
  entryPrice: 0.00042,
  exitPrice: null,
  size: 1_000_000,
  pnlPct: null,
  pnlUsd: null,
  status: 'open',
  note: 'solana · bdm98…',
  openedAt: 1_700_000_000_000,
  closedAt: null,
  markPrice: 0.00051,
  markPriceAt: 1_700_000_000_000,
  markPriceSource: 'gem_scan',
  markPriceUnknownReason: null,
  unrealizedPnlPct: 21.4,
  unrealizedPnlUsd: 90,
};

const fullGem: Gem = {
  scanId: 's1',
  chainId: 'solana',
  tokenAddress: 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub',
  symbol: 'PONS',
  name: 'Pons',
  dexId: 'raydium',
  url: 'https://dexscreener.com/solana/x',
  scannedAt: 1_700_000_000_000,
  gemScore: 71,
  gemComponents: { liquidityQuality: 20 },
  riskScore: 33,
  riskComponents: { safety: 10 },
  reasons: ['Liquidity $219.37K.'],
  priceUsd: 0.00042,
  liquidityUsd: 219_370,
  volume24hUsd: 333_060,
  fdvUsd: 8_000_000,
  priceChange24hPct: 22,
  buys24h: 400,
  sells24h: 300,
  ageDays: 31,
  safetyVerdict: 'safe',
  safetyFlags: [],
  topHolderPct: 0.08,
  lpLocked: true,
};

const band = (key: string, label: string, sampleCount: number, netPositiveMovePct: number) => ({
  key,
  label,
  min: 0,
  max: 100,
  sampleCount,
  positiveMovePct: netPositiveMovePct + 5,
  medianMovePct: -19.4,
  netPositiveMovePct,
  liquidityCollapsePct: 0,
});

/**
 * Typed, with no `as` anywhere on purpose.
 *
 * The first version of this fixture was cast with `as unknown as
 * GemPerformance`, invented half the shape, and made three tests fail
 * against perfectly good code. A cast in a fixture switches off the one
 * check that keeps the fixture honest — and a test built on an invented
 * payload proves nothing about the real one.
 */
const fullPerformance: GemPerformance = {
  horizon: '7d',
  sampleCount: 70,
  positiveMovePct: 24.3,
  negativeMovePct: 75.7,
  medianMovePct: -19.43,
  liquidityCollapsePct: 0,
  sufficientData: true,
  scoreEdge: {
    horizon: '7d',
    costPct: 3,
    bands: [band('low', '<50', 25, 8), band('high', '>=70', 30, 15)],
    verdict: {
      verdict: 'inconclusive',
      deltaPp: 7,
      marginPp: 12.5,
      samplesNeeded: 400,
      comparedBands: { low: '<50', high: '>=70' },
    },
  },
  componentEdges: [
    {
      key: 'liquidityQuality',
      label: 'Liquidity quality',
      weight: 25,
      bands: [band('lo', 'thấp', 30, 9), band('hi', 'cao', 25, 11)],
      verdict: { verdict: 'inconclusive', deltaPp: 2, marginPp: 14, samplesNeeded: null },
      degenerate: true,
      measuredSinceVersion: 2,
    },
  ],
  baseline: {
    horizon: '7d',
    sampleCount: 40,
    positiveMovePct: 20,
    netPositiveMovePct: 9.5,
    medianMovePct: -24.1,
    sufficientData: true,
    failureCounts: { extreme_pump: 22, fdv_too_high: 18 },
    deltaPp: 1.9,
    marginPp: 14.2,
    verdict: 'indistinguishable',
    medianDeltaPp: 4.7,
  },
};

describe('optionalFieldsOf', () => {
  it('finds the fields the split-deploy rule is about', () => {
    // If this ever returns [], every test below would pass vacuously while
    // testing nothing — the failure mode that makes a green suite lie.
    expect(optionalFieldsOf('Trade')).toContain('markPrice');
    expect(optionalFieldsOf('Trade')).toContain('unrealizedPnlPct');
    expect(optionalFieldsOf('TradeSummary')).toContain('unrealizedPnlUsd');
  });

  it('does not mistake a required field for an optional one', () => {
    expect(optionalFieldsOf('Trade')).not.toContain('entryPrice');
    expect(optionalFieldsOf('TradeSummary')).not.toContain('openCount');
  });

  it('fails loudly if an interface is renamed out from under it', () => {
    // Silently returning [] would turn every check below into a no-op.
    expect(() => optionalFieldsOf('NoSuchInterface')).toThrow(/not found/);
  });

  it('strips exactly the optional keys and nothing else', () => {
    const legacy = asLegacy(fullTrade, 'Trade') as Record<string, unknown>;
    expect('markPrice' in legacy).toBe(false);
    expect('unrealizedPnlUsd' in legacy).toBe(false);
    expect(legacy.entryPrice).toBe(0.00042);
    expect(legacy.symbol).toBe('NOVALUE');
  });
});

describe('pages render against an older API payload', () => {
  it.each(legacyVariants(fullSummary, 'TradeSummary'))('renders the journal summary — $label', ({ payload }) => {
    const html = renderToStaticMarkup(createElement(JournalSummary, { summary: payload }));
    // Assert the tiles are actually there: "did not throw" alone would
    // pass on a component that rendered nothing at all.
    expect(html).toContain('Win rate');
    expect(html).toContain('Open positions');
    expect(html).toContain('50%');
  });

  it('says nothing rather than $0.00 when no unrealized figure arrived', () => {
    // "$0.00" in the open-P&L tile would read as break-even, which is a
    // claim about the positions rather than an admission of not knowing.
    const html = renderToStaticMarkup(
      createElement(JournalSummary, { summary: asLegacy(fullSummary, 'TradeSummary') }),
    );
    expect(html).not.toContain('$0.00');
  });

  it.each(legacyVariants(fullTrade, 'Trade'))('renders the trade table — $label', ({ payload }) => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, { trades: [payload], onChanged: () => {}, nowMs: null }),
    );
    expect(html).toContain('NOVALUE');
    // The entry price is the row's reason for existing; a row that renders
    // its symbol and nothing else is still broken.
    expect(html).toContain('0.00042');
  });

  it.each(legacyVariants(fullGem, 'Gem'))('renders a gem card — $label', ({ payload }) => {
    // /gems is the page a required-but-missing field actually took out.
    const html = renderToStaticMarkup(createElement(GemCard, { gem: payload }));
    expect(html).toContain('PONS');
    expect(html).toContain('Gem 71');
  });

  it.each(legacyVariants(fullPerformance, 'GemPerformance'))(
    'renders the gem performance panels — $label',
    ({ payload }) => {
      // scoreEdge, componentEdges and baseline are all optional, and each
      // shipped in a different release. An old API sends the headline with
      // none of them.
      const html = renderToStaticMarkup(
        createElement(GemPerformancePanel, { data: payload, loading: false, error: null }),
      );
      expect(html).toContain('Số mẫu');
      expect(html).toContain('70');
    },
  );

  it('renders the performance panels while still loading, and on error', () => {
    // Both are states the page reaches on a cold load against a slow API.
    expect(
      renderToStaticMarkup(createElement(GemPerformancePanel, { data: null, loading: true, error: null })),
    ).toContain('Đang tải');
    expect(
      renderToStaticMarkup(createElement(GemPerformancePanel, { data: null, loading: false, error: 'boom' })),
    ).toContain('boom');
  });

  it('covers more than one payload shape, so the loop is not vacuous', () => {
    // If optionalFieldsOf ever returned [], every it.each above would
    // shrink to a single case and still pass. This asserts the fan-out.
    expect(legacyVariants(fullTrade, 'Trade').length).toBeGreaterThan(3);
  });

  it('still renders both when the new fields ARE present', () => {
    // The other half of the contract: stripping must be what the tests
    // above exercise, not a component that ignores the fields entirely.
    const summaryHtml = renderToStaticMarkup(createElement(JournalSummary, { summary: fullSummary }));
    expect(summaryHtml).toContain('90');

    const tableHtml = renderToStaticMarkup(
      createElement(TradeTable, { trades: [fullTrade], onChanged: () => {}, nowMs: 1_700_000_000_000 }),
    );
    expect(tableHtml).toContain('21.40%');
  });

  it('survives a payload that is legacy in every list position, not just the first', () => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, {
        trades: [
          fullTrade,
          asLegacy({ ...fullTrade, id: '2', symbol: 'BTCUSDT' }, 'Trade'),
          { ...fullTrade, id: '3', symbol: 'ETHUSDT', status: 'closed', exitPrice: 1, pnlPct: 10, pnlUsd: 5 },
        ],
        onChanged: () => {},
        nowMs: 1_700_000_000_000,
      }),
    );
    expect(html).toContain('BTCUSDT');
    expect(html).toContain('ETHUSDT');
  });
});
