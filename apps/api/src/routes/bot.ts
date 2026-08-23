import type { FastifyInstance } from 'fastify';
import { getBotSettings, setAlertsEnabled, upsertBotUser } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

interface RegisterBody {
  chatId: string;
  username?: string;
}

interface SettingsBody {
  alertsEnabled: boolean;
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

  app.post<{ Params: { chatId: string }; Body: SettingsBody }>('/api/bot/settings/:chatId', async (req, reply) => {
    const settings = await getBotSettings(deps.pool, req.params.chatId);
    if (!settings) return reply.code(404).send({ error: 'unknown chat, call /api/bot/register first' });
    await setAlertsEnabled(deps.pool, req.params.chatId, req.body.alertsEnabled);
    return { settings: { ...settings, alertsEnabled: req.body.alertsEnabled } };
  });
}
