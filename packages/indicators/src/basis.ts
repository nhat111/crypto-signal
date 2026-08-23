export interface Basis {
  absolute: number;
  pct: number;
}

/** Basis = Futures price - Spot price (spec §11), computed from matching-timestamp kline closes. */
export function computeBasis(futuresClose: number, spotClose: number): Basis {
  const absolute = futuresClose - spotClose;
  const pct = spotClose > 0 ? (absolute / spotClose) * 100 : 0;
  return { absolute, pct };
}

export function isBasisElevated(basisPct: number, thresholdPct: number): boolean {
  return Math.abs(basisPct) >= thresholdPct;
}
