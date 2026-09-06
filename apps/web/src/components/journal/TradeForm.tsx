'use client';

import { useEffect, useState } from 'react';
import { createTrade } from '@/lib/api';
import type { TradeSide } from '@/lib/types';
import { cx } from '@/lib/format';
import type { TradePrefill } from '@/lib/journalPrefill';

interface TradeFormProps {
  onCreated: () => void;
  /**
   * Filled in by "Ghi vào journal" on a gem card. Deliberately a draft and
   * not a submission: the price came from the last scan, not from the fill
   * the user actually got, so it has to be theirs to correct before it
   * becomes a record of what they did.
   */
  prefill?: TradePrefill | null;
}

const inputClass =
  'rounded-md border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none';

const SIDE_STYLES: Record<TradeSide, string> = {
  spot: 'bg-sky-500/20 text-sky-300',
  long: 'bg-emerald-500/20 text-emerald-300',
  short: 'bg-rose-500/20 text-rose-300',
};

const SIDE_LABELS: Record<TradeSide, string> = { spot: 'Spot', long: 'Long', short: 'Short' };

export function TradeForm({ onCreated, prefill }: TradeFormProps) {
  const [symbol, setSymbol] = useState('');
  // Spot by default: it is the only one of the three that needs no margin
  // account, and a wrong default here writes a position type into the log
  // that the user never took.
  const [side, setSide] = useState<TradeSide>('spot');
  const [entryPrice, setEntryPrice] = useState('');
  const [size, setSize] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the prefill object, so clicking the same gem twice after
  // editing the form refills it, and typing in between is never clobbered
  // by a re-render.
  useEffect(() => {
    if (!prefill) return;
    setSymbol(prefill.symbol);
    setSide(prefill.side);
    setEntryPrice(prefill.entryPrice);
    setNote(prefill.note);
    setSize('');
    setError(null);
  }, [prefill]);

  const canSubmit = symbol.trim().length > 0 && entryPrice.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTrade({
        // Sent as typed. The API decides casing, because a Solana contract
        // address is base58 and upper-casing it stores a different token.
        symbol: symbol.trim(),
        side,
        entryPrice: Number(entryPrice),
        size: size.trim() === '' ? null : Number(size),
        note: note.trim() === '' ? null : note.trim(),
      });
      setSymbol('');
      setEntryPrice('');
      setSize('');
      setNote('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the trade.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Log a trade</h2>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Symbol">
          <input
            className={cx(inputClass, 'w-44')}
            placeholder="BTCUSDT hoặc địa chỉ contract"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
        </Field>

        <Field label="Side">
          <div className="flex overflow-hidden rounded-md border border-slate-700">
            {(['spot', 'long', 'short'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={cx(
                  'px-3 py-1.5 text-sm font-semibold transition-colors',
                  side === s ? SIDE_STYLES[s] : 'bg-slate-950/60 text-slate-500 hover:text-slate-300',
                )}
              >
                {SIDE_LABELS[s]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Entry price">
          <input
            className={cx(inputClass, 'w-28')}
            type="number"
            step="any"
            placeholder="78000"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
          />
        </Field>

        <Field label="Size (optional)">
          <input
            className={cx(inputClass, 'w-24')}
            type="number"
            step="any"
            placeholder="0.1"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </Field>

        <Field label="Note (optional)">
          <input
            className={cx(inputClass, 'w-48')}
            placeholder="why you took it"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-sky-500/90 px-4 py-1.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          {submitting ? 'Logging…' : 'Log trade'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}
