import { describe, expect, it } from 'vitest';
import { parseRiskArgs } from './riskArgs.js';

describe('parseRiskArgs', () => {
  it('shows the current profile with no arguments', () => {
    expect(parseRiskArgs('/risk')).toEqual({ kind: 'show' });
    expect(parseRiskArgs('/risk@SomeBot')).toEqual({ kind: 'show' });
  });

  it('clears the account', () => {
    expect(parseRiskArgs('/risk off')).toEqual({ kind: 'clear' });
    expect(parseRiskArgs('/risk xoá')).toEqual({ kind: 'clear' });
  });

  it('sets account and risk, accepting $ / % and a comma decimal', () => {
    expect(parseRiskArgs('/risk 1500 1')).toEqual({ kind: 'set', accountUsd: 1500, riskPct: 1 });
    expect(parseRiskArgs('/risk 1500$ 0,5%')).toEqual({ kind: 'set', accountUsd: 1500, riskPct: 0.5 });
  });

  it('sets the account alone, keeping the stored risk', () => {
    expect(parseRiskArgs('/risk 800')).toEqual({ kind: 'set', accountUsd: 800, riskPct: null });
  });

  it('refuses a thousands dot instead of storing an account of 1$', () => {
    const r = parseRiskArgs('/risk 1.000 1');
    expect(r.kind).toBe('error');
  });

  it('refuses a risk above 5% or a word where a number goes', () => {
    expect(parseRiskArgs('/risk 1000 10').kind).toBe('error');
    expect(parseRiskArgs('/risk 1000 abc').kind).toBe('error');
    expect(parseRiskArgs('/risk abc').kind).toBe('error');
    expect(parseRiskArgs('/risk 1000 1 2').kind).toBe('error');
  });
});
