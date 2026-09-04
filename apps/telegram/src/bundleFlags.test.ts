import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The bundler flag that keeps the Telegram bot alive in production.
 *
 * Telegraf long-polls through node-fetch, which decides whether an abort
 * signal is real by comparing `signal.constructor.name` against the string
 * "AbortSignal". Something in the bundled graph references the global
 * AbortSignal, so esbuild renames the `abort-controller` polyfill's class
 * to AbortSignal2 rather than let it shadow the global. The name check
 * then fails and every getUpdates call throws
 * `TypeError: Expected signal to be an instanceof AbortSignal` before it
 * ever reaches the network — the service crash-loops at launch.
 *
 * Nothing else catches this. `tsx` does not bundle, so local dev, the test
 * suite and `npm run build` are all green while production is dead, and
 * the only symptom is a bot that stops answering: the worker keeps pushing
 * alerts through plain fetch, so from the outside most of the system looks
 * fine. It took a crash log to find, and it would cost the same again.
 *
 * `--keep-names` restores the original name. This asserts nobody tidies it
 * away, on every bundle rather than only the one that broke — the others
 * are one dependency away from the same trap.
 */
const DOCKERFILES = ['Dockerfile.telegram', 'Dockerfile.worker', 'Dockerfile.api'];

function esbuildCommands(dockerfile: string): string[] {
  return readFileSync(dockerfile, 'utf8')
    .split('\n')
    .filter((line) => line.includes('esbuild') && line.includes('--bundle'));
}

describe('production bundles', () => {
  it.each(DOCKERFILES)('%s builds every bundle with --keep-names', (dockerfile) => {
    const commands = esbuildCommands(dockerfile);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command, `${dockerfile}: ${command}`).toContain('--keep-names');
    }
  });

  it('still needs the flag, because node-fetch still identifies signals by name', () => {
    // If this ever fails, the hazard is gone rather than the guard being
    // wrong — re-read the block above before deleting anything. Keeping a
    // flag nobody can justify is how the next person removes it.
    const nodeFetch = readFileSync('node_modules/node-fetch/lib/index.js', 'utf8');
    expect(nodeFetch).toContain("constructor.name === 'AbortSignal'");
  });

  it('is reachable at all — telegraf still polls with the polyfilled controller', () => {
    // The signal only reaches node-fetch because Polling hands its
    // AbortController to callApi. If telegraf stops doing that, this whole
    // failure mode disappears with it.
    const polling = readFileSync('node_modules/telegraf/lib/core/network/polling.js', 'utf8');
    expect(polling).toContain("require(\"abort-controller\")");
    expect(polling).toContain('this.abortController');
  });
});
