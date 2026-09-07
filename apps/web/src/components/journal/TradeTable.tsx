import type { Trade } from '@/lib/types';
import { TradeCard } from './TradeCard';
import { TradeRow } from './TradeRow';

interface TradeTableProps {
  trades: Trade[];
  onChanged: () => void;
  /** The API's clock, threaded down so no row reads Date.now() during render. */
  nowMs: number | null;
}

export function TradeTable({ trades, onChanged, nowMs }: TradeTableProps) {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        No trades logged yet — use the form above, or /trade on the bot.
      </div>
    );
  }

  return (
    <>
      {/* Cards below sm: the table needs 720px for eight columns, so on a
          390px phone the page whose job is being read was 458px of
          sideways swiping. */}
      <div className="space-y-3 sm:hidden">
        {trades.map((trade) => (
          <TradeCard key={trade.id} trade={trade} onChanged={onChanged} nowMs={nowMs} />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40 sm:block">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2 pl-3 pr-3 font-medium">Symbol</th>
            <th className="py-2 pr-3 font-medium">Entry</th>
            <th className="py-2 pr-3 font-medium">Exit</th>
            <th className="py-2 pr-3 font-medium">Size</th>
            <th className="py-2 pr-3 font-medium">P&amp;L</th>
            <th className="py-2 pr-3 font-medium">Note</th>
            <th className="py-2 pr-3 font-medium">Opened</th>
            <th className="py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="pl-3">
          {trades.map((trade) => (
            <TradeRow key={trade.id} trade={trade} onChanged={onChanged} nowMs={nowMs} />
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
