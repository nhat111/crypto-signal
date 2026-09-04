import { describe, expect, it } from 'vitest';
import { parseTimeframeArg } from './timeframeArg.js';

const COLLECTED = ['5m', '15m', '1h', '4h'];

describe('parseTimeframeArg', () => {
  it('uses the default when the command carries no argument', () => {
    expect(parseTimeframeArg('/status', COLLECTED, '4h')).toEqual({ timeframe: '4h' });
    expect(parseTimeframeArg('/status   ', COLLECTED, '4h')).toEqual({ timeframe: '4h' });
    expect(parseTimeframeArg(undefined, COLLECTED, '4h')).toEqual({ timeframe: '4h' });
  });

  it('honours a frame the caller names', () => {
    expect(parseTimeframeArg('/status 1h', COLLECTED, '4h')).toEqual({ timeframe: '1h' });
    expect(parseTimeframeArg('/btc 15m', COLLECTED, '4h')).toEqual({ timeframe: '15m' });
  });

  it('accepts a differently-cased frame instead of refusing it', () => {
    // "/status 4H" is unambiguous; rejecting it would be pedantry.
    expect(parseTimeframeArg('/status 4H', COLLECTED, '1h')).toEqual({ timeframe: '4h' });
  });

  it('refuses an unknown frame rather than silently using the default', () => {
    // Answering on a frame other than the one asked for is the kind of
    // wrong that gets believed — the reply must say so.
    const result = parseTimeframeArg('/status 1d', COLLECTED, '4h');
    expect(result).toHaveProperty('error');
    expect('error' in result && result.error).toContain('1d');
    expect('error' in result && result.error).toContain('5m, 15m, 1h, 4h');
  });

  it('ignores anything after the frame', () => {
    expect(parseTimeframeArg('/status 1h please', COLLECTED, '4h')).toEqual({ timeframe: '1h' });
  });
});
