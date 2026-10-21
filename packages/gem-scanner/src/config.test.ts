import { describe, expect, it } from 'vitest';
import { loadGemConfig } from './config.js';

describe('loadGemConfig enabled flag', () => {
  it('is on when the variable is not set, which is how production ran for weeks', () => {
    expect(loadGemConfig({}).enabled).toBe(true);
    expect(loadGemConfig({ GEM_SCAN_ENABLED: '' }).enabled).toBe(true);
  });

  it('turns off only on an explicit off value', () => {
    for (const off of ['false', '0', 'off', 'no', ' FALSE ']) {
      expect(loadGemConfig({ GEM_SCAN_ENABLED: off }).enabled).toBe(false);
    }
    expect(loadGemConfig({ GEM_SCAN_ENABLED: 'true' }).enabled).toBe(true);
  });
});
