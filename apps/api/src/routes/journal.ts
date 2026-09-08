import type { FastifyInstance } from 'fastify';
import {
  computeUnrealized,
  deleteTrade,
  getMarkPrices,
  getTradeSummary,
  getTrades,
  insertTrade,
  isTradeSide,
  updateTrade,
  type TradeRow,
  type TradeSide,
  type TradeStatus,
  type UnrealizedPnl,
} from '@crypto-signal/db';
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
/**
 * A price the caller supplied, or a reason it cannot be one.
 *
 * The browser is not the only writer here (Telegram posts to the same
 * route), and JSON.stringify turns NaN into null, so a client that fumbled
 * a parse arrives looking like an omitted field rather than an error. Both
 * get refused: a price of 0 books a total loss, and a negative or
 * non-finite one has no meaning the P&L maths can carry.
 */
function invalidPrice(value: unknown, field: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${field} must be a number`;
  if (value <= 0) return `${field} must be greater than zero`;
  return null;
}

export function registerJournalRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<{ Body: CreateTradeBody }>('/api/journal', async (req, reply) => {
    const { chatId, symbol, side, entryPrice } = req.body;
    if (!chatId || !symbol || !side || entryPrice === undefined) {
      return reply.code(400).send({ error: 'chatId, symbol, side, and entryPrice are required' });
    }
    if (!isTradeSide(side)) {
      return reply.code(400).send({ error: 'side must be "spot", "long" or "short"' });
    }
    const entryProblem = invalidPrice(entryPrice, 'entryPrice');
    if (entryProblem) return reply.code(400).send({ error: entryProblem });
    if (req.body.size !== undefined && req.body.size !== null) {
      const sizeProblem = invalidPrice(req.body.size, 'size');
      if (sizeProblem) return reply.code(400).send({ error: sizeProblem });
    }
    const trade = await insertTrade(deps.pool, {
      chatId,
      // Casing is decided in one place (normalizeTradeSymbol), because a
      // contract address must survive it unchanged and a ticker must not.
      symbol,
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
    // The page ages the mark price against this rather than its own clock:
    // Date.now() in render is impure, and a phone's clock can be minutes out.
    return { trades: await withUnrealized(deps.pool, trades), serverTime: Date.now() };
  });

  app.get<{ Querystring: { chatId?: string } }>('/api/journal/summary', async (req) => {
    const [summary, open] = await Promise.all([
      getTradeSummary(deps.pool, req.query.chatId),
      getTrades(deps.pool, { chatId: req.query.chatId, status: 'open', limit: 1000 }),
    ]);
    return { summary: { ...summary, ...aggregateUnrealized(await withUnrealized(deps.pool, open)) } };
  });

  app.patch<{ Params: { id: string }; Body: UpdateTradeBody }>('/api/journal/:id', async (req, reply) => {
    // null is meaningful on a patch — it reopens a trade, or clears a size —
    // so only a supplied non-null value is checked.
    for (const [field, value] of [
      ['entryPrice', req.body.entryPrice],
      ['exitPrice', req.body.exitPrice],
      ['size', req.body.size],
    ] as const) {
      if (value === undefined || value === null) continue;
      const problem = invalidPrice(value, field);
      if (problem) return reply.code(400).send({ error: problem });
    }

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

/**
 * Attaches an estimated P&L to every OPEN trade, and to no closed one.
 *
 * A closed trade already has the only P&L that is a fact — priced from the
 * exit the user actually got, at close, and never recomputed. Re-pricing
 * it against today's market would silently rewrite history every time the
 * page polled.
 */
async function withUnrealized(pool: Parameters<typeof getMarkPrices>[0], trades: TradeRow[]): Promise<Array<TradeRow & Partial<UnrealizedPnl>>> {
  const open = trades.filter((t) => t.status === 'open');
  if (open.length === 0) return trades;

  const marks = await getMarkPrices(pool, open.map((t) => t.symbol));
  return trades.map((trade) => {
    if (trade.status !== 'open') return trade;
    const mark = marks.get(trade.symbol);
    if (!mark) return trade;
    return {
      ...trade,
      ...computeUnrealized({ side: trade.side, entryPrice: trade.entryPrice, size: trade.size }, mark),
    };
  });
}

/**
 * The open book as one number, reported separately from realized P&L and
 * never added to it.
 *
 * `pricedCount` against `openCount` is the honest part: a total that
 * silently covers three of five positions is worse than no total, because
 * it looks complete. Null rather than 0 when nothing could be priced —
 * "$0" would read as "flat", not as "unknown".
 */
function aggregateUnrealized(trades: Array<TradeRow & Partial<UnrealizedPnl>>): {
  unrealizedPnlUsd: number | null;
  unrealizedPricedCount: number;
} {
  const priced = trades.filter((t) => t.status === 'open' && typeof t.unrealizedPnlUsd === 'number');
  if (priced.length === 0) return { unrealizedPnlUsd: null, unrealizedPricedCount: 0 };
  return {
    unrealizedPnlUsd: priced.reduce((sum, t) => sum + (t.unrealizedPnlUsd as number), 0),
    unrealizedPricedCount: priced.length,
  };
}
