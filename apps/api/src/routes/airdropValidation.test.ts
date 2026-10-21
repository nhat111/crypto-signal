import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerAirdropRoutes } from './airdrops.js';
import type { ApiDeps } from '../deps.js';

/** Same approach as journalValidation: any database call means a bad value got through. */
function buildApp() {
  const query = vi.fn(async () => {
    throw new Error('the route reached the database with a value it should have refused');
  });
  const connect = vi.fn(async () => {
    throw new Error('the route reached the database with a value it should have refused');
  });
  const app = Fastify();
  registerAirdropRoutes(app, { pool: { query, connect }, config: { airdrop: { enabled: true } } } as unknown as ApiDeps);
  return { app, query };
}

describe('airdrop farm validation', () => {
  it.each([
    ['no name', { chatId: '1', costUsd: 1 }],
    ['a blank name', { chatId: '1', name: '   ', costUsd: 1 }],
    ['a negative cost', { chatId: '1', name: 'Symbiotic', costUsd: -1 }],
    ['a null cost (NaN after JSON)', { chatId: '1', name: 'Symbiotic', costUsd: null }],
    ['a cost sent as text', { chatId: '1', name: 'Symbiotic', costUsd: '2' }],
    ['no chat', { name: 'Symbiotic', costUsd: 1 }],
  ])('refuses a log with %s', async (_label, payload) => {
    const { app, query } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/airdrops/farms/log', payload });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an unknown status and a negative reward', async () => {
    const { app, query } = buildApp();
    const bad = await app.inject({ method: 'PATCH', url: '/api/airdrops/farms/1', payload: { status: 'won' } });
    expect(bad.statusCode).toBe(400);
    const neg = await app.inject({ method: 'PATCH', url: '/api/airdrops/farms/1', payload: { rewardUsd: -5 } });
    expect(neg.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a note longer than the limit', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/airdrops/farms',
      payload: { chatId: '1', name: 'Symbiotic', note: 'x'.repeat(501) },
    });
    expect(res.statusCode).toBe(400);
  });
});
