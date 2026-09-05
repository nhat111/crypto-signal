import type { Severity, SignalType } from './types';

interface SeverityColorSet {
  text: string;
  bg: string;
  border: string;
  leftBorder: string;
  ring: string;
}

/**
 * Severity must be visually loud in proportion to how loud it is — EXTREME
 * should not read like INFO with a different label. Ramp goes gray → blue →
 * yellow → orange → red with increasing saturation/weight.
 */
export const SEVERITY_COLORS: Record<Severity, SeverityColorSet> = {
  INFO: {
    text: 'text-slate-300',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    leftBorder: 'border-l-slate-500/60',
    ring: 'ring-slate-500/40',
  },
  LOW: {
    text: 'text-sky-300',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    leftBorder: 'border-l-sky-500/60',
    ring: 'ring-sky-500/40',
  },
  MEDIUM: {
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    leftBorder: 'border-l-amber-500/60',
    ring: 'ring-amber-500/40',
  },
  HIGH: {
    text: 'text-orange-300',
    bg: 'bg-orange-500/15',
    border: 'border-orange-500/40',
    leftBorder: 'border-l-orange-500/70',
    ring: 'ring-orange-500/50',
  },
  EXTREME: {
    text: 'text-red-300',
    bg: 'bg-red-500/20',
    border: 'border-red-500/50',
    leftBorder: 'border-l-red-500/80',
    ring: 'ring-red-500/60',
  },
};

/** Hex equivalents for lightweight-charts markers, which can't take Tailwind classes. */
export const SEVERITY_HEX: Record<Severity, string> = {
  INFO: '#94a3b8',
  LOW: '#38bdf8',
  MEDIUM: '#fbbf24',
  HIGH: '#fb923c',
  EXTREME: '#f87171',
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  EXTREME: 4,
};

/** Short, readable label for each signal type (spec §7/§15). */
export const SIGNAL_TYPE_LABEL: Record<SignalType, string> = {
  LEVERAGED_RALLY: 'Leveraged Rally',
  SPOT_CONFIRMED_RALLY: 'Spot-Confirmed Rally',
  SHORT_COVERING_POSSIBLE: 'Short Covering (possible)',
  SELLING_ABSORPTION_POSSIBLE: 'Selling Absorption (possible)',
  BULLISH_SPOT_DIVERGENCE: 'Bullish Spot Divergence',
  LONG_LIQUIDATION: 'Long Liquidation',
  SHORT_LIQUIDATION: 'Short Liquidation',
  LONG_CROWDING: 'Long Crowding',
  SHORT_CROWDING: 'Short Crowding',
  PRICE_SPIKE_UP: 'Price Spike Up',
  PRICE_SPIKE_DOWN: 'Price Spike Down',
};

/**
 * Groups signal types by what they imply about spot-vs-leverage demand, used
 * only for a small accent color on the signal-type chip — never for scoring.
 */
export type SignalTone = 'caution' | 'confirming' | 'liquidation' | 'crowding' | 'shock';

export const SIGNAL_TYPE_TONE: Record<SignalType, SignalTone> = {
  LEVERAGED_RALLY: 'caution',
  SPOT_CONFIRMED_RALLY: 'confirming',
  SHORT_COVERING_POSSIBLE: 'caution',
  SELLING_ABSORPTION_POSSIBLE: 'confirming',
  BULLISH_SPOT_DIVERGENCE: 'confirming',
  LONG_LIQUIDATION: 'liquidation',
  SHORT_LIQUIDATION: 'liquidation',
  LONG_CROWDING: 'crowding',
  SHORT_CROWDING: 'crowding',
  PRICE_SPIKE_UP: 'shock',
  PRICE_SPIKE_DOWN: 'shock',
};

/**
 * The label, or a readable fallback for a type this build has never heard of.
 *
 * The web app and the worker deploy separately, so the worker can be
 * emitting a signal type minutes before Vercel has the build that knows
 * its name. Reading straight out of the map renders a blank chip in that
 * window — which looks like a bug in the signal rather than in the
 * deploy. Same rule as the optional fields in types.ts, applied to a
 * lookup instead of a field.
 */
export function signalTypeLabel(signalType: string): string {
  return SIGNAL_TYPE_LABEL[signalType as SignalType] ?? signalType.replace(/_/g, ' ');
}

export const SIGNAL_TONE_DOT: Record<SignalTone, string> = {
  caution: 'bg-orange-400',
  confirming: 'bg-emerald-400',
  liquidation: 'bg-red-400',
  crowding: 'bg-violet-400',
  shock: 'bg-amber-400',
};
