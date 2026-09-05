import { describe, expect, it, vi } from 'vitest';
import { runAlertSelfTest } from './alertSelfTest.js';
import type { TelegramNotifier } from './telegramNotifier.js';

function deps(chatIds: string[], send: TelegramNotifier['send']) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    deps: { notifier: { send } as unknown as TelegramNotifier, logger: logger as never, chatIds },
    logger,
  };
}

describe('runAlertSelfTest', () => {
  it('reports which chats received it and which did not, by id', async () => {
    // "2 of 3 worked" does not tell the operator which id to fix.
    const send = vi.fn(async (chatId: string) =>
      chatId === 'bad' ? { ok: false, reason: 'HTTP 400: chat not found' } : { ok: true },
    );
    const { deps: d, logger } = deps(['good1', 'bad', 'good2'], send as never);

    const result = await runAlertSelfTest(d);

    expect(result.delivered).toEqual(['good1', 'good2']);
    expect(result.failed).toEqual([{ chatId: 'bad', reason: 'HTTP 400: chat not found' }]);
    expect(logger.error).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('says so plainly when every chat received it', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const { deps: d, logger } = deps(['a', 'b'], send as never);

    const result = await runAlertSelfTest(d);

    expect(result.failed).toEqual([]);
    expect(result.delivered).toEqual(['a', 'b']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it('distinguishes "nothing configured" from "everything failed"', async () => {
    // Same empty inbox, different fix: one is a missing variable, the
    // other is a wrong id.
    const send = vi.fn(async () => ({ ok: true }));
    const { deps: d, logger } = deps([], send as never);

    const result = await runAlertSelfTest(d);

    expect(result).toEqual({ attempted: 0, delivered: [], failed: [] });
    expect(send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('carries the reason through, because the reason is the whole diagnosis', async () => {
    // "chat not found" and "bot was blocked by the user" need different
    // actions from whoever is reading.
    const send = vi.fn(async () => ({ ok: false, reason: 'HTTP 403: bot was blocked by the user' }));
    const { deps: d } = deps(['x'], send as never);

    const result = await runAlertSelfTest(d);
    expect(result.failed[0]?.reason).toContain('blocked');
  });

  it('tries every chat even when an early one fails', async () => {
    const send = vi.fn(async (chatId: string) => (chatId === 'a' ? { ok: false, reason: 'nope' } : { ok: true }));
    const { deps: d } = deps(['a', 'b', 'c'], send as never);

    const result = await runAlertSelfTest(d);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.delivered).toEqual(['b', 'c']);
  });
});
