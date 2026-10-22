import type { TradeSide } from './apiClient.js';

/**
 * `/trade SYMBOL SIDE ENTRY [SIZE] [sl STOP] [SOURCE…] [| THESIS…]`
 *
 * e.g. `/trade SOLUSDT spot 150 2 sl 140 @CryptoCred | hồi về hỗ trợ 1D`
 *
 * The thesis is everything after the first `|`, so it can contain any
 * words. The source is whatever is left after the numbers, so "tự phân
 * tích" works without quotes. SIZE is recognised only when it is a number,
 * which is what lets a source follow the price directly when no size is
 * given. The stop is marked (`sl 140`, `sl=140`, `stop 140`) rather than
 * positional, so it can be left out without shifting the size, and a
 * source that is itself a number is never read as one.
 */
export interface TradeArgs {
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  size: number | null;
  stopPrice: number | null;
  source: string | null;
  thesis: string | null;
}

export type TradeArgsResult = { ok: true; args: TradeArgs } | { ok: false; reason?: 'stop' };

/**
 * Takes a marked stop out of the tokens wherever it sits: `sl 140`,
 * `sl=140`, `sl:140`, `stop 140`. Undefined when there is none; null when
 * one was marked but the price did not parse, which is refused rather than
 * dropped (a trade logged without the stop its owner typed is worse than
 * no trade logged).
 */
export function takeStop(tokens: string[]): number | null | undefined {
  for (let i = 0; i < tokens.length; i += 1) {
    const m = /^(sl|stop)(?:[=:](.*))?$/i.exec(tokens[i] as string);
    if (!m) continue;
    const inline = m[2];
    const raw = inline !== undefined && inline !== '' ? inline : tokens[i + 1];
    tokens.splice(i, inline !== undefined && inline !== '' ? 1 : 2);
    return parseNumber(raw);
  }
  return undefined;
}

const SIDES = new Set(['spot', 'long', 'short']);

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  // A comma decimal is what a Vietnamese keyboard types; "78,5" is 78.5,
  // never 785.
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseTradeArgs(text: string): TradeArgsResult {
  const body = text.replace(/^\/trade(@\S+)?/i, '').trim();
  const pipe = body.indexOf('|');
  const head = (pipe === -1 ? body : body.slice(0, pipe)).trim();
  const thesis = pipe === -1 ? '' : body.slice(pipe + 1).trim();

  const tokens = head.split(/\s+/).filter(Boolean);
  const [symbol, sideRaw, entryRaw, ...rest] = tokens;
  const side = sideRaw?.toLowerCase();
  const entryPrice = parseNumber(entryRaw);
  if (!symbol || !side || !SIDES.has(side) || entryPrice === null) return { ok: false };

  const stop = takeStop(rest);
  if (stop === null) return { ok: false, reason: 'stop' };

  let size: number | null = null;
  if (rest.length > 0 && parseNumber(rest[0]) !== null) {
    size = parseNumber(rest.shift());
  }
  const source = rest.join(' ').trim();

  return {
    ok: true,
    args: {
      symbol,
      side: side as TradeSide,
      entryPrice,
      size,
      stopPrice: stop ?? null,
      source: source === '' ? null : source,
      thesis: thesis === '' ? null : thesis,
    },
  };
}
