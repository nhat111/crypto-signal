'use client';

import type { Trade } from '@/lib/types';
import { cx, formatDateTime, formatTokenPrice, formatUsd } from '@/lib/format';
import { markPriceNote, unrealizedLabel } from '@/lib/openPnl';
import { DecimalInput } from './DecimalInput';
import { useTradeActions } from './useTradeActions';

interface TradeRowProps {
  trade: Trade;
  onChanged: () => void;
  /** The server's clock, passed in rather than read here — Date.now() in render is impure. Null when the API sends none. */
  nowMs: number | null;
}

/** Spot is its own colour: reading it as a long at a glance is the mistake worth preventing. */
const SIDE_BADGE: Record<Trade['side'], string> = {
  spot: 'bg-sky-500/15 text-sky-300',
  long: 'bg-emerald-500/15 text-emerald-300',
  short: 'bg-rose-500/15 text-rose-300',
};

const inputClass =
  'rounded border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-200 focus:border-sky-500/60 focus:outline-none';

export function TradeRow({ trade, onChanged, nowMs }: TradeRowProps) {
  // Close/edit/delete live in useTradeActions, shared with the mobile card.
  // This row used to carry its own copy, and the copies had already drifted:
  // the card validated an exit price, the row parsed it with Number(), so
  // the same typed comma behaved differently depending on screen width.
  const a = useTradeActions(trade, onChanged);
  const { mode, setMode, busy, error, exitDraft, setExitDraft, editDraft, setEditDraft } = a;

  const pnlTone = trade.pnlPct === null ? undefined : trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const unrealized = trade.status === 'open' ? unrealizedLabel(trade) : null;
  const mark = trade.status === 'open' ? markPriceNote(trade, nowMs) : null;

  return (
    <tr className="border-b border-slate-800/60 align-top">
      <td className="py-2 pl-3 pr-3">
        <span className="font-semibold text-slate-100">{trade.symbol}</span>
        <span className={cx('ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', SIDE_BADGE[trade.side])}>
          {trade.side}
        </span>
      </td>

      {mode === 'editing' ? (
        <>
          <td className="py-2 pr-3">
            <DecimalInput
              aria-label="Entry price"
              className={cx(inputClass, 'w-24')}
              value={editDraft.entryPrice}
              onValueChange={(v) => setEditDraft((d) => ({ ...d, entryPrice: v }))}
            />
          </td>
          <td className="py-2 pr-3">
            <DecimalInput
              aria-label="Exit price"
              className={cx(inputClass, 'w-24')}
              placeholder="open"
              value={editDraft.exitPrice}
              onValueChange={(v) => setEditDraft((d) => ({ ...d, exitPrice: v }))}
            />
          </td>
          <td className="py-2 pr-3">
            <DecimalInput
              aria-label="Size"
              className={cx(inputClass, 'w-20')}
              placeholder="—"
              value={editDraft.size}
              onValueChange={(v) => setEditDraft((d) => ({ ...d, size: v }))}
            />
          </td>
          <td className="py-2 pr-3 text-slate-600">—</td>
          <td className="py-2 pr-3">
            <input
              className={cx(inputClass, 'w-32')}
              value={editDraft.note}
              onChange={(e) => setEditDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </td>
        </>
      ) : (
        <>
          <td className="py-2 pr-3 tabular-nums text-slate-300">{formatTokenPrice(trade.entryPrice)}</td>
          <td className="py-2 pr-3 tabular-nums text-slate-300">
            {trade.exitPrice === null ? (
              <>
                <span className="text-slate-600">open</span>
                {mark && <span className="block text-[10px] leading-tight text-slate-500">{mark}</span>}
              </>
            ) : (
              formatTokenPrice(trade.exitPrice)
            )}
          </td>
          <td className="py-2 pr-3 tabular-nums text-slate-400">{trade.size ?? <span className="text-slate-600">—</span>}</td>
          <td className="py-2 pr-3 tabular-nums">
            {trade.pnlPct === null ? (
              // An open position shows the estimate, dimmed and prefixed so
              // it never reads as the settled number a closed row shows.
              unrealized !== null ? (
                <span
                  className={cx('text-xs', (trade.unrealizedPnlPct ?? 0) >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70')}
                  title="Estimated at the current price — the position is still open."
                >
                  {unrealized}
                  {trade.unrealizedPnlUsd !== null && trade.unrealizedPnlUsd !== undefined && (
                    <span className="ml-1 text-[11px] opacity-80">
                      ({trade.unrealizedPnlUsd >= 0 ? '+' : ''}
                      {formatUsd(trade.unrealizedPnlUsd, false)})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-600">—</span>
              )
            ) : (
              <span className={pnlTone}>
                {trade.pnlPct >= 0 ? '+' : ''}
                {trade.pnlPct.toFixed(2)}%
                {trade.pnlUsd !== null && (
                  <span className="ml-1 text-[11px] opacity-80">
                    ({trade.pnlUsd >= 0 ? '+' : ''}
                    {formatUsd(trade.pnlUsd, false)})
                  </span>
                )}
              </span>
            )}
          </td>
          <td className="max-w-[14rem] truncate py-2 pr-3 text-slate-500">{trade.note ?? '—'}</td>
        </>
      )}

      <td className="whitespace-nowrap py-2 pr-3 text-[11px] text-slate-600">{formatDateTime(trade.openedAt)}</td>

      <td className="py-2">
        <div className="flex items-center gap-1.5">
          {mode === 'view' && (
            <>
              {trade.status === 'open' && (
                <button onClick={() => setMode('closing')} className="text-xs font-medium text-sky-400 hover:text-sky-300">
                  Close
                </button>
              )}
              <button onClick={() => setMode('editing')} className="text-xs font-medium text-slate-400 hover:text-slate-200">
                Edit
              </button>
              <button onClick={a.handleDelete} disabled={busy} className="text-xs font-medium text-rose-500/80 hover:text-rose-400">
                Delete
              </button>
            </>
          )}

          {mode === 'closing' && (
            <div className="flex items-center gap-1">
              <DecimalInput
                autoFocus
                aria-label="Exit price"
                className={cx(inputClass, 'w-24')}
                placeholder="exit price"
                value={exitDraft}
                onValueChange={setExitDraft}
              />
              <button onClick={a.handleClose} disabled={busy || !a.canClose} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-600">
                Confirm
              </button>
              <button onClick={() => setMode('view')} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          )}

          {mode === 'editing' && (
            <div className="flex items-center gap-1.5">
              <button onClick={a.handleSaveEdit} disabled={busy || !a.canSaveEdit} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-600">
                Save
              </button>
              <button onClick={() => setMode('view')} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          )}
        </div>
        {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
      </td>
    </tr>
  );
}
