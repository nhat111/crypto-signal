import type { FastifyInstance } from 'fastify';
import { getBotSettings, updateBotSettings, upsertBotUser, type BotSettingsPatch } from '@crypto-signal/db';
import { ACCOUNT_USD_MIN, RISK_PCT_MAX, RISK_PCT_MIN } from '@crypto-signal/shared';
import type { ApiDeps } from '../deps.js';

interface RegisterBody {
  chatId: string;
  username?: string;
}

/**
 * The settings body, checked field by field. Every field is optional, but
 * at least one must be present: an empty body used to write
 * `alerts_enabled = undefined` and answer as if it had changed something.
 */
export function parseSettingsBody(body: unknown): { ok: true; patch: BotSettingsPatch } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const patch: BotSettingsPatch = {};

  if ('alertsEnabled' in b) {
    if (typeof b.alertsEnabled !== 'boolean') return { ok: false, error: 'alertsEnabled must be a boolean' };
    patch.alertsEnabled = b.alertsEnabled;
  }
  if ('accountUsd' in b) {
    if (b.accountUsd === null) patch.accountUsd = null;
    else if (typeof b.accountUsd === 'number' && Number.isFinite(b.accountUsd) && b.accountUsd >= ACCOUNT_USD_MIN) {
      patch.accountUsd = b.accountUsd;
    } else return { ok: false, error: `accountUsd must be null or a number of at least ${ACCOUNT_USD_MIN}` };
  }
  if ('riskPct' in b) {
    if (typeof b.riskPct === 'number' && Number.isFinite(b.riskPct) && b.riskPct >= RISK_PCT_MIN && b.riskPct <= RISK_PCT_MAX) {
      patch.riskPct = b.riskPct;
    } else return { ok: false, error: `riskPct must be a number from ${RISK_PCT_MIN} to ${RISK_PCT_MAX}` };
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'nothing to update: send alertsEnabled, accountUsd or riskPct' };
  return { ok: true, patch };
}

/**
 * Telegram bot writes go through here, never straight to Postgres — same
 * rule as the web dashboard (rule 8, "Telegram và Web dùng chung API/domain
 * layer", rule 9 "Không duplicate business logic").
 */
export function registerBotRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<{ Body: RegisterBody }>('/api/bot/register', async (req, reply) => {
    const { chatId, username } = req.body;
    if (!chatId) return reply.code(400).send({ error: 'chatId is required' });
    await upsertBotUser(deps.pool, chatId, username);
    const settings = await getBotSettings(deps.pool, chatId);
    return { settings };
  });

  app.get<{ Params: { chatId: string } }>('/api/bot/settings/:chatId', async (req, reply) => {
    const settings = await getBotSettings(deps.pool, req.params.chatId);
    if (!settings) return reply.code(404).send({ error: 'unknown chat, call /api/bot/register first' });
    return { settings };
  });

  app.post<{ Params: { chatId: string } }>('/api/bot/settings/:chatId', async (req, reply) => {
    const parsed = parseSettingsBody(req.body);
    // `=== false`, not `!parsed.ok`: Vercel builds this without strictNullChecks,
    // where truthiness does not narrow the union and the build fails.
    if (parsed.ok === false) return reply.code(400).send({ error: parsed.error });
    const settings = await updateBotSettings(deps.pool, req.params.chatId, parsed.patch);
    if (!settings) return reply.code(404).send({ error: 'unknown chat, call /api/bot/register first' });
    return { settings };
  });
}
