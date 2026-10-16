import { describe, expect, it } from 'vitest';
import { pickLivePrices } from './coins.js';

const t = (symbol: string, lastPrice: number) => ({ symbol, lastPrice, quoteVolume: 1, closeTime: 0 });

describe('pickLivePrices', () => {
  it('keeps only the scanned coins', () => {
    expect(pickLivePrices([t('NEARUSDT', 5.265), t('BTCUSDT', 82238.2), t('XYZUSDT', 1)], ['NEARUSDT', 'BTCUSDT'])).toEqual({
      NEARUSDT: 5.265,
      BTCUSDT: 82238.2,
    });
  });

  it('leaves out a coin OKX does not list, and an unusable price, rather than showing 0', () => {
    expect(pickLivePrices([t('NEARUSDT', 0), t('SUIUSDT', Number.NaN)], ['NEARUSDT', 'SUIUSDT', 'PONSUSDT'])).toEqual({});
  });
});
