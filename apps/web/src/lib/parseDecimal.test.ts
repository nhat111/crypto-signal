import { describe, expect, it } from 'vitest';
import { decimalEcho, parseDecimalInput, parsePriceInput, parseSizeInput } from './parseDecimal';

describe('parseDecimalInput', () => {
  it('reads a decimal comma as the decimal point', () => {
    // The bug this whole module exists for: an iOS keypad in a Vietnamese
    // locale offers a comma and nothing else.
    expect(parseDecimalInput('0,004256')).toBe(0.004256);
  });

  it('still reads a decimal point', () => {
    expect(parseDecimalInput('0.004256')).toBe(0.004256);
  });

  it('does not turn a comma into a thousands separator', () => {
    // "0,004256" as grouping would be 4256 — the exact corruption that
    // <input type="number"> produced by dropping the comma.
    expect(parseDecimalInput('0,004256')).not.toBe(4256);
  });

  it('rejects a blank field rather than calling it zero', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('   ')).toBeNull();
  });

  it('rejects two separators, which have no single reading', () => {
    expect(parseDecimalInput('1.2.3')).toBeNull();
    expect(parseDecimalInput('1,2,3')).toBeNull();
    expect(parseDecimalInput('1.2,3')).toBeNull();
  });

  it('rejects text that Number() would silently accept', () => {
    expect(parseDecimalInput('Infinity')).toBeNull();
    expect(parseDecimalInput('0x10')).toBeNull();
    expect(parseDecimalInput('1 2')).toBeNull();
    expect(parseDecimalInput('abc')).toBeNull();
  });

  it('rejects a number too large to be finite', () => {
    // "Infinity" as text never reaches the finite check — the shape rule
    // rejects it first. These do reach it: both are well-formed digits that
    // Number() overflows to Infinity, and an Infinity price would poison
    // every P&L it touched.
    expect(parseDecimalInput('1e999')).toBeNull();
    expect(parseDecimalInput('9'.repeat(400))).toBeNull();
  });

  it('accepts the scientific notation we generate ourselves', () => {
    // String(4.17e-9) is what lands in the edit form for a small-cap token.
    expect(parseDecimalInput(String(4.17e-9))).toBe(4.17e-9);
    expect(parseDecimalInput('1E+3')).toBe(1000);
  });

  it('accepts the shapes a keypad produces mid-typing', () => {
    expect(parseDecimalInput('0,')).toBe(0);
    expect(parseDecimalInput(',5')).toBe(0.5);
    expect(parseDecimalInput('.5')).toBe(0.5);
  });

  it('trims surrounding whitespace from a paste', () => {
    expect(parseDecimalInput('  0,0042  ')).toBe(0.0042);
  });
});

describe('parsePriceInput', () => {
  it('refuses zero and negatives — neither is a price anyone traded at', () => {
    expect(parsePriceInput('0')).toBeNull();
    expect(parsePriceInput('0,0')).toBeNull();
    expect(parsePriceInput('-1,5')).toBeNull();
  });

  it('accepts a real small-cap price', () => {
    expect(parsePriceInput('0,004256')).toBe(0.004256);
  });

  it('refuses the blank that Number() reads as zero', () => {
    expect(parsePriceInput('')).toBeNull();
  });
});

describe('parseSizeInput', () => {
  it('refuses zero and negatives', () => {
    expect(parseSizeInput('0')).toBeNull();
    expect(parseSizeInput('-2')).toBeNull();
  });

  it('accepts a fractional size typed with a comma', () => {
    expect(parseSizeInput('0,1')).toBe(0.1);
  });
});

describe('decimalEcho', () => {
  it('echoes the reading when it differs from what was typed', () => {
    expect(decimalEcho('0,004256')).toBe('0.004256');
  });

  it('stays quiet when the typing already reads as we would print it', () => {
    expect(decimalEcho('0.004256')).toBeNull();
    expect(decimalEcho('')).toBeNull();
  });

  it('stays quiet on input it cannot read, leaving the error to the caller', () => {
    expect(decimalEcho('abc')).toBeNull();
    expect(decimalEcho('1.2.3')).toBeNull();
  });

  it('makes an ambiguous grouping visible instead of hiding it', () => {
    // Someone who meant one thousand two hundred and thirty four sees
    // "1.234" under the field and can correct it before saving.
    expect(decimalEcho('1,234')).toBe('1.234');
  });
});
