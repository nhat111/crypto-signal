import { describe, expect, it } from 'vitest';
import { showsSymbolChips } from './navScope';

describe('showsSymbolChips', () => {
  it('shows them where the page is about the four majors', () => {
    expect(showsSymbolChips('/')).toBe(true);
    expect(showsSymbolChips('/signals')).toBe(true);
    expect(showsSymbolChips('/performance')).toBe(true);
    expect(showsSymbolChips('/symbol/BTCUSDT')).toBe(true);
  });

  /**
   * The reported bug. On Gems the chips sit directly above a 24h/7d
   * picker, so they read as another filter — and tapping one jumps to a
   * different section instead.
   */
  it('hides them where they would read as a filter for something else', () => {
    expect(showsSymbolChips('/gems')).toBe(false);
    expect(showsSymbolChips('/journal')).toBe(false);
    expect(showsSymbolChips('/guide')).toBe(false);
    expect(showsSymbolChips('/status')).toBe(false);
    expect(showsSymbolChips('/methodology')).toBe(false);
  });

  it('does not treat a longer path as one of the scoped pages', () => {
    // "/signals-archive" is not "/signals". Matching on a bare prefix
    // would quietly turn any future sibling route into a symbol page.
    expect(showsSymbolChips('/signals-archive')).toBe(false);
    expect(showsSymbolChips('/performance-notes')).toBe(false);
    expect(showsSymbolChips('/symbolic')).toBe(false);
  });

  it('keeps them on a deeper path under a scoped page', () => {
    expect(showsSymbolChips('/symbol/HYPEUSDT')).toBe(true);
    expect(showsSymbolChips('/signals/anything')).toBe(true);
  });

  it('matches the root exactly, so every path is not the home page', () => {
    // '/' is a prefix of literally everything; treating it as one would
    // put the chips back on every page and undo the fix.
    expect(showsSymbolChips('/gems/detail')).toBe(false);
  });
});
