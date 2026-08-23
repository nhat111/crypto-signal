import { SignalRow } from './SignalRow';
import { StatePanel } from '@/components/StatePanel';
import type { Signal } from '@/lib/types';

interface SignalListProps {
  signals: Signal[];
  showSymbol?: boolean;
  emptyLabel?: string;
}

export function SignalList({ signals, showSymbol = true, emptyLabel = 'No signals yet.' }: SignalListProps) {
  if (signals.length === 0) {
    return <StatePanel title={emptyLabel} detail="Signals appear here as soon as the engine fires one." />;
  }

  return (
    <ul className="space-y-2">
      {signals.map((signal) => (
        <SignalRow key={signal.signalId} signal={signal} showSymbol={showSymbol} />
      ))}
    </ul>
  );
}
