import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerJournalRoutes } from './journal.js';
import type { ApiDeps } from '../deps.js';

/**
 * The route's own guard, exercised without a database.
 *
 * The pool is only reached once validation passes, so every rejection here
 * is proven by the fact that it never got that far — a query call would
 * throw against this stub.
 */
function buildApp() {
  const query = vi.fn(async () => {
    throw new Error('the route reached the database with a value it should have refused');
  });
  const app = Fastify();
  registerJournalRoutes(app, { pool: { query } } as unknown as ApiDeps);
  return { app, query };
}

describe('POST /api/journal price validation', () => {
  const base = { chatId: '1', symbol: 'DINGER', side: 'spot' as const };

  it('refuses an entry price of zero — Number("") on a blank field', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, entryPrice: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/greater than zero/);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a null entry price, which is what JSON.stringify makes of NaN', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, entryPrice: null } });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a negative entry price', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, entryPrice: -0.004 } });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a zero size while accepting an omitted one', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, entryPrice: 0.004, size: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/size/);
  });
});

describe('PATCH /api/journal/:id price validation', () => {
  it('refuses an exit price of zero, which would book a total loss', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/journal/abc', payload: { exitPrice: 0 } });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a non-finite exit price', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/journal/abc', payload: { exitPrice: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('lets a null exit price through — that reopens the trade, it is not a price', async () => {
    const { app, query } = buildApp();
    // Reaching the database is the pass condition here: the stub throws, so
    // a 500 proves validation allowed it past rather than rejecting it.
    const res = await app.inject({ method: 'PATCH', url: '/api/journal/abc', payload: { exitPrice: null } });
    expect(res.statusCode).toBe(500);
    expect(query).toHaveBeenCalled();
  });

  it('lets a real exit price through to the database', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/journal/abc', payload: { exitPrice: 0.004256 } });
    expect(res.statusCode).toBe(500);
    expect(query).toHaveBeenCalled();
  });
});

describe('source and thesis validation', () => {
  const base = { chatId: '1', symbol: 'DINGER', side: 'spot' as const, entryPrice: 0.004 };

  it('refuses a source long enough to be a pasted thread rather than a name', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, source: 'x'.repeat(81) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/source/);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a thesis that is not text', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, thesis: 42 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/thesis/);
    expect(query).not.toHaveBeenCalled();
  });

  it('checks the same bounds on a patch', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/journal/7', payload: { thesis: 'y'.repeat(2001) } });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('stop validation', () => {
  const base = { chatId: '1', symbol: 'SOLUSDT', entryPrice: 150 };

  it('refuses a stop above the entry of a long or spot trade', async () => {
    const { app, query } = buildApp();
    for (const side of ['spot', 'long'] as const) {
      const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, side, stopPrice: 160 } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/below entryPrice/);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a stop under the entry of a short, and a stop of zero', async () => {
    const { app, query } = buildApp();
    const short = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, side: 'short', stopPrice: 140 } });
    expect(short.json().error).toMatch(/above entryPrice/);
    const zero = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, side: 'spot', stopPrice: 0 } });
    expect(zero.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('lets a stop on the losing side through to the database', async () => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/journal', payload: { ...base, side: 'spot', stopPrice: 140 } });
    expect(res.statusCode).toBe(500);
    expect(query).toHaveBeenCalled();
  });

  it('checks a patched stop against the stored trade', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 7, chat_id: '1', symbol: 'SOLUSDT', side: 'long', entry_price: 150, exit_price: null, size: null, pnl_pct: null, pnl_usd: null, status: 'open', note: null, source: null, thesis: null, stop_price: null, r_multiple: null, opened_at_ms: 0, closed_at_ms: null }],
    }));
    const app = Fastify();
    registerJournalRoutes(app, { pool: { query } } as unknown as ApiDeps);
    const res = await app.inject({ method: 'PATCH', url: '/api/journal/7', payload: { stopPrice: 155 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/below entryPrice/);
    // Only the read of the existing trade, no write.
    expect(query).toHaveBeenCalledTimes(1);
  });
});
