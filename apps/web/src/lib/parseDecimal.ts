/**
 * Reading a number out of a text field, on a keyboard we do not control.
 *
 * `<input type="number">` looks like the right tool and is a trap. Chromium
 * does not reject a decimal comma — it DELETES it: typing "0,004256" leaves
 * `el.value === "0004256"`, with `validity.badInput === false`, so nothing
 * downstream can tell that the number it received is a thousand times the
 * one the person typed. On an iOS keypad set to Vietnamese the comma is the
 * ONLY separator offered, so this is not an edge case here, it is the
 * default path: a $0.004256 exit was submitted as $4256 and booked as a
 * six-figure percentage gain.
 *
 * So the fields are `type="text" inputMode="decimal"` — the same keypad, but
 * the browser keeps what was typed — and every one of them comes through
 * here.
 *
 * Comma means decimal point. That is the only reading available on that
 * keypad, and a thousands separator typed by hand into a price field is not
 * a thing people do. It stays checkable rather than assumed: the fields
 * echo the parsed value back, so "1,234" showing as "1.234" is visible
 * before it is saved.
 */

/**
 * Scientific notation is accepted because we produce it ourselves: a token
 * priced at 4.17e-9 round-trips through `String(price)` into the edit form,
 * and a parser that rejected it would make small-cap trades uneditable.
 */
const NUMERIC = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * `null` for anything that is not one unambiguous number — empty, a stray
 * letter, two separators ("1.2.3"), Infinity. Never NaN and never a silent
 * 0, both of which `Number()` hands back for input a person would call
 * blank or broken.
 */
export function parseDecimalInput(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, '.');
  if (normalized === '') return null;
  if (!NUMERIC.test(normalized)) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** A price must be a positive number: zero is not a price anyone traded at, and a negative one is a typo. */
export function parsePriceInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  return value !== null && value > 0 ? value : null;
}

/** A size may be zero-free but is otherwise the same rule; kept separate so the intent reads at the call site. */
export function parseSizeInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  return value !== null && value > 0 ? value : null;
}

/**
 * What the field should show back to the user, or null when there is
 * nothing worth echoing — a blank field, or a value they typed exactly as
 * we would print it, where an echo is noise.
 */
export function decimalEcho(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = parseDecimalInput(trimmed);
  if (value === null) return null;
  const printed = String(value);
  return printed === trimmed ? null : printed;
}
