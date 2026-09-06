import { describe, expect, it } from 'vitest';
import { detectTokenizedSecurity, normalizeTokenName, stripTrailingNoise } from './tokenizedSecurity.js';

describe('detectTokenizedSecurity', () => {
  it('catches the two that were actually surfaced on /gems', () => {
    // Both of these scored in the 50s and sat at the top of the list.
    expect(detectTokenizedSecurity('SPDR Gold Trust')?.signal).toBe('fund issuer "spdr"');
    expect(detectTokenizedSecurity('Space Exploration Technologies Corp. Class A Common Stock')?.signal)
      .toBe('common stock');
  });

  it('catches a wrapper regardless of how the share class is spelled out', () => {
    expect(detectTokenizedSecurity('Apple Inc. Common Stock')).not.toBeNull();
    expect(detectTokenizedSecurity('Alphabet Inc Class A')).not.toBeNull();
    expect(detectTokenizedSecurity('Tesla xStock')).not.toBeNull();
    expect(detectTokenizedSecurity('Taiwan Semiconductor American Depositary Shares')).not.toBeNull();
    expect(detectTokenizedSecurity('Vanguard S&P 500 ETF')?.signal).toBe('ETF');
    expect(detectTokenizedSecurity('SPDR Gold Trust Robinhood Token')).not.toBeNull();
  });

  it('catches a corporate suffix only at the end of the name', () => {
    expect(detectTokenizedSecurity('Microsoft Corporation')?.signal).toBe('corporate suffix "corporation"');
    expect(detectTokenizedSecurity('Coinbase Global Inc')?.signal).toBe('corporate suffix "inc"');
    // The same word inside a name is branding, and this is the whole reason
    // the suffix test is positional.
    expect(detectTokenizedSecurity('Corp Inu')).toBeNull();
    expect(detectTokenizedSecurity('Inc Coin')).toBeNull();
    expect(detectTokenizedSecurity('Limited Supply Doge')).toBeNull();
  });

  it('sees through the wrapper words to the real end of the name', () => {
    // The suffix is buried under three layers of share-class boilerplate.
    expect(detectTokenizedSecurity('Berkshire Hathaway Inc Class B Common Shares')).not.toBeNull();
    expect(detectTokenizedSecurity('Nvidia Corp Robinhood Token')?.signal).toBe('Robinhood wrapper');
  });

  /**
   * The expensive direction. A wrong catch deletes a real candidate
   * silently, so these are the names the filter must never touch.
   */
  it('leaves real tokens alone', () => {
    const tokens = [
      'Trust Wallet Token',          // ends in "Trust" only if you strip wrong
      'Bonk',
      'dogwifhat',
      'Pons',
      'Jupiter',
      'Wrapped Ether',
      'PancakeSwap Token',
      'Binance-Peg BUSD Token',
      'Shiba Inu',
      'Peanut the Squirrel',
      'In Gold We Trust',            // terminal "trust" is deliberately not enough
      'Moo Deng',
      'First Ledger Corp Inu',       // suffix present but not terminal
      'Baby Doge Coin',
      'Official Trump',
      'Fartcoin',
      'Gigachad',
      'Vanguard',                    // an issuer name that is also a plausible meme, excluded on purpose
      'Blackrock Inu',
      'Holdings',                    // bare suffix with no issuer in front
      'Limited',
    ];
    for (const name of tokens) {
      expect(detectTokenizedSecurity(name), `${name} must survive`).toBeNull();
    }
  });

  it('says nothing about a token with no name at all', () => {
    // An empty or punctuation-only name is missing data, not a security.
    expect(detectTokenizedSecurity('')).toBeNull();
    expect(detectTokenizedSecurity('   ')).toBeNull();
    expect(detectTokenizedSecurity('...')).toBeNull();
  });

  it('names the rule that fired, so a bad rule is visible rather than guessed at', () => {
    // Every catch has to be attributable: the /status sample is only an
    // audit if it says why each entry is there.
    const detection = detectTokenizedSecurity('iShares Bitcoin Trust');
    expect(detection?.signal).toBe('fund issuer "ishares"');
  });
});

describe('normalizeTokenName', () => {
  it('folds punctuation and case so "Corp." and "corp" are one word', () => {
    expect(normalizeTokenName('Space Exploration Technologies Corp.')).toBe('space exploration technologies corp');
    expect(normalizeTokenName('  A.B.C   Ltd  ')).toBe('a b c ltd');
  });
});

describe('stripTrailingNoise', () => {
  it('peels stacked share-class words off the end', () => {
    expect(stripTrailingNoise('berkshire hathaway inc class b common shares')).toBe('berkshire hathaway inc');
    expect(stripTrailingNoise('spdr gold trust robinhood token')).toBe('spdr gold trust');
  });

  it('leaves a name that has none of them untouched', () => {
    expect(stripTrailingNoise('shiba inu')).toBe('shiba inu');
  });

  it('does not eat a word that merely starts with one', () => {
    // "Tokenomics" ends in nothing strippable; peeling it to "" would make
    // the suffix test read the wrong word.
    expect(stripTrailingNoise('doge tokenomics')).toBe('doge tokenomics');
  });
});
