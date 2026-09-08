import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every command the bot answers should appear in Telegram's own menu.
 *
 * /baseline shipped without it: the handler worked when typed, which is
 * exactly what makes the gap invisible — the command simply did not exist
 * for anyone navigating by the Menu button, and nothing failed to say so.
 *
 * Read from the source rather than from an exported list, because the gap
 * is between two places in that file and a shared constant would remove
 * the thing being checked.
 */
const source = readFileSync(join(__dirname, 'main.ts'), 'utf8');

/** Symbol commands (/btc, /eth …) are generated from the API's symbol list, so they cannot be listed statically. */
const GENERATED_FROM_SYMBOLS = true;

function handledCommands(): string[] {
  return [...source.matchAll(/bot\.command\('([a-z0-9_]+)'/g)].map((m) => m[1] as string);
}

function menuCommands(): string[] {
  const start = source.indexOf('setMyCommands([');
  const end = source.indexOf('])', start);
  return [...source.slice(start, end).matchAll(/command: '([a-z0-9_]+)'/g)].map((m) => m[1] as string);
}

/** Registered for discoverability elsewhere, deliberately absent from the menu. */
const EXEMPT = new Set([
  // /start is Telegram's own entry point; it is never listed by bots.
  'start',
]);

describe('command menu', () => {
  it('finds the commands to compare, so a rename cannot make this vacuous', () => {
    expect(handledCommands().length).toBeGreaterThan(10);
    expect(menuCommands().length).toBeGreaterThan(10);
    expect(GENERATED_FROM_SYMBOLS).toBe(true);
  });

  it('lists every command the bot answers', () => {
    const menu = new Set(menuCommands());
    const missing = handledCommands().filter((c) => !menu.has(c) && !EXEMPT.has(c));
    expect(missing, `handled but not in the Telegram menu: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not advertise a command nothing answers', () => {
    const handled = new Set(handledCommands());
    // Symbol commands are added dynamically from the API list, so only the
    // statically written entries can be checked against handlers.
    const dynamic = new Set(['btc', 'eth', 'sol', 'hype']);
    const orphaned = menuCommands().filter((c) => !handled.has(c) && !dynamic.has(c));
    expect(orphaned, `in the menu but unhandled: ${orphaned.join(', ')}`).toEqual([]);
  });
});
