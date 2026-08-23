import type { Thresholds } from '@crypto-signal/shared';

export type VolumeAnomalyLevel = 'normal' | 'elevated' | 'abnormal' | 'extreme';

export function rollingAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** current_volume / average_volume (spec §12). */
export function computeVolumeRatio(currentVolume: number, averageVolume: number): number {
  if (averageVolume <= 0) return 1;
  return currentVolume / averageVolume;
}

/** Thresholds default to the exact example numbers given in spec §12 (1.5x/2x/3x). */
export function classifyVolumeAnomaly(ratio: number, thresholds: Thresholds): VolumeAnomalyLevel {
  if (ratio >= thresholds.volumeExtremeMult) return 'extreme';
  if (ratio >= thresholds.volumeAbnormalMult) return 'abnormal';
  if (ratio >= thresholds.volumeElevatedMult) return 'elevated';
  return 'normal';
}
