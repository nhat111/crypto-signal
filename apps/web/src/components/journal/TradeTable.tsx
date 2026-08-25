import type { Trade } from '@/lib/types';
import { TradeRow } from './TradeRow';

interface TradeTableProps {
  trades: Trade[];
  onChanged: () => void;
}

export function TradeTable({ trades, onChanged }: TradeTableProps) {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        No trades logged yet — use the form above, or /trade on the bot.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
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
            <TradeRow key={trade.id} trade={trade} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
