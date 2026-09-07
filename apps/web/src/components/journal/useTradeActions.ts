'use client';

import { useState } from 'react';
import { deleteTrade, updateTrade } from '@/lib/api';
import type { Trade } from '@/lib/types';

export type TradeMode = 'view' | 'closing' | 'editing';

export interface TradeEditDraft {
  entryPrice: string;
  exitPrice: string;
  size: string;
  note: string;
}

/**
 * Close / edit / delete for one trade, shared by the table row and the
 * mobile card.
 *
 * Extracted rather than duplicated because these three calls are the only
 * writes on the page: two copies would eventually disagree about what
 * counts as a valid exit price or which errors are shown, and the copy a
 * phone user hits is the one nobody tests by hand.
 */
export function useTradeActions(trade: Trade, onChanged: () => void) {
  const [mode, setMode] = useState<TradeMode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitDraft, setExitDraft] = useState('');
  const [editDraft, setEditDraft] = useState<TradeEditDraft>(() => ({
    entryPrice: String(trade.entryPrice),
    exitPrice: trade.exitPrice === null ? '' : String(trade.exitPrice),
    size: trade.size === null ? '' : String(trade.size),
    note: trade.note ?? '',
  }));

  async function run(action: () => Promise<unknown>, fallback: string, keepBusy = false) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode('view');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      // Delete unmounts the row on success, so leaving busy set there
      // avoids a state update on a gone component; every other path clears.
      if (!keepBusy) setBusy(false);
    }
  }

  return {
    mode,
    setMode,
    busy,
    error,
    exitDraft,
    setExitDraft,
    editDraft,
    setEditDraft,
    canClose: exitDraft.trim() !== '',
    handleClose: () =>
      exitDraft.trim() === ''
        ? undefined
        : run(() => updateTrade(trade.id, { exitPrice: Number(exitDraft) }), 'Could not close trade.'),
    handleSaveEdit: () =>
      run(
        () =>
          updateTrade(trade.id, {
            entryPrice: Number(editDraft.entryPrice),
            exitPrice: editDraft.exitPrice.trim() === '' ? null : Number(editDraft.exitPrice),
            size: editDraft.size.trim() === '' ? null : Number(editDraft.size),
            note: editDraft.note.trim() === '' ? null : editDraft.note.trim(),
          }),
        'Could not save changes.',
      ),
    handleDelete: () => {
      if (!window.confirm(`Delete this ${trade.symbol} entry? This can't be undone.`)) return;
      return run(() => deleteTrade(trade.id), 'Could not delete trade.', true);
    },
  };
}
