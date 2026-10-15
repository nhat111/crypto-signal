import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { parseSettingsBody, registerBotRoutes } from './bot.js';
import type { ApiDeps } from '../deps.js';

describe('parseSettingsBody', () => {
  it('accepts the alerts toggle the bot already sends', () => {
    expect(parseSettingsBody({ alertsEnabled: false })).toEqual({ ok: true, patch: { alertsEnabled: false } });
  });

  it('accepts an account and risk, and null to clear the account', () => {
    expect(parseSettingsBody({ accountUsd: 1500, riskPct: 0.5 })).toEqual({ ok: true, patch: { accountUsd: 1500, riskPct: 0.5 } });
    expect(parseSettingsBody({ accountUsd: null })).toEqual({ ok: true, patch: { accountUsd: null } });
  });

  it('refuses a risk outside 0.1–5%', () => {
    expect(parseSettingsBody({ riskPct: 0 }).ok).toBe(false);
    expect(parseSettingsBody({ riskPct: 5.5 }).ok).toBe(false);
    expect(parseSettingsBody({ riskPct: '1' }).ok).toBe(false);
  });

  it('refuses an account under 10$ — "1.000" typed with a thousands dot reads as 1', () => {
    expect(parseSettingsBody({ accountUsd: 1 }).ok).toBe(false);
    expect(parseSettingsBody({ accountUsd: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('refuses an empty body instead of answering as if something changed', () => {
    expect(parseSettingsBody({}).ok).toBe(false);
    expect(parseSettingsBody(null).ok).toBe(false);
  });
});

describe('POST /api/bot/settings/:chatId', () => {
  it('never reaches the database with a refused body', async () => {
    const query = vi.fn(async () => {
      throw new Error('reached the database');
    });
    const app = Fastify();
    registerBotRoutes(app, { pool: { query } } as unknown as ApiDeps);
    const res = await app.inject({ method: 'POST', url: '/api/bot/settings/1', payload: { riskPct: 10 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/riskPct/);
    expect(query).not.toHaveBeenCalled();
  });
});
