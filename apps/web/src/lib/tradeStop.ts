import type { Trade } from './types';
import { formatTokenPrice } from './format';

/** A result in R, signed: "+2.50R". */
export const formatR = (r: number): string => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;

/**
 * The stop line under an entry price. "no stop" is shown rather than
 * nothing: a trade without one is the case worth noticing.
 */
export function stopLabel(trade: Pick<Trade, 'stopPrice' | 'riskUsd'>): string {
  if (trade.stopPrice === null || trade.stopPrice === undefined) return 'no stop';
  const risk = trade.riskUsd === null || trade.riskUsd === undefined ? '' : ` · risk $${trade.riskUsd.toFixed(2)}`;
  return `SL ${formatTokenPrice(trade.stopPrice)}${risk}`;
}
