import type { FastifyInstance } from 'fastify';
import { deleteTrade, getTradeSummary, getTrades, insertTrade, updateTrade, type TradeSide, type TradeStatus } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

interface CreateTradeBody {
  chatId: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  size?: number | null;
  note?: string | null;
}

interface UpdateTradeBody {
  symbol?: string;
  side?: TradeSide;
  entryPrice?: number;
  exitPrice?: number | null;
  size?: number | null;
  note?: string | null;
}

interface TradesQuery {
  chatId?: string;
  status?: TradeStatus;
  limit?: string;
}

/**
 * A manual log, not a discovery feed — every write here is a person
 * recording a trade they actually took, never something the scanner or
 * signal engine produced on its own. The web dashboard has no login, so
 * chatId is optional there; Telegram always sends its chat id.
 */
export function registerJournalRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<{ Body: CreateTradeBody }>('/api/journal', async (req, reply) => {
    const { chatId, symbol, side, entryPrice } = req.body;
    if (!chatId || !symbol || !side || entryPrice === undefined) {
      return reply.code(400).send({ error: 'chatId, symbol, side, and entryPrice are required' });
    }
    if (side !== 'long' && side !== 'short') {
      return reply.code(400).send({ error: 'side must be "long" or "short"' });
    }
    const trade = await insertTrade(deps.pool, {
      chatId,
      symbol: symbol.toUpperCase(),
      side,
      entryPrice,
      size: req.body.size ?? null,
      note: req.body.note ?? null,
    });
    return { trade };
  });

  app.get<{ Querystring: TradesQuery }>('/api/journal', async (req) => {
    const trades = await getTrades(deps.pool, {
      chatId: req.query.chatId,
      status: req.query.status,
      limit: req.query.limit !== undefined ? Math.min(1000, Number(req.query.limit)) : undefined,
    });
    return { trades };
  });

  app.get<{ Querystring: { chatId?: string } }>('/api/journal/summary', async (req) => {
    const summary = await getTradeSummary(deps.pool, req.query.chatId);
    return { summary };
  });

  app.patch<{ Params: { id: string }; Body: UpdateTradeBody }>('/api/journal/:id', async (req, reply) => {
    const trade = await updateTrade(deps.pool, req.params.id, req.body);
    if (!trade) return reply.code(404).send({ error: 'unknown trade' });
    return { trade };
  });

  app.delete<{ Params: { id: string } }>('/api/journal/:id', async (req, reply) => {
    const deleted = await deleteTrade(deps.pool, req.params.id);
    if (!deleted) return reply.code(404).send({ error: 'unknown trade' });
    return { deleted: true };
  });
}
