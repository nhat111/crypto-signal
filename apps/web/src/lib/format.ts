/** Formatting helpers. All display-only — never used to derive logic. */

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

const usdFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const numberCompact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export function formatUsd(value: number | null | undefined, compact = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return (compact ? usdCompact : usdFull).format(value);
}

/** Signed USD, e.g. spot/futures CVD where sign carries meaning (buy vs sell pressure). */
export function formatSignedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${usdCompact.format(value)}`;
}

export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberCompact.format(value);
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toString();
}

export function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(timestampMs: number, nowMs = Date.now()): string {
  const diffSec = Math.round((nowMs - timestampMs) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * A symbol's data is only as good as its last snapshot.
 *
 * The threshold matches the collector card on /status, deliberately: a
 * symbol that page calls stale must not read as current on Overview. It
 * did — HYPE's stream stopped and its card kept showing a price, a change
 * percentage and an open interest figure with nothing to say they were
 * fifteen hours old. A number with no age on it is read as "now".
 */
export const STALE_DATA_MS = 15 * 60_000;

export function isStale(timestampMs: number | null | undefined, nowMs = Date.now()): boolean {
  if (timestampMs === null || timestampMs === undefined) return false;
  return nowMs - timestampMs > STALE_DATA_MS;
}
