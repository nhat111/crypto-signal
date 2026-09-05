import { describe, expect, it } from 'vitest';
import { SIGNAL_MEANING as ENGINE_MEANING } from '@crypto-signal/signal-engine';
import { SIGNAL_MEANING, evidenceReasons } from './signalMeaning';
import { SIGNAL_TYPE_LABEL, signalTypeLabel } from './severity';
import type { SignalType } from './types';

const ALL = Object.keys(SIGNAL_TYPE_LABEL) as SignalType[];

describe('SIGNAL_MEANING', () => {
  it('covers every signal type, so no card can render without a sentence', () => {
    for (const type of ALL) {
      expect(SIGNAL_MEANING[type], type).toBeDefined();
      expect(SIGNAL_MEANING[type].plain.length, type).toBeGreaterThan(20);
      expect(SIGNAL_MEANING[type].caveat.length, type).toBeGreaterThan(20);
    }
  });

  it('carries no untranslated jargon into the plain sentence', () => {
    // The whole point is that someone who does not know these terms can
    // still read the card. If one leaks back in, the card is broken for
    // exactly the reader it exists for.
    const jargon = /\b(CVD|skew|open interest|funding|liquidation|OI)\b/i;
    for (const type of ALL) {
      expect(SIGNAL_MEANING[type].plain, type).not.toMatch(jargon);
    }
  });

  it('says what each signal does not mean, never that price will move', () => {
    // A caveat that predicts is not a caveat.
    for (const type of ALL) {
      const caveat = SIGNAL_MEANING[type].caveat;
      expect(caveat, type).not.toMatch(/sẽ tăng\b|sẽ giảm\b|nên mua|nên bán/i);
    }
  });
});

describe('the engine copy and the web copy', () => {
  // The web app has no workspace dependencies by design, so this table
  // exists twice: once for Telegram, once for the browser. Duplicated
  // copy is only safe while something fails when the two drift — a
  // sentence fixed in one place and not the other is worse than either
  // version, because the same signal then explains itself two ways.
  it('say exactly the same thing', () => {
    expect(SIGNAL_MEANING).toEqual(ENGINE_MEANING);
  });
});

describe('evidenceReasons', () => {
  it('drops the interpretation line older rows were born with', () => {
    // `reasons[]` is frozen into every market_signals row when it fires,
    // so thousands of rows still carry the English line. Without this the
    // same thought shows up twice on one card, in two languages.
    const rows = [
      'Price +0.36% (>= 0.3% threshold)',
      'Interpretation: real spot demand is confirming this move, not leverage alone.',
    ];
    expect(evidenceReasons(rows)).toEqual(['Price +0.36% (>= 0.3% threshold)']);
  });

  it('drops a Vietnamese interpretation line too', () => {
    expect(evidenceReasons(['Giá +0,36%', 'Nghĩa là: cầu thật đang xác nhận cú tăng.'])).toEqual([
      'Giá +0,36%',
    ]);
  });

  it('keeps every evidence line untouched', () => {
    const rows = ['Giá +0,36%', 'Mua đứt (tiền thật): mua nhiều hơn bán 17,8% khối lượng (chỉ số 0,178)'];
    expect(evidenceReasons(rows)).toEqual(rows);
  });

  it('only drops a line that OPENS with the prefix, not one that contains it', () => {
    // Only a line that opens with the prefix is the engine's own
    // interpretation. A substring match would eat evidence lines that
    // happen to explain themselves mid-sentence, and losing evidence is
    // the one failure mode this filter must not have.
    const rows = [
      'Khối lượng cao hơn thường lệ — Nghĩa là: lượng bán đang được mua hết',
      'Giá +0,36%. Interpretation: bằng chứng vẫn được giữ lại',
    ];
    expect(evidenceReasons(rows)).toEqual(rows);
  });

  it('ignores leading whitespace when deciding', () => {
    expect(evidenceReasons(['   Interpretation: dòng này vẫn phải bị bỏ'])).toEqual([]);
  });
});

describe('signalTypeLabel', () => {
  it('names every type this build knows', () => {
    for (const type of ALL) expect(signalTypeLabel(type)).toBe(SIGNAL_TYPE_LABEL[type]);
  });

  it('still says something for a type shipped by a newer worker', () => {
    // Vercel and Railway finish at different times, so the worker can be
    // emitting a type minutes before the web build knows its name. A blank
    // chip in that window reads as a broken signal, not a pending deploy.
    expect(signalTypeLabel('SOME_FUTURE_TYPE')).toBe('SOME FUTURE TYPE');
  });
});
