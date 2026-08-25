'use client';

import { useState } from 'react';
import { deleteTrade, updateTrade } from '@/lib/api';
import type { Trade } from '@/lib/types';
import { cx, formatDateTime, formatUsd } from '@/lib/format';

interface TradeRowProps {
  trade: Trade;
  onChanged: () => void;
}

type Mode = 'view' | 'closing' | 'editing';

const inputClass =
  'rounded border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-200 focus:border-sky-500/60 focus:outline-none';

export function TradeRow({ trade, onChanged }: TradeRowProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exitDraft, setExitDraft] = useState('');
  const [editDraft, setEditDraft] = useState(() => ({
    entryPrice: String(trade.entryPrice),
    exitPrice: trade.exitPrice === null ? '' : String(trade.exitPrice),
    size: trade.size === null ? '' : String(trade.size),
    note: trade.note ?? '',
  }));

  async function handleClose() {
    if (exitDraft.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await updateTrade(trade.id, { exitPrice: Number(exitDraft) });
      setMode('view');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close trade.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    setBusy(true);
    setError(null);
    try {
      await updateTrade(trade.id, {
        entryPrice: Number(editDraft.entryPrice),
        exitPrice: editDraft.exitPrice.trim() === '' ? null : Number(editDraft.exitPrice),
        size: editDraft.size.trim() === '' ? null : Number(editDraft.size),
        note: editDraft.note.trim() === '' ? null : editDraft.note.trim(),
      });
      setMode('view');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete this ${trade.symbol} entry? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTrade(trade.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete trade.');
      setBusy(false);
    }
  }

  const pnlTone = trade.pnlPct === null ? undefined : trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400';

  return (
    <tr className="border-b border-slate-800/60 align-top">
      <td className="py-2 pl-3 pr-3">
        <span className="font-semibold text-slate-100">{trade.symbol}</span>
        <span
          className={cx(
            'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            trade.side === 'long' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
          )}
        >
          {trade.side}
        </span>
      </td>

      {mode === 'editing' ? (
        <>
          <td className="py-2 pr-3">
            <input
              className={cx(inputClass, 'w-24')}
              type="number"
              step="any"
              value={editDraft.entryPrice}
              onChange={(e) => setEditDraft((d) => ({ ...d, entryPrice: e.target.value }))}
            />
          </td>
          <td className="py-2 pr-3">
            <input
              className={cx(inputClass, 'w-24')}
              type="number"
              step="any"
              placeholder="open"
              value={editDraft.exitPrice}
              onChange={(e) => setEditDraft((d) => ({ ...d, exitPrice: e.target.value }))}
            />
          </td>
          <td className="py-2 pr-3">
            <input
              className={cx(inputClass, 'w-20')}
              type="number"
              step="any"
              placeholder="—"
              value={editDraft.size}
              onChange={(e) => setEditDraft((d) => ({ ...d, size: e.target.value }))}
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
          <td className="py-2 pr-3 tabular-nums text-slate-300">{formatUsd(trade.entryPrice, false)}</td>
          <td className="py-2 pr-3 tabular-nums text-slate-300">
            {trade.exitPrice === null ? <span className="text-slate-600">open</span> : formatUsd(trade.exitPrice, false)}
          </td>
          <td className="py-2 pr-3 tabular-nums text-slate-400">{trade.size ?? <span className="text-slate-600">—</span>}</td>
          <td className="py-2 pr-3 tabular-nums">
            {trade.pnlPct === null ? (
              <span className="text-slate-600">—</span>
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
              <button onClick={handleDelete} disabled={busy} className="text-xs font-medium text-rose-500/80 hover:text-rose-400">
                Delete
              </button>
            </>
          )}

          {mode === 'closing' && (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                className={cx(inputClass, 'w-24')}
                type="number"
                step="any"
                placeholder="exit price"
                value={exitDraft}
                onChange={(e) => setExitDraft(e.target.value)}
              />
              <button onClick={handleClose} disabled={busy || exitDraft.trim() === ''} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-600">
                Confirm
              </button>
              <button onClick={() => setMode('view')} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          )}

          {mode === 'editing' && (
            <div className="flex items-center gap-1.5">
              <button onClick={handleSaveEdit} disabled={busy} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">
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
