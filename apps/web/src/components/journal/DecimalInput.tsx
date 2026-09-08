'use client';

import { useState } from 'react';
import { decimalEcho, parseDecimalInput } from '@/lib/parseDecimal';
import { cx } from '@/lib/format';

/**
 * The only numeric field in the journal.
 *
 * `type="number"` is deliberately not used: Chromium silently deletes a
 * decimal comma rather than rejecting it, turning "0,004256" into 4256 with
 * `validity.badInput` still false — see lib/parseDecimal.ts. `type="text"`
 * with `inputMode="decimal"` raises the same keypad on a phone and keeps
 * what was typed, so the value can be read honestly.
 *
 * The echo below the field is the other half: a comma is read as a decimal
 * point, and rather than assume that is what someone meant, the field shows
 * the number it is about to save.
 *
 * Every number this component collects is a price or a size, so it enforces
 * "greater than zero" itself rather than taking a rule from each of its six
 * call sites. A field that legitimately accepts zero would need that made a
 * prop; none exists yet, and inventing the option now would only make the
 * current rule easier to get wrong.
 */
export function DecimalInput({
  value,
  onValueChange,
  className,
  ...rest
}: {
  value: string;
  onValueChange: (next: string) => void;
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}) {
  // Every small-cap price starts with "0", and a value is momentarily "0"
  // on the way to "0,004256". Complaining about it before the field is
  // finished means flashing an error at everyone who types a real price, so
  // the not-positive message waits for blur. Text that is not a number at
  // all cannot be a prefix of one, so that one shows immediately.
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const parsed = trimmed === '' ? null : parseDecimalInput(trimmed);
  const unreadable = trimmed !== '' && parsed === null;
  const notPositive = touched && parsed !== null && parsed <= 0;
  const echo = decimalEcho(value);

  return (
    <div>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        // Chrome and Safari both offer to autofill a bare text input with a
        // saved card number when it sits next to something money-shaped.
        autoComplete="off"
        className={cx(className, (unreadable || notPositive) && 'border-rose-500/70')}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      {unreadable ? (
        <p className="mt-1 text-[11px] text-rose-400">Not a number I can read.</p>
      ) : notPositive ? (
        <p className="mt-1 text-[11px] text-rose-400">Must be greater than zero.</p>
      ) : echo !== null ? (
        <p className="mt-1 text-[11px] text-slate-500">= {echo}</p>
      ) : null}
    </div>
  );
}
