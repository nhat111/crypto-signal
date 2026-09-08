import { describe, expect, it } from 'vitest';
import { ONCHAIN_GLOSSARY, TECHNICAL_GLOSSARY } from './Glossary';

const ALL = [...TECHNICAL_GLOSSARY, ...ONCHAIN_GLOSSARY];

/**
 * The glossary is the only long-form prose on the lookup page, which makes
 * it the place where "here is what this measures" would quietly turn into
 * "so you should buy". Nothing guarded it before; these do.
 */
describe('lookup glossary', () => {
  it('explains every entry it lists', () => {
    for (const { term, text } of ALL) {
      expect(term.trim().length, `"${term}" has no term`).toBeGreaterThan(0);
      // Short enough to be a stub rather than an explanation.
      expect(text.trim().length, `"${term}" is barely explained`).toBeGreaterThan(80);
    }
  });

  it('has no duplicate terms', () => {
    const terms = ALL.map((e) => e.term);
    expect(new Set(terms).size).toBe(terms.length);
  });

  /**
   * Directive and predictive phrasing only.
   *
   * Deliberately NOT a ban on the words "cắt lỗ" or "chốt lời": saying
   * what ATR is useful for — sizing a stop — is describing the tool, and a
   * word list that could not tell that from "hãy cắt lỗ" would force the
   * explanations to get worse to stay green. The line is telling somebody
   * to act, or telling them what the price will do.
   */
  it('never tells anyone to trade, and never predicts a price', () => {
    const forbidden = [
      // Vietnamese, which is what the text is written in.
      'nên mua', 'nên bán', 'hãy mua', 'hãy bán', 'khuyến nghị', 'mua ngay', 'bán ngay',
      'sẽ tăng', 'sẽ giảm', 'chắc chắn tăng', 'chắc chắn giảm', 'tín hiệu mua', 'tín hiệu bán',
      // English too, so a future edit in either language is caught.
      'should buy', 'should sell', 'recommend', 'will rise', 'will fall', 'buy now', 'sell now',
    ];

    for (const { term, text } of ALL) {
      const lower = text.toLowerCase();
      for (const phrase of forbidden) {
        expect(lower, `"${term}" contains "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  /**
   * The terms are the labels printed above the numbers, and they stay in
   * English on purpose — somebody looking up "FDV" has to find the entry
   * that explains FDV. The explanation is the half that is translated.
   */
  it('keeps terms as the on-screen labels while explaining in Vietnamese', () => {
    const vietnamese = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

    for (const { term, text } of ALL) {
      expect(vietnamese.test(text), `"${term}" is not explained in Vietnamese`).toBe(true);
    }
    // A metric name carrying diacritics would mean a label got translated
    // and no longer matches what the panel prints.
    for (const { term } of ALL) {
      expect(vietnamese.test(term), `term "${term}" should stay as the on-screen label`).toBe(false);
    }
  });

  /**
   * "unknown" is a third state, not a soft no — the rule the whole safety
   * surface is built on. Both entries that surface it must say so, or the
   * page teaches the opposite of what the scanner means.
   */
  it('does not let "unknown" be read as "no"', () => {
    for (const term of ['LP locked', 'Mint / freeze revoked']) {
      const entry = ONCHAIN_GLOSSARY.find((e) => e.term === term);
      expect(entry, `${term} is missing from the glossary`).toBeDefined();
      expect(entry?.text).toMatch(/unknown/i);
      expect(entry?.text).toMatch(/không có nghĩa là không|không phải là "không"/);
    }
  });
});
