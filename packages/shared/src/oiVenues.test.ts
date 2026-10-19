import { describe, expect, it } from 'vitest';
import { parseOiVenues } from './config.js';

describe('parseOiVenues', () => {
  it('keeps known venues in a fixed order, ignoring case, spaces and typos', () => {
    expect(parseOiVenues('Gate, bybit')).toEqual(['bybit', 'gate']);
    expect(parseOiVenues('gate,bitgett')).toEqual(['gate']);
    expect(parseOiVenues('')).toEqual([]);
  });
});
