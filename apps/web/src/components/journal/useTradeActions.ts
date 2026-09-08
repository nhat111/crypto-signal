'use client';

import { useState } from 'react';
import { deleteTrade, updateTrade } from '@/lib/api';
import { parsePriceInput, parseSizeInput } from '@/lib/parseDecimal';
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
 *
 * Every price here goes through parsePriceInput, never Number(): a comma
 * decimal has to survive, and `Number('')` is 0, which as an exit price
 * books a total loss and as an entry price divides by zero.
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

  const parsedExit = parsePriceInput(exitDraft);
  const parsedEditEntry = parsePriceInput(editDraft.entryPrice);
  // Blank is a legitimate value for both — it means "still open" and "not
  // recorded" — so only a non-blank field that will not parse is invalid.
  const editExitValid = editDraft.exitPrice.trim() === '' || parsePriceInput(editDraft.exitPrice) !== null;
  const editSizeValid = editDraft.size.trim() === '' || parseSizeInput(editDraft.size) !== null;

  return {
    mode,
    setMode,
    busy,
    error,
    exitDraft,
    setExitDraft,
    editDraft,
    setEditDraft,
    canClose: parsedExit !== null,
    handleClose: () =>
      parsedExit === null
        ? undefined
        : run(() => updateTrade(trade.id, { exitPrice: parsedExit }), 'Could not close trade.'),
    canSaveEdit: parsedEditEntry !== null && editExitValid && editSizeValid,
    handleSaveEdit: () => {
      // Guarded rather than clamped: a price we cannot read is a question
      // for the person who typed it, not something to substitute a value
      // for. The button is disabled on the same condition, so this is the
      // backstop, not the message.
      if (parsedEditEntry === null || !editExitValid || !editSizeValid) return undefined;
      return run(
        () =>
          updateTrade(trade.id, {
            entryPrice: parsedEditEntry,
            exitPrice: editDraft.exitPrice.trim() === '' ? null : parsePriceInput(editDraft.exitPrice),
            size: editDraft.size.trim() === '' ? null : parseSizeInput(editDraft.size),
            note: editDraft.note.trim() === '' ? null : editDraft.note.trim(),
          }),
        'Could not save changes.',
      );
    },
    handleDelete: () => {
      if (!window.confirm(`Delete this ${trade.symbol} entry? This can't be undone.`)) return;
      return run(() => deleteTrade(trade.id), 'Could not delete trade.', true);
    },
  };
}
