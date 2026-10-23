import { describe, expect, it } from 'vitest';
import { setupLiveRead, setupLiveText } from './setupLive';

// The NEAR setup from 23/10: entry 4.925, stop 4.42, target 6.03.
const near = { entry: 4.925, stop: 4.42, target: 6.03 };

describe('setupLiveRead', () => {
  it('prices the plan from where the coin is now', () => {
    const r = setupLiveRead(near, 4.9)!;
    expect(r.state).toBe('ok');
    expect(r.movePct).toBeCloseTo(-0.51, 1);
    expect(r.toStopPct).toBeCloseTo(9.8, 1);
    expect(r.rrNow).toBeCloseTo(2.35, 2);
    expect(setupLiveText(r)).toBe('Giá giờ 4.9 (-0.5% so với giá vào) · còn 9.8% tới cắt lỗ · R:R nếu vào giờ 1:2.4.');
  });

  it('flags a setup the price has run away from', () => {
    const r = setupLiveRead(near, 5.4)!;
    expect(r.state).toBe('chased');
    expect(setupLiveText(r)).toContain('R:R chỉ còn 1:0.6');
  });

  it('flags a price within a quarter of the risk from the stop', () => {
    expect(setupLiveRead(near, 4.5)?.state).toBe('near_stop');
    expect(setupLiveRead(near, 4.6)?.state).toBe('ok');
  });

  it('says when the stop or the target has already been passed', () => {
    expect(setupLiveRead(near, 4.42)).toMatchObject({ state: 'past_stop', rrNow: null });
    expect(setupLiveRead(near, 6.1)).toMatchObject({ state: 'past_target', rrNow: null });
  });

  it('shows nothing without a usable price', () => {
    expect(setupLiveRead(near, undefined)).toBeNull();
    expect(setupLiveRead(near, 0)).toBeNull();
    expect(setupLiveRead(near, Number.NaN)).toBeNull();
  });
});
