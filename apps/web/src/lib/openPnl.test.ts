import { describe, expect, it } from 'vitest';
import { markPriceNote, unrealizedLabel } from './openPnl';

const NOW = 1_700_000_000_000;

describe('unrealizedLabel', () => {
  it('marks the number as an estimate, with a sign', () => {
    // The "≈" is doing real work: this sits in the same column as a
    // settled P&L, and the two must never be confused.
    expect(unrealizedLabel({ unrealizedPnlPct: 30 })).toBe('≈ +30.00%');
    expect(unrealizedLabel({ unrealizedPnlPct: -12.345 })).toBe('≈ -12.35%');
    expect(unrealizedLabel({ unrealizedPnlPct: 0 })).toBe('≈ +0.00%');
  });

  it('says nothing when there is no estimate', () => {
    expect(unrealizedLabel({ unrealizedPnlPct: null })).toBeNull();
    expect(unrealizedLabel({})).toBeNull();
  });
});

describe('markPriceNote', () => {
  it('shows the price it used and how old that price is', () => {
    const note = markPriceNote({ markPrice: 0.00042, markPriceAt: NOW - 4 * 60_000, markPriceUnknownReason: null }, NOW);
    expect(note).toContain('0.00042');
    expect(note).toContain('4m ago');
  });

  it('shows the price without an age when the API sent no clock', () => {
    // Ageing against the phone's clock would be worse than not ageing:
    // a device minutes out would print a confident wrong age.
    const note = markPriceNote({ markPrice: 1.5, markPriceAt: NOW, markPriceUnknownReason: null }, null);
    expect(note).toBe('$1.50');
  });

  it('names the ambiguity, because that one has a fix', () => {
    const note = markPriceNote({ markPrice: null, markPriceAt: null, markPriceUnknownReason: 'ambiguous_ticker' }, NOW);
    expect(note).toContain('contract address');
  });

  it('distinguishes "no source" from "ambiguous"', () => {
    const note = markPriceNote({ markPrice: null, markPriceAt: null, markPriceUnknownReason: 'not_found' }, NOW);
    expect(note).toContain('no price source');
    expect(note).not.toContain('share this ticker');
  });

  it('says nothing at all for an API that predates mark pricing', () => {
    // Absent is not "lookup failed". A row from an older API must not
    // sprout a diagnosis nobody produced.
    expect(markPriceNote({}, NOW)).toBeNull();
    expect(markPriceNote({ markPrice: null, markPriceAt: null }, NOW)).toBeNull();
  });

  it('keeps a sub-cent mark price readable', () => {
    // Same trap as the entry column: formatUsd would render this "$0.00".
    const note = markPriceNote({ markPrice: 0.000000123, markPriceAt: NOW, markPriceUnknownReason: null }, NOW);
    expect(note).toContain('123');
    expect(note).not.toContain('$0.00 ');
  });
});
