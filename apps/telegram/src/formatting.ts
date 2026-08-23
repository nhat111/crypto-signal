import type { LatestSymbolState, OverviewRow, SignalRow } from './apiClient.js';

function healthLine(row: OverviewRow): string {
  return `${row.symbol.padEnd(8)} ${String(row.healthScore).padStart(3)}  ${row.healthStatus.replace(/_/g, ' ')}`;
}

/** Spec §17 dashboard mock, adapted to plain text for /status and /market. */
export function formatOverview(rows: OverviewRow[], timeframe: string): string {
  const filtered = rows.filter((r) => r.timeframe === timeframe);
  const lines = ['<b>MARKET HEALTH</b>', `(${timeframe})`, '', ...filtered.map(healthLine)];
  return lines.join('\n');
}

/** Spec §19 heatmap, in monospace text form. */
export function formatHeatmap(rows: OverviewRow[], symbols: string[], timeframes: string[]): string {
  const header = `${'SYMBOL'.padEnd(8)}${timeframes.map((tf) => tf.padStart(6)).join('')}`;
  const lines = [header];
  for (const symbol of symbols) {
    const cells = timeframes.map((tf) => {
      const row = rows.find((r) => r.symbol === symbol && r.timeframe === tf);
      return (row ? String(row.healthScore) : '-').padStart(6);
    });
    lines.push(`${symbol.padEnd(8)}${cells.join('')}`);
  }
  return `<pre>${lines.join('\n')}</pre>`;
}

/** Spec §20 exact /btc example shape. */
export function formatSymbolDetail(state: LatestSymbolState, activeSignals: SignalRow[]): string {
  const lines = [
    `<b>${state.symbol}</b>`,
    '',
    state.timeframe,
    `Health: ${state.healthScore}  (${state.healthStatus.replace(/_/g, ' ')})`,
    `Risk: ${state.riskScore}`,
    '',
    `Price       ${state.priceChangePct >= 0 ? '+' : ''}${state.priceChangePct.toFixed(2)}%`,
    `Spot CVD    ${formatLargeNumber(state.spotCvd)}`,
    `Futures CVD ${formatLargeNumber(state.futuresCvd)}`,
    `OI          ${formatLargeNumber(state.openInterest)}`,
    `Funding     ${state.fundingRatePct.toFixed(4)}%`,
    `Liquidation  L $${formatLargeNumber(state.liquidationLongUsd)} / S $${formatLargeNumber(state.liquidationShortUsd)}`,
  ];

  if (activeSignals.length === 0) {
    lines.push('', 'Signal: none active');
  } else {
    lines.push('');
    for (const signal of activeSignals) {
      lines.push(`⚠️ <b>${signal.signalType.replace(/_/g, ' ')}</b>`, `Confidence: ${signal.confidence}%`);
    }
  }

  return lines.join('\n');
}

export function formatSignalList(signals: SignalRow[]): string {
  if (signals.length === 0) return 'No recent signals.';
  return signals
    .map((s) => `${s.symbol} ${s.timeframe} — <b>${s.signalType.replace(/_/g, ' ')}</b> (${s.severity}, ${s.confidence}%)`)
    .join('\n');
}

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export const HELP_TEXT = [
  '<b>Market Health Monitor</b>',
  '',
  '/status — quick health overview (15m)',
  '/market — full heatmap across timeframes',
  '/btc /eth /sol — symbol detail',
  '/signals — recent signals',
  '/alerts on|off — toggle alert push to this chat',
  '/help — this message',
].join('\n');
