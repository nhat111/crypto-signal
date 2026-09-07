'use client';

import type { Trade } from '@/lib/types';
import { cx, formatDateTime, formatTokenPrice, formatUsd } from '@/lib/format';
import { markPriceNote, unrealizedLabel } from '@/lib/openPnl';
import { useTradeActions } from './useTradeActions';

/**
 * One trade on a phone.
 *
 * The table needs 720px to lay eight columns out, so on a 390px screen the
 * journal — the page whose whole job is being read — was 458px of
 * sideways swiping. A card stacks the same fields and fits.
 *
 * Actions are full-height buttons rather than the table's text links: the
 * row versions measured 16px tall, well under the 44px a fingertip
 * actually needs, sitting next to a Delete that cannot be undone.
 */
const SIDE_BADGE: Record<Trade['side'], string> = {
  spot: 'bg-sky-500/15 text-sky-300',
  long: 'bg-emerald-500/15 text-emerald-300',
  short: 'bg-rose-500/15 text-rose-300',
};

const inputClass =
  'w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-2 text-sm text-slate-200 focus:border-sky-500/60 focus:outline-none';

const actionClass = 'min-h-[44px] flex-1 rounded-md border px-3 text-sm font-semibold transition-colors';

export function TradeCard({ trade, onChanged, nowMs }: { trade: Trade; onChanged: () => void; nowMs: number | null }) {
  const a = useTradeActions(trade, onChanged);

  const pnlTone = trade.pnlPct === null ? undefined : trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const unrealized = trade.status === 'open' ? unrealizedLabel(trade) : null;
  const mark = trade.status === 'open' ? markPriceNote(trade, nowMs) : null;

  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-slate-100">{trade.symbol}</span>
          <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', SIDE_BADGE[trade.side])}>
            {trade.side}
          </span>
        </div>
        <span className="text-[11px] text-slate-600">{formatDateTime(trade.openedAt)}</span>
      </div>

      {a.mode === 'editing' ? (
        <div className="mt-3 space-y-2">
          <Field label="Entry price">
            <input
              className={inputClass}
              type="number"
              step="any"
              inputMode="decimal"
              value={a.editDraft.entryPrice}
              onChange={(e) => a.setEditDraft((d) => ({ ...d, entryPrice: e.target.value }))}
            />
          </Field>
          <Field label="Exit price (blank = still open)">
            <input
              className={inputClass}
              type="number"
              step="any"
              inputMode="decimal"
              value={a.editDraft.exitPrice}
              onChange={(e) => a.setEditDraft((d) => ({ ...d, exitPrice: e.target.value }))}
            />
          </Field>
          <Field label="Size">
            <input
              className={inputClass}
              type="number"
              step="any"
              inputMode="decimal"
              value={a.editDraft.size}
              onChange={(e) => a.setEditDraft((d) => ({ ...d, size: e.target.value }))}
            />
          </Field>
          <Field label="Note">
            <input
              className={inputClass}
              value={a.editDraft.note}
              onChange={(e) => a.setEditDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </Field>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Cell label="Entry" value={formatTokenPrice(trade.entryPrice)} />
          <Cell
            label="Exit"
            value={trade.exitPrice === null ? 'open' : formatTokenPrice(trade.exitPrice)}
            sub={trade.exitPrice === null ? mark ?? undefined : undefined}
          />
          <Cell label="Size" value={trade.size === null ? '—' : String(trade.size)} />
          <Cell
            label="P&L"
            value={
              trade.pnlPct === null
                ? unrealized ?? '—'
                : `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%`
            }
            sub={
              trade.pnlPct !== null && trade.pnlUsd !== null
                ? `${trade.pnlUsd >= 0 ? '+' : ''}${formatUsd(trade.pnlUsd, false)}`
                : trade.unrealizedPnlUsd !== null && trade.unrealizedPnlUsd !== undefined
                  ? `${trade.unrealizedPnlUsd >= 0 ? '+' : ''}${formatUsd(trade.unrealizedPnlUsd, false)}`
                  : undefined
            }
            tone={trade.pnlPct === null ? (unrealized === null ? undefined : 'estimate') : pnlTone}
          />
        </dl>
      )}

      {trade.note && a.mode !== 'editing' && <p className="mt-2 text-[11px] text-slate-500">{trade.note}</p>}

      {a.mode === 'closing' && (
        <div className="mt-3">
          <Field label="Exit price">
            <input
              autoFocus
              className={inputClass}
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="what you sold at"
              value={a.exitDraft}
              onChange={(e) => a.setExitDraft(e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {a.mode === 'view' && (
          <>
            {trade.status === 'open' && (
              <button
                onClick={() => a.setMode('closing')}
                className={cx(actionClass, 'border-sky-500/40 bg-sky-500/10 text-sky-300')}
              >
                Close
              </button>
            )}
            <button onClick={() => a.setMode('editing')} className={cx(actionClass, 'border-slate-700 text-slate-300')}>
              Edit
            </button>
            <button
              onClick={a.handleDelete}
              disabled={a.busy}
              className={cx(actionClass, 'border-rose-500/30 text-rose-400/90 disabled:opacity-50')}
            >
              Delete
            </button>
          </>
        )}

        {a.mode === 'closing' && (
          <>
            <button
              onClick={a.handleClose}
              disabled={a.busy || !a.canClose}
              className={cx(actionClass, 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 disabled:opacity-40')}
            >
              Confirm
            </button>
            <button onClick={() => a.setMode('view')} className={cx(actionClass, 'border-slate-700 text-slate-400')}>
              Cancel
            </button>
          </>
        )}

        {a.mode === 'editing' && (
          <>
            <button
              onClick={a.handleSaveEdit}
              disabled={a.busy}
              className={cx(actionClass, 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 disabled:opacity-40')}
            >
              Save
            </button>
            <button onClick={() => a.setMode('view')} className={cx(actionClass, 'border-slate-700 text-slate-400')}>
              Cancel
            </button>
          </>
        )}
      </div>

      {a.error && <p className="mt-2 text-[11px] text-rose-400">{a.error}</p>}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-slate-800/70 bg-slate-950/40 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cx('tabular-nums', tone === 'estimate' ? 'text-slate-400' : tone ?? 'text-slate-200')}>{value}</dd>
      {sub && <dd className="text-[10px] leading-tight text-slate-500">{sub}</dd>}
    </div>
  );
}
