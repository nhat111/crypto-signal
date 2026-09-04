#!/usr/bin/env node
/**
 * Builds the production bundles and boots one of them.
 *
 * Nothing else in this repo does. `tsx` does not bundle, so dev, the test
 * suite and `npm run build` were all green for a day while the Telegram
 * service crash-looped in production on `TypeError: Expected signal to be
 * an instanceof AbortSignal` — esbuild had renamed a class that node-fetch
 * identifies by string name. The only surface that showed it was a Railway
 * crash log nobody was watching, and the visible symptom was a bot that
 * quietly stopped answering while everything else looked healthy.
 *
 * Two things are checked, in order of what they cost to find later:
 *
 * 1. Every bundle builds and parses. Catches a dependency that cannot be
 *    inlined, a resolution failure, a syntax level the runtime rejects.
 *
 * 2. The Telegram bundle actually reaches `bot.launch()` without throwing
 *    a TypeError or ReferenceError. That is the exact shape of a
 *    bundler-induced break: a name that exists under tsx and is gone after
 *    bundling. A failed Telegram API call is fine and expected — the token
 *    is fake — so only error *types* the network cannot cause are failures.
 *
 * The esbuild commands are read out of the Dockerfiles rather than copied
 * here. A smoke test that builds something other than what ships proves
 * nothing about what ships.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DOCKERFILES = ['Dockerfile.api', 'Dockerfile.worker', 'Dockerfile.telegram'];
/**
 * What a bundler-induced break looks like, as opposed to a network one.
 *
 * "TypeError" alone is not enough: undici reports a refused connection as
 * `TypeError: fetch failed`, so a broad match fires in any environment
 * without the API up — which is most of them.
 *
 * The distinction that actually holds is *when* the failure happens. The
 * bug this exists for throws while the request is being constructed, before
 * a socket is opened. So anything that came back from Telegram at all —
 * a 401 for the fake token, a proxy rejection, malformed JSON — proves the
 * risky path ran to completion and the bundle is fine. What must never
 * appear is a TypeError that is not a failed fetch, or a name that does
 * not exist, neither of which a socket can produce.
 */
const NOT_A_NETWORK_TYPE_ERROR = /TypeError: (?!fetch failed)/;
const MISSING_NAME = /\b(ReferenceError|SyntaxError)\b/;
/** How many long-poll round trips must complete before the bundle is trusted. */
const REQUIRED_POLLS = 2;
/** Long enough for five API retries plus a real round trip to Telegram. */
const LAUNCH_TIMEOUT_MS = 60_000;

function bundlerFailure(output) {
  if (MISSING_NAME.test(output)) return 'a name that does not exist after bundling';
  if (NOT_A_NETWORK_TYPE_ERROR.test(output)) return 'a TypeError no socket can cause';
  return null;
}

const outDir = mkdtempSync(join(tmpdir(), 'bundle-smoke-'));

function esbuildCommands(dockerfile) {
  return readFileSync(dockerfile, 'utf8')
    .split('\n')
    .filter((line) => line.includes('esbuild') && line.includes('--bundle'))
    .map((line) => line.replace(/^RUN\s+npx\s+/, '').trim());
}

function build(dockerfile) {
  const service = dockerfile.replace('Dockerfile.', '');
  const commands = esbuildCommands(dockerfile);
  if (commands.length === 0) {
    console.error(`✗ ${dockerfile}: no esbuild command found — has the build moved?`);
    process.exit(1);
  }
  const outputs = [];
  for (const command of commands) {
    // Redirect the artifact into a temp dir; /out only exists inside Docker.
    const args = command.split(/\s+/).slice(1).map((arg) =>
      // All three Dockerfiles emit app.cjs; without the prefix they would
      // overwrite each other and only the last one would really be checked.
      arg.startsWith('--outfile=') ? `--outfile=${join(outDir, `${service}-${basename(arg)}`)}` : arg,
    );
    const outfile = args.find((a) => a.startsWith('--outfile=')).slice('--outfile='.length);
    execFileSync('npx', ['esbuild', ...args], { stdio: 'inherit' });
    execFileSync('node', ['--check', outfile], { stdio: 'inherit' });
    console.log(`✓ bundled + parsed  ${dockerfile} → ${basename(outfile)}`);
    outputs.push(outfile);
  }
  return outputs;
}

const bundles = Object.fromEntries(DOCKERFILES.map((d) => [d, build(d)]));
const telegramBundle = bundles['Dockerfile.telegram'][0];

/**
 * Stand-ins for the two services the bot talks to at boot.
 *
 * The API stub stops the symbol fetch retrying, so the boot reaches
 * launch instead of spending its life in backoff. The Telegram stub is the
 * one that matters: the bug this script exists for throws inside the
 * *polling* loop, which is only reached after getMe succeeds. Pointing at
 * the real api.telegram.org with a fake token dies one call earlier, and a
 * smoke test that stops before the failing line proves nothing — the first
 * version of this script passed happily with the bug reintroduced.
 */
const apiStub = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ symbols: ['BTCUSDT'], timeframes: ['15m'], rows: [] }));
});
await new Promise((resolve) => apiStub.listen(0, '127.0.0.1', resolve));

let getUpdatesCalls = 0;
const telegramStub = createServer((req, res) => {
  const method = req.url.split('/').pop();
  if (method === 'getUpdates') getUpdatesCalls += 1;
  const result =
    method === 'getMe'
      ? { id: 1, is_bot: true, first_name: 'smoke', username: 'smoke_bot' }
      : method === 'getUpdates'
        ? []
        : true;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, result }));
});
await new Promise((resolve) => telegramStub.listen(0, '127.0.0.1', resolve));

const child = spawn('node', [telegramBundle], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    TELEGRAM_BOT_TOKEN: '1:smoke-test-not-a-real-token',
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${apiStub.address().port}`,
    TELEGRAM_API_ROOT: `http://127.0.0.1:${telegramStub.address().port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

// Two polls, not one: the first proves the loop was entered, the second
// that it survived a round trip and came back for more.
await new Promise((resolve) => {
  const timer = setTimeout(resolve, LAUNCH_TIMEOUT_MS);
  const poll = setInterval(() => {
    if (getUpdatesCalls >= 2) {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    }
  }, 200);
  child.on('exit', () => {
    clearTimeout(timer);
    clearInterval(poll);
    setTimeout(resolve, 250);
  });
});

child.kill('SIGKILL');
apiStub.close();
telegramStub.close();

const failure = bundlerFailure(output);
if (failure !== null) {
  console.error(`\n✗ the bundled Telegram service failed in a way the network cannot explain: ${failure}\n`);
  console.error(
    output
      .split('\n')
      .filter((l) => NOT_A_NETWORK_TYPE_ERROR.test(l) || MISSING_NAME.test(l))
      .slice(0, 5)
      .join('\n'),
  );
  console.error('\nThat is what a renamed or missing symbol looks like after bundling.');
  process.exit(1);
}

if (getUpdatesCalls < REQUIRED_POLLS) {
  console.error(
    `\n✗ the bundled Telegram service polled ${getUpdatesCalls}/${REQUIRED_POLLS} times — it never got through the loop, so this proved nothing.`,
  );
  console.error(output.split('\n').slice(-15).join('\n'));
  process.exit(1);
}

console.log(`✓ telegram bundle launched and long-polled ${getUpdatesCalls}× — the abort signal survives bundling`);
console.log('\nAll production bundles build, parse, and boot.');
