import type { HealthStatus } from './types';

/**
 * Spec §2 health bands, used consistently everywhere a health score is
 * color-coded. Color is UI-only (API_CONTRACT.md "Notes for the web app")
 * — this file never feeds a value back into logic, only Tailwind classes.
 */
export const HEALTH_BAND_LABEL: Record<HealthStatus, string> = {
  VERY_HEALTHY: 'Very Healthy',
  HEALTHY: 'Healthy',
  NEUTRAL: 'Neutral',
  WEAK: 'Weak',
  VERY_WEAK: 'Very Weak',
};

export const HEALTH_BAND_RANGE: Record<HealthStatus, string> = {
  VERY_HEALTHY: '80–100',
  HEALTHY: '65–79',
  NEUTRAL: '50–64',
  WEAK: '35–49',
  VERY_WEAK: '0–34',
};

interface HealthColorSet {
  text: string;
  bg: string;
  border: string;
  dot: string;
  bar: string;
}

export const HEALTH_COLORS: Record<HealthStatus, HealthColorSet> = {
  VERY_HEALTHY: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
    bar: 'bg-emerald-500',
  },
  HEALTHY: {
    text: 'text-teal-400',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
    dot: 'bg-teal-400',
    bar: 'bg-teal-500',
  },
  NEUTRAL: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
    bar: 'bg-amber-500',
  },
  WEAK: {
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    dot: 'bg-orange-400',
    bar: 'bg-orange-500',
  },
  VERY_WEAK: {
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    dot: 'bg-rose-400',
    bar: 'bg-rose-500',
  },
};

/** Hex equivalents of the palette above, for lightweight-charts series (no Tailwind there). */
export const HEALTH_HEX: Record<HealthStatus, string> = {
  VERY_HEALTHY: '#34d399',
  HEALTHY: '#2dd4bf',
  NEUTRAL: '#fbbf24',
  WEAK: '#fb923c',
  VERY_WEAK: '#fb7185',
};

export function healthStatusFromScore(score: number): HealthStatus {
  if (score >= 80) return 'VERY_HEALTHY';
  if (score >= 65) return 'HEALTHY';
  if (score >= 50) return 'NEUTRAL';
  if (score >= 35) return 'WEAK';
  return 'VERY_WEAK';
}

/** Generic 0-100 score color ramp for the Risk score, which has no named bands in the spec. */
export function riskColorClass(score: number): HealthColorSet {
  // Risk is inverted in spirit (higher = more leverage risk) but reuses the
  // same 5-step ramp, just mirrored, so it reads consistently on screen.
  if (score >= 80) return HEALTH_COLORS.VERY_WEAK;
  if (score >= 65) return HEALTH_COLORS.WEAK;
  if (score >= 50) return HEALTH_COLORS.NEUTRAL;
  if (score >= 35) return HEALTH_COLORS.HEALTHY;
  return HEALTH_COLORS.VERY_HEALTHY;
}
