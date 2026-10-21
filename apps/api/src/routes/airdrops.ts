import type { FastifyInstance } from 'fastify';
import {
  FARM_NAME_MAX,
  FARM_TEXT_MAX,
  JOB_AIRDROP_SCAN,
  addFarmAction,
  deleteFarm,
  getFarms,
  getJobHealth,
  getLatestAirdropCandidates,
  isFarmStatus,
  logFarmAction,
  startFarm,
  updateFarm,
  type FarmStatus,
} from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * Airdrop research (ASSUMPTIONS.md §25): the worker's daily list of
 * tokenless protocols, and a hand-kept log of the projects a person farms.
 * Like the journal, every farm write is a person recording what they did;
 * nothing here is generated. The web has no login, so it sends its own
 * fixed chat id; Telegram sends the chat's.
 */

interface StartFarmBody {
  chatId?: unknown;
  name?: unknown;
  slug?: unknown;
  wallet?: unknown;
  note?: unknown;
}

interface LogFarmBody {
  chatId?: unknown;
  name?: unknown;
  costUsd?: unknown;
  note?: unknown;
}

interface ActionBody {
  costUsd?: unknown;
  note?: unknown;
}

interface UpdateFarmBody {
  status?: unknown;
  rewardUsd?: unknown;
  wallet?: unknown;
  note?: unknown;
}

/** Optional bounded text: undefined/null mean "not given", an empty string clears. */
function optionalText(value: unknown, field: string, max: number): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false, error: `${field} must be at most ${max} characters` };
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

function requiredName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= FARM_NAME_MAX ? trimmed : null;
}

/** A cost of 0 is a real answer (a free action); negative or non-finite is not. */
function invalidAmount(value: unknown, field: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${field} must be a number`;
  if (value < 0) return `${field} must not be negative`;
  return null;
}

export function registerAirdropRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: { limit?: string } }>('/api/airdrops', async (req) => {
    const limit = req.query.limit !== undefined ? Math.min(500, Math.max(1, Number(req.query.limit) || 200)) : 200;
    const [latest, health] = await Promise.all([
      getLatestAirdropCandidates(deps.pool, limit),
      getJobHealth(deps.pool, JOB_AIRDROP_SCAN),
    ]);
    return {
      enabled: deps.config.airdrop.enabled,
      day: latest.day,
      candidates: latest.candidates,
      fetch: health
        ? {
            lastAttemptAt: health.lastAttemptAt,
            lastSuccessAt: health.lastSuccessAt,
            consecutiveFailures: health.consecutiveFailures,
            lastError: health.lastError,
          }
        : null,
      serverTime: Date.now(),
    };
  });

  app.get<{ Querystring: { chatId?: string } }>('/api/airdrops/farms', async (req) => {
    return { farms: await getFarms(deps.pool, req.query.chatId), serverTime: Date.now() };
  });

  app.post<{ Body: StartFarmBody }>('/api/airdrops/farms', async (req, reply) => {
    const body = req.body ?? {};
    const name = requiredName(body.name);
    if (typeof body.chatId !== 'string' || body.chatId === '' || name === null) {
      return reply.code(400).send({ error: `chatId and name (1-${FARM_NAME_MAX} characters) are required` });
    }
    const slug = optionalText(body.slug, 'slug', FARM_NAME_MAX);
    const wallet = optionalText(body.wallet, 'wallet', FARM_NAME_MAX);
    const note = optionalText(body.note, 'note', FARM_TEXT_MAX);
    for (const r of [slug, wallet, note]) if (!r.ok) return reply.code(400).send({ error: r.error });
    const farm = await startFarm(deps.pool, {
      chatId: body.chatId,
      name,
      slug: slug.ok ? slug.value : null,
      wallet: wallet.ok ? wallet.value : null,
      note: note.ok ? note.value : null,
    });
    return { farm };
  });

  // The bot's one-message path: name the project, the farm starts on first use.
  app.post<{ Body: LogFarmBody }>('/api/airdrops/farms/log', async (req, reply) => {
    const body = req.body ?? {};
    const name = requiredName(body.name);
    if (typeof body.chatId !== 'string' || body.chatId === '' || name === null) {
      return reply.code(400).send({ error: `chatId and name (1-${FARM_NAME_MAX} characters) are required` });
    }
    const costProblem = invalidAmount(body.costUsd, 'costUsd');
    if (costProblem) return reply.code(400).send({ error: costProblem });
    const note = optionalText(body.note, 'note', FARM_TEXT_MAX);
    if (!note.ok) return reply.code(400).send({ error: note.error });
    const farm = await logFarmAction(deps.pool, { chatId: body.chatId, name, costUsd: body.costUsd as number, note: note.value ?? null });
    return { farm };
  });

  app.post<{ Params: { id: string }; Body: ActionBody }>('/api/airdrops/farms/:id/actions', async (req, reply) => {
    const body = req.body ?? {};
    const costProblem = invalidAmount(body.costUsd, 'costUsd');
    if (costProblem) return reply.code(400).send({ error: costProblem });
    const note = optionalText(body.note, 'note', FARM_TEXT_MAX);
    if (!note.ok) return reply.code(400).send({ error: note.error });
    const farm = await addFarmAction(deps.pool, req.params.id, body.costUsd as number, note.value ?? null);
    if (!farm) return reply.code(404).send({ error: 'unknown farm' });
    return { farm };
  });

  app.patch<{ Params: { id: string }; Body: UpdateFarmBody }>('/api/airdrops/farms/:id', async (req, reply) => {
    const body = req.body ?? {};
    if (body.status !== undefined && !isFarmStatus(body.status)) {
      return reply.code(400).send({ error: 'status must be "active", "claimed" or "dropped"' });
    }
    if (body.rewardUsd !== undefined && body.rewardUsd !== null) {
      const problem = invalidAmount(body.rewardUsd, 'rewardUsd');
      if (problem) return reply.code(400).send({ error: problem });
    }
    const wallet = optionalText(body.wallet, 'wallet', FARM_NAME_MAX);
    const note = optionalText(body.note, 'note', FARM_TEXT_MAX);
    for (const r of [wallet, note]) if (!r.ok) return reply.code(400).send({ error: r.error });

    const result = await updateFarm(deps.pool, req.params.id, {
      status: body.status as FarmStatus | undefined,
      rewardUsd: body.rewardUsd as number | null | undefined,
      wallet: wallet.ok ? wallet.value : undefined,
      note: note.ok ? note.value : undefined,
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'unknown farm' });
    if (result.kind === 'conflict') return reply.code(409).send({ error: 'another farm on this project is already active' });
    return { farm: result.farm };
  });

  app.delete<{ Params: { id: string } }>('/api/airdrops/farms/:id', async (req, reply) => {
    const deleted = await deleteFarm(deps.pool, req.params.id);
    if (!deleted) return reply.code(404).send({ error: 'unknown farm' });
    return { deleted: true };
  });
}
