import { describe, expect, it } from 'vitest';
import { sectorBreadthWord } from './sectorBreadth.js';

describe('sectorBreadthWord', () => {
  it('puts the edges in the higher band', () => {
    expect(sectorBreadthWord(65)).toBe('Rộng');
    expect(sectorBreadthWord(64.9)).toBe('Vừa');
    expect(sectorBreadthWord(35)).toBe('Vừa');
    expect(sectorBreadthWord(16)).toBe('Ít');
  });
});
