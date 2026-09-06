import { describe, expect, it } from 'vitest';
import { parseSignalsArg, resolveSignalsScope, type SignalsScope } from './signalsScope.js';

const COLLECTED = ['5m', '15m', '1h', '4h'];

describe('parseSignalsArg', () => {
  it('defaults to the armed frames, which is the whole point', () => {
    expect(parseSignalsArg('/signals', COLLECTED)).toEqual({ kind: 'armed' });
    expect(parseSignalsArg('/signals   ', COLLECTED)).toEqual({ kind: 'armed' });
    expect(parseSignalsArg(undefined, COLLECTED)).toEqual({ kind: 'armed' });
  });

  it('keeps the old everything-list one word away', () => {
    expect(parseSignalsArg('/signals all', COLLECTED)).toEqual({ kind: 'all' });
    expect(parseSignalsArg('/signals ALL', COLLECTED)).toEqual({ kind: 'all' });
  });

  it('takes an explicit frame, case-insensitively', () => {
    expect(parseSignalsArg('/signals 4h', COLLECTED)).toEqual({ kind: 'explicit', timeframe: '4h' });
    expect(parseSignalsArg('/signals 4H', COLLECTED)).toEqual({ kind: 'explicit', timeframe: '4h' });
  });

  it('refuses an unknown frame rather than answering on another one', () => {
    const result = parseSignalsArg('/signals 1d', COLLECTED) as { error: string };
    expect(result.error).toContain('1d');
    expect(result.error).toContain('5m, 15m, 1h, 4h');
  });

  it('does not treat a frame the collector lacks as valid just because it looks like one', () => {
    expect(parseSignalsArg('/signals 1h', ['5m', '15m'])).toMatchObject({ error: expect.any(String) });
  });
});

describe('resolveSignalsScope', () => {
  const armedScope: SignalsScope = { kind: 'armed' };

  it('filters to what the worker actually alerts on', () => {
    const resolved = resolveSignalsScope({ kind: 'armed' }, ['1h', '4h']);
    expect(resolved.timeframes).toEqual(['1h', '4h']);
    expect(resolved.note).toContain('1h, 4h');
    // The escape hatch has to be discoverable from the message itself.
    expect(resolved.note).toContain('/signals all');
  });

  it('shows everything, and says so, when the worker never reported its arming', () => {
    // An unfiltered list that does not admit it is unfiltered is exactly
    // the state this change exists to end.
    const resolved = resolveSignalsScope(armedScope as { kind: 'armed' }, null);
    expect(resolved.timeframes).toEqual([]);
    expect(resolved.note).toContain('Không đọc được');
  });

  it('distinguishes "armed on nothing" from "could not read the arming"', () => {
    // Two different faults with two different fixes; "no signals" would
    // read as a quiet market for both.
    const resolved = resolveSignalsScope({ kind: 'armed' }, []);
    expect(resolved.timeframes).toEqual([]);
    expect(resolved.note).toContain('ALERT_TIMEFRAMES');
    expect(resolved.note).not.toContain('Không đọc được');
  });

  it('leaves an explicit request alone, armed set or not', () => {
    expect(resolveSignalsScope({ kind: 'explicit', timeframe: '5m' }, ['1h']).timeframes).toEqual(['5m']);
    expect(resolveSignalsScope({ kind: 'explicit', timeframe: '5m' }, null).timeframes).toEqual(['5m']);
  });

  it('never filters for "all"', () => {
    expect(resolveSignalsScope({ kind: 'all' }, ['1h', '4h']).timeframes).toEqual([]);
  });

  it('always explains itself, in every branch', () => {
    // A filtered list with no note is a silently narrowed answer.
    const cases: Array<[Exclude<SignalsScope, { error: string }>, string[] | null]> = [
      [{ kind: 'armed' }, ['1h']],
      [{ kind: 'armed' }, []],
      [{ kind: 'armed' }, null],
      [{ kind: 'all' }, ['1h']],
      [{ kind: 'explicit', timeframe: '4h' }, null],
    ];
    for (const [scope, armed] of cases) {
      expect(resolveSignalsScope(scope, armed).note.length).toBeGreaterThan(10);
    }
  });
});
