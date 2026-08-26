import type { GemRow, GemWatchDTO, LatestSymbolState, OverviewRow, PriceLevels, SignalRow, StablecoinFlowDTO, StablecoinFlowWindowDTO, TradeDTO, TradeSummaryDTO } from './apiClient.js';

function healthLine(row: OverviewRow): string {
  const score = row.healthScore === null ? 'N/A' : String(row.healthScore);
  const status = row.healthStatus === null ? 'futures-only' : row.healthStatus.replace(/_/g, ' ');
  return `${row.symbol.padEnd(8)} ${score.padStart(3)}  ${status}`;
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
      const cell = row ? (row.healthScore === null ? 'N/A' : String(row.healthScore)) : '-';
      return cell.padStart(6);
    });
    lines.push(`${symbol.padEnd(8)}${cells.join('')}`);
  }
  return `<pre>${lines.join('\n')}</pre>`;
}

/** Spec §20 exact /btc example shape. */
export function formatSymbolDetail(state: LatestSymbolState, activeSignals: SignalRow[], priceLevels: PriceLevels | null): string {
  const lines = [
    `<b>${state.symbol}</b>`,
    '',
    state.timeframe,
    state.healthScore === null
      ? 'Health: N/A (futures-only symbol, no Spot data)'
      : `Health: ${state.healthScore}  (${(state.healthStatus ?? '').replace(/_/g, ' ')})`,
    `Risk: ${state.riskScore}`,
    '',
    `Price       $${formatPrice(state.priceClose)}  (${state.priceChangePct >= 0 ? '+' : ''}${state.priceChangePct.toFixed(2)}%)`,
    `Spot CVD    ${state.spotCvd === null ? 'N/A' : formatLargeNumber(state.spotCvd)}`,
    `Futures CVD ${formatLargeNumber(state.futuresCvd)}`,
    `OI          ${formatLargeNumber(state.openInterest)}`,
    `Funding     ${state.fundingRatePct.toFixed(4)}%`,
    `Liquidation  L $${formatLargeNumber(state.liquidationLongUsd)} / S $${formatLargeNumber(state.liquidationShortUsd)}`,
  ];

  if (priceLevels) {
    lines.push(
      '',
      `Range(20)   $${formatPrice(priceLevels.lower)} – $${formatPrice(priceLevels.upper)}`,
      '<i>Bollinger 20,2 — reference only, not a buy/sell instruction.</i>',
    );
  }

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

/**
 * Small-cap candidates. Deliberately leads with the risk score and ends
 * with an explicit non-recommendation: these are screening results from
 * public DEX data, and the downside here is total loss, not a drawdown.
 */
export function formatGemList(gems: GemRow[]): string {
  if (gems.length === 0) {
    return 'No small-cap candidates currently pass the filters.\n\n<i>Either the scanner is disabled, has not run yet, or nothing in its sample qualified.</i>';
  }

  const lines = ['💎 <b>SMALL-CAP CANDIDATES</b>', ''];

  for (const gem of gems) {
    const safety =
      gem.safetyVerdict === 'safe'
        ? '✅ screened'
        : gem.safetyVerdict === 'caution'
          ? '⚠️ caution'
          : gem.safetyVerdict === 'danger'
            ? '⛔ danger'
            : '❔ unverified';

    lines.push(
      `<b>${escapeHtml(gem.symbol)}</b> · ${gem.chainId}`,
      `Gem ${gem.gemScore}/100 · Risk ${gem.riskScore}/100 · ${safety}`,
      `Liq $${gem.liquidityUsd === null ? '?' : formatLargeNumber(gem.liquidityUsd)} · Vol24h $${gem.volume24hUsd === null ? '?' : formatLargeNumber(gem.volume24hUsd)}${
        gem.priceChange24hPct === null ? '' : ` · ${gem.priceChange24hPct >= 0 ? '+' : ''}${gem.priceChange24hPct.toFixed(1)}%`
      }`,
      ...(gem.url ? [gem.url] : []),
      '',
    );
  }

  lines.push(
    '<i>Screening results from public DEX data, not recommendations. Small-cap tokens can lose most or all of their value quickly, and a safety screen cannot rule out every risk.</i>',
  );

  return lines.join('\n');
}

export function formatWatchConfirmation(watch: GemWatchDTO): string {
  return [
    `👀 Watching <b>${escapeHtml(watch.symbol)}</b>`,
    `<code>${escapeHtml(watch.tokenAddress)}</code> <i>(tap to copy)</i>`,
    '',
    `Entry price: $${watch.entryPrice}`,
    `Sell alert if:`,
    `• price falls ${watch.stopLossPct}% (stop-loss)`,
    `• price rises ${watch.takeProfitPct}% (take-profit)`,
    `• liquidity drops to ${watch.liquidityCollapsePct}% of entry`,
    `• risk score reaches ${watch.riskScoreAlert}/100, or safety turns dangerous`,
    '',
    '<i>Checked automatically in the background — you\'ll get a message here the moment one of these fires. This watch closes itself once it does; /watch it again to re-arm.</i>',
  ].join('\n');
}

export function formatWatchList(watches: GemWatchDTO[]): string {
  if (watches.length === 0) {
    return 'No active watches.\n\nUse /watch SYMBOL right after seeing it in /gems to start tracking a position.';
  }

  const lines = ['👀 <b>ACTIVE WATCHES</b>', ''];
  for (const w of watches) {
    lines.push(
      `<b>${escapeHtml(w.symbol)}</b> · ${w.chainId} — entry $${w.entryPrice}`,
      `<code>${escapeHtml(w.tokenAddress)}</code>`,
      `stop-loss ${w.stopLossPct}% · take-profit ${w.takeProfitPct}% · liq floor ${w.liquidityCollapsePct}%`,
      '',
    );
  }
  lines.push('<i>Tap an address to copy it. Use /unwatch SYMBOL to stop tracking one manually.</i>');
  return lines.join('\n');
}

export function formatTradeOpened(trade: TradeDTO): string {
  const lines = [
    `📓 Logged <b>${escapeHtml(trade.symbol)}</b> ${trade.side.toUpperCase()}`,
    `Entry: $${formatPrice(trade.entryPrice)}${trade.size !== null ? ` · size ${trade.size}` : ''}`,
    '',
    `<i>/close ${escapeHtml(trade.symbol)} EXIT_PRICE when you're out.</i>`,
  ];
  return lines.join('\n');
}

export function formatTradeClosed(trade: TradeDTO): string {
  const won = (trade.pnlPct ?? 0) > 0;
  const pctText = trade.pnlPct === null ? 'N/A' : `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%`;
  const usdText = trade.pnlUsd === null ? '' : ` (${trade.pnlUsd >= 0 ? '+' : ''}$${formatPrice(trade.pnlUsd)})`;

  return [
    `${won ? '✅' : '🔻'} Closed <b>${escapeHtml(trade.symbol)}</b> ${trade.side.toUpperCase()}`,
    `Entry $${formatPrice(trade.entryPrice)} → Exit $${formatPrice(trade.exitPrice ?? 0)}`,
    `P&L: <b>${pctText}</b>${usdText}`,
  ].join('\n');
}

export function formatJournal(trades: TradeDTO[], summary: TradeSummaryDTO): string {
  const lines = ['📓 <b>TRADE JOURNAL</b>', ''];

  if (summary.closedCount === 0) {
    lines.push('No closed trades yet.');
  } else {
    const totalPnl =
      summary.totalPnlUsd === null
        ? '<b>N/A</b> <i>(no sizes logged)</i>'
        : `<b>${summary.totalPnlUsd >= 0 ? '+' : ''}$${formatPrice(summary.totalPnlUsd)}</b>`;
    lines.push(
      `Win rate: <b>${summary.winRatePct!.toFixed(0)}%</b> (${summary.wins}W / ${summary.losses}L)`,
      `Total P&L: ${totalPnl}` +
        (summary.avgPnlPct === null ? '' : ` · avg ${summary.avgPnlPct >= 0 ? '+' : ''}${summary.avgPnlPct.toFixed(2)}%/trade`),
    );
  }
  if (summary.openCount > 0) lines.push(`Open positions: ${summary.openCount}`);
  lines.push('');

  if (trades.length === 0) {
    lines.push('No trades logged yet. Use /trade SYMBOL long|short ENTRY [SIZE] to start.');
    return lines.join('\n');
  }

  for (const t of trades) {
    if (t.status === 'open') {
      lines.push(`🟡 <b>${escapeHtml(t.symbol)}</b> ${t.side.toUpperCase()} · entry $${formatPrice(t.entryPrice)} · open`);
    } else {
      const pct = t.pnlPct ?? 0;
      lines.push(
        `${pct > 0 ? '🟢' : '🔴'} <b>${escapeHtml(t.symbol)}</b> ${t.side.toUpperCase()} · $${formatPrice(t.entryPrice)} → $${formatPrice(t.exitPrice ?? 0)} · ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Macro flow context. Leads with what the number is, ends with what it
 * isn't — the daily lag and the "not trend confirmation" caveat are the
 * whole point, since this is the reading most likely to be mistaken for a
 * green light.
 */
export function formatFlow(flow: StablecoinFlowDTO | null): string {
  if (!flow) {
    return 'No stablecoin supply data yet.\n\n<i>The collector refreshes this a few times a day — check back shortly after the worker starts.</i>';
  }

  return [
    '\uD83D\uDCB5 <b>STABLECOIN SUPPLY</b>',
    '',
    `Total: <b>$${formatLargeNumber(flow.latestUsd)}</b>`,
    `7d:  ${windowLine(flow.change7d)}`,
    `30d: ${windowLine(flow.change30d)}`,
    '',
    `<i>As of ${flow.asOfDay}. Rising supply means fiat was converted into on-chain dollars; it does not say which asset that money buys. Daily data, lags the market \u2014 context only, not trend confirmation.</i>`,
  ].join('\n');
}

function windowLine(w: StablecoinFlowWindowDTO | null): string {
  if (!w) return 'N/A <i>(not enough history)</i>';
  const sign = w.changeUsd >= 0 ? '+' : '-';
  return `<b>${sign}$${formatLargeNumber(Math.abs(w.changeUsd))}</b> (${w.changePct >= 0 ? '+' : ''}${w.changePct.toFixed(2)}%)`;
}

/** Token names/symbols come from on-chain metadata that anyone can set, so they're escaped before entering an HTML-parsed message. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Full precision with thousands separators — unlike formatLargeNumber, a price should never compact to "78.58K". */
function formatPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

/** Symbol commands are derived from the tracked symbol list, so /help never drifts from what the bot actually accepts. */
export function buildHelpText(symbols: string[]): string {
  const symbolCommands = symbols
    .map((s) => `/${(s.endsWith('USDT') ? s.slice(0, -4) : s).toLowerCase()}`)
    .join(' ');

  return [
    '<b>Market Health Monitor</b>',
    '',
    '/status — quick health overview (15m)',
    '/market — full heatmap across timeframes',
    `${symbolCommands} — symbol detail`,
    '/signals — recent signals',
    '/gems — small-cap candidates from DEX data',
    '/watch SYMBOL — track a position you bought, get a sell alert here',
    '/watches — list your active watches',
    '/unwatch SYMBOL — stop tracking one',
    '/trade SYMBOL long|short ENTRY [SIZE] — log a trade you took',
    '/close SYMBOL EXIT_PRICE — close your most recent open trade on that symbol',
    '/journal — your trade log + win rate / P&L summary',
    '/flow — stablecoin supply: money entering or leaving crypto',
    '/alerts on|off — toggle alert push to this chat',
    '/help — this message',
    '',
    '<i>Symbols listed on Binance Futures but not Spot show Health: N/A — the score compares spot demand against futures, which needs both.</i>',
  ].join('\n');
}
