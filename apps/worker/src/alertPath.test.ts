import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TelegramNotifier } from './telegramNotifier.js';
import { runAlertSelfTest } from './alertSelfTest.js';

/**
 * The alert path, over real HTTP, against a stand-in Telegram.
 *
 * This is the half of the system that wakes somebody at three in the
 * morning, and until `apiRoot` was configurable it could only be exercised
 * by monkey-patching global `fetch` — which proves the code calls *a*
 * function, not that it speaks HTTP correctly. A real socket covers the
 * request shape, the JSON body, the status handling and the error text
 * Telegram actually returns, which is the part an operator reads when it
 * breaks.
 *
 * Everything here is local; nothing reaches the internet.
 */
describe('the alert path over real HTTP', () => {
  let server: Server;
  let apiRoot: string;
  const received: { path: string; body: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        received.push({ path: req.url ?? '', body });
        res.setHeader('content-type', 'application/json');

        // Telegram's real replies for the two ways a chat id goes wrong.
        if (body.chat_id === 'BAD_ID') {
          res.writeHead(400);
          return res.end('{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}');
        }
        if (body.chat_id === 'BLOCKED') {
          res.writeHead(403);
          return res.end('{"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}');
        }
        res.writeHead(200);
        res.end('{"ok":true,"result":{"message_id":1}}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

  it('sends one HTML message per chat, to the Bot API path', async () => {
    received.length = 0;
    const notifier = new TelegramNotifier('123456:TEST', logger, apiRoot);
    await runAlertSelfTest({ notifier, logger, chatIds: ['111', '222'] });

    expect(received).toHaveLength(2);
    expect(received[0]!.path).toBe('/bot123456:TEST/sendMessage');
    expect(received[0]!.body.parse_mode).toBe('HTML');
    expect(received.map((r) => r.body.chat_id)).toEqual(['111', '222']);
    // The text a person will actually read, not a placeholder.
    expect(String(received[0]!.body.text)).toContain('Kiểm tra cảnh báo');
  });

  it('reports per chat which ones landed, in Telegram’s own words', async () => {
    // The failure this whole self-test exists for: a mistyped id counts on
    // /status exactly like a working one, because a failed send is
    // swallowed so a bad recipient cannot take the collector down. Only a
    // per-chat result separates them.
    const notifier = new TelegramNotifier('123456:TEST', logger, apiRoot);
    const result = await runAlertSelfTest({ notifier, logger, chatIds: ['111', 'BAD_ID', 'BLOCKED'] });

    expect(result.attempted).toBe(3);
    expect(result.delivered).toEqual(['111']);
    expect(result.failed.map((f) => f.chatId)).toEqual(['BAD_ID', 'BLOCKED']);
    expect(result.failed[0]!.reason).toContain('chat not found');
    expect(result.failed[1]!.reason).toContain('blocked by the user');
  });

  it('does not report a send as landed when nothing is listening', async () => {
    // A dead endpoint must not read as success — that is the exact shape of
    // wrong this feature exists to eliminate.
    const notifier = new TelegramNotifier('123456:TEST', logger, 'http://127.0.0.1:1');
    const result = await runAlertSelfTest({ notifier, logger, chatIds: ['111'] });
    expect(result.delivered).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason.length).toBeGreaterThan(0);
  });

  it('distinguishes "nothing configured" from "everything failed"', async () => {
    // Different diagnosis, different fix: one is an unset variable, the
    // other is a wrong value.
    const notifier = new TelegramNotifier('123456:TEST', logger, apiRoot);
    const result = await runAlertSelfTest({ notifier, logger, chatIds: [] });
    expect(result).toEqual({ attempted: 0, delivered: [], failed: [] });
  });

  it('refuses to send at all without a bot token', async () => {
    const notifier = new TelegramNotifier('', logger, apiRoot);
    const result = await runAlertSelfTest({ notifier, logger, chatIds: ['111'] });
    expect(result.delivered).toEqual([]);
    expect(result.failed[0]!.reason).toContain('no bot token');
  });

  it('defaults to the real Bot API when no root is given', async () => {
    // The override is for tests; production must not depend on it being set.
    const notifier = new TelegramNotifier('t', logger);
    expect(String((notifier as unknown as { apiRoot: string }).apiRoot)).toBe('https://api.telegram.org');
  });
});
