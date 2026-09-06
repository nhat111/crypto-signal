import { describe, expect, it } from 'vitest';
import { candidateSymbols, resolveQuery } from './resolveQuery.js';

const EVM = '0x198dBa421A7DB566a90dA5De7901ABe3443b1234';
// A real mint (BONK). The placeholder used elsewhere in this repo's
// fixtures contains an 'l', which base58 excludes — so it is not an
// address at all, and this regex is what noticed.
const SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('resolveQuery', () => {
  it('recognises an EVM address and keeps its casing', () => {
    // The casing is an optional checksum: folding it throws away the only
    // way to notice a mistyped address before looking it up.
    expect(resolveQuery(EVM)).toMatchObject({ kind: 'address', family: 'evm', address: EVM });
    expect(resolveQuery(`  ${EVM}  `)).toMatchObject({ address: EVM });
  });

  it('recognises a Solana address', () => {
    expect(resolveQuery(SOL)).toMatchObject({ kind: 'address', family: 'solana', address: SOL });
  });

  it('takes a ticker and upper-cases it', () => {
    expect(resolveQuery('btc')).toMatchObject({ kind: 'exchange', symbol: 'BTC' });
    expect(resolveQuery('ETHUSDT')).toMatchObject({ kind: 'exchange', symbol: 'ETHUSDT' });
    expect(resolveQuery('1000PEPE')).toMatchObject({ kind: 'exchange', symbol: '1000PEPE' });
  });

  /**
   * The split has to be by shape, not by lookup order. Choosing wrongly
   * does not give a worse answer, it gives the wrong KIND of answer — a
   * ticker search for a contract address returns nothing and blames the
   * token.
   */
  it('never mistakes a long base58 string for a ticker', () => {
    const result = resolveQuery(SOL);
    expect(result.kind).toBe('address');
  });

  it('tells a truncated EVM paste apart from a ticker', () => {
    const short = resolveQuery('0x198dBa421A7DB566');
    expect(short.kind).toBe('invalid');
    expect((short as { reason: string }).reason).toContain('0x');
  });

  it('rejects a base58-looking string containing an excluded character', () => {
    // Solana's alphabet drops 0, O, I and l so a misread cannot become a
    // different valid address. One appearing means a typo, not a token.
    for (const bad of ['0', 'O', 'I', 'l']) {
      expect(resolveQuery(`${SOL.slice(0, -1)}${bad}`).kind, `${bad} must not pass`).not.toBe('address');
    }
  });

  it('refuses an empty or nonsense query rather than searching for it', () => {
    expect(resolveQuery('').kind).toBe('invalid');
    expect(resolveQuery('   ').kind).toBe('invalid');
    expect(resolveQuery('what is a good coin?').kind).toBe('invalid');
    expect(resolveQuery('BTC/USDT').kind).toBe('invalid');
  });

  it('keeps the raw input on every branch, so an error can quote it back', () => {
    for (const q of ['', 'btc', EVM, '0xshort', 'a b c']) {
      expect(resolveQuery(q).raw).toBe(q);
    }
  });
});

describe('candidateSymbols', () => {
  it('completes a bare ticker with the liquid quotes, USDT first', () => {
    expect(candidateSymbols('BTC')).toEqual(['BTCUSDT', 'BTCUSDC', 'BTCBTC']);
  });

  it('leaves a pair that already names its quote alone', () => {
    // Appending USDT to "BTCUSDC" would look up a pair that does not exist
    // and report the token as unlisted.
    expect(candidateSymbols('BTCUSDC')).toEqual(['BTCUSDC']);
    expect(candidateSymbols('ETHUSDT')).toEqual(['ETHUSDT']);
  });

  it('does not treat the quote asset itself as an already-quoted pair', () => {
    // "USDT" is a ticker, not the pair USDTUSDT: the length guard is what
    // stops it collapsing to a symbol that does not trade.
    expect(candidateSymbols('USDT')).toEqual(['USDTUSDT', 'USDTUSDC', 'USDTBTC']);
  });

  it('upper-cases whatever it is given', () => {
    expect(candidateSymbols('btc')).toEqual(['BTCUSDT', 'BTCUSDC', 'BTCBTC']);
  });
});
