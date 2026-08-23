import { clamp } from '@crypto-signal/shared';
import { SEVERITY_ORDER, type Severity } from './types.js';

export function escalateSeverity(base: Severity, steps: number): Severity {
  const idx = SEVERITY_ORDER.indexOf(base);
  const next = clamp(idx + steps, 0, SEVERITY_ORDER.length - 1);
  return SEVERITY_ORDER[next] as Severity;
}

export function severityAtLeast(a: Severity, b: Severity): boolean {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b);
}
