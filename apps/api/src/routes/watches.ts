import type { FastifyInstance } from 'fastify';
import { closeGemWatchForChat, getActiveWatch, getActiveWatchesForChat, getLatestGemBySymbol, insertGemWatch } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

interface CreateWatchBody {
  chatId: string;
  symbol: string;
}

interface CloseWatchBody {
  chatId: string;
}

/**
 * "/watch SYMBOL" support. Telegram bot writes go through here, never
 * straight to Postgres — same rule as every other bot-facing route (see
 * bot.ts). The worker's periodic sell-condition check reads gem_watches
 * directly instead (it isn't request-driven), same split as gem_scans.
 */
export function registerWatchRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<{ Body: CreateWatchBody }>('/api/watches', async (req, reply) => {
    if (!deps.gemConfig) return reply.code(503).send({ error: 'gem scanner is disabled — nothing to watch against' });
    const { chatId, symbol } = req.body;
    if (!chatId || !symbol) return reply.code(400).send({ error: 'chatId and symbol are required' });

    const gem = await getLatestGemBySymbol(deps.pool, symbol);
    if (!gem) {
      return reply.code(404).send({ error: `no recent scan found for "${symbol}" — check /gems first` });
    }
    if (gem.priceUsd === null) {
      return reply.code(422).send({ error: `"${symbol}" has no known price to set as entry` });
    }

    const existing = await getActiveWatch(deps.pool, chatId, gem.chainId, gem.tokenAddress);
    if (existing) {
      return reply.code(409).send({ error: `already watching ${gem.symbol}`, watch: existing });
    }

    const watch = await insertGemWatch(deps.pool, {
      chatId,
      chainId: gem.chainId,
      tokenAddress: gem.tokenAddress,
      symbol: gem.symbol,
      entryPrice: gem.priceUsd,
      entryLiquidityUsd: gem.liquidityUsd,
      entryRiskScore: gem.riskScore,
      entrySafetyVerdict: gem.safetyVerdict,
      stopLossPct: deps.gemConfig.watch.stopLossPct,
      takeProfitPct: deps.gemConfig.watch.takeProfitPct,
      liquidityCollapsePct: deps.gemConfig.watch.liquidityCollapsePct,
      riskScoreAlert: deps.gemConfig.watch.riskScoreAlert,
    });

    return { watch };
  });

  app.get<{ Params: { chatId: string } }>('/api/watches/:chatId', async (req) => {
    const watches = await getActiveWatchesForChat(deps.pool, req.params.chatId);
    return { watches };
  });

  app.post<{ Params: { id: string }; Body: CloseWatchBody }>('/api/watches/:id/close', async (req, reply) => {
    const closed = await closeGemWatchForChat(deps.pool, req.params.id, req.body.chatId);
    if (!closed) return reply.code(404).send({ error: 'no active watch with that id for this chat' });
    return { closed: true };
  });
}
