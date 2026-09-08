import { describe, expect, it } from 'vitest';
import { botBuildLine } from './botBuildLine.js';

const at = (startedAt: number) => ({ commit: 'adf4637', commitSource: 'RAILWAY_GIT_COMMIT_SHA', startedAt });

describe('botBuildLine', () => {
  it('names the commit the bot is actually running', () => {
    const now = 1_000_000_000;
    expect(botBuildLine(at(now - 3 * 60_000), now)).toContain('adf4637');
  });

  it('says how long ago it started, so a stale bot is visible', () => {
    const now = 1_000_000_000;
    expect(botBuildLine(at(now - 3 * 60_000), now)).toContain('3 phút trước');
    expect(botBuildLine(at(now - 5 * 3_600_000), now)).toContain('5 giờ trước');
    expect(botBuildLine(at(now - 50 * 3_600_000), now)).toContain('2 ngày trước');
    expect(botBuildLine(at(now - 10), now)).toContain('vừa xong');
  });

  it('admits an unknown build rather than inventing one', () => {
    // "No build variable set" and "not deployed" are different facts, and
    // a made-up version would make a stale bot look current.
    const line = botBuildLine({ commit: null, commitSource: null, startedAt: 0 }, 1000);
    expect(line).toMatch(/unknown/);
    expect(line).not.toMatch(/khởi động/);
  });

  it('does not go backwards if the clock jumps', () => {
    expect(botBuildLine(at(2000), 1000)).toContain('vừa xong');
  });
});
