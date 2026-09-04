import type { FastifyInstance } from 'fastify';
import { getGemByAddress, getGemComponentEdges, getGemPerformance, getGemScoreEdge, getLatestGems, type GemHorizon } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

interface GemsQuery {
  chain?: string;
  minScore?: string;
  limit?: string;
}

const VALID_HORIZONS: GemHorizon[] = ['24h', '7d'];

/**
 * Read-only surfaces for the small-cap discovery scanner. Like every other
 * route here, it reads what the worker persisted and never calls an
 * upstream data source itself.
 */
export function registerGemRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: GemsQuery }>('/api/gems', async (req) => {
    const gems = await getLatestGems(deps.pool, {
      chainId: req.query.chain,
      minScore: req.query.minScore !== undefined ? Number(req.query.minScore) : undefined,
      limit: Math.min(200, Number(req.query.limit ?? 50)),
    });
    return { gems };
  });

  app.get<{ Params: { chain: string; address: string } }>('/api/gems/:chain/:address', async (req, reply) => {
    const gem = await getGemByAddress(deps.pool, req.params.chain, req.params.address);
    if (!gem) return reply.code(404).send({ error: 'Unknown token, or it has not been scanned yet' });
    return gem;
  });

  app.get<{ Querystring: { horizon?: string } }>('/api/gems/performance', async (req, reply) => {
    const horizon = (req.query.horizon ?? '7d') as GemHorizon;
    if (!VALID_HORIZONS.includes(horizon)) {
      return reply.code(400).send({ error: `horizon must be one of ${VALID_HORIZONS.join(', ')}` });
    }
    // The score edge rides along rather than getting its own request: the
    // two answer one question together — "did anything happen" and "did
    // the score have anything to do with it" — and reading the first
    // without the second is how a scanner with no edge keeps its job.
    const [performance, scoreEdge, componentEdges] = await Promise.all([
      // The headline keeps meaning "when the scanner called something";
      // the tables below it deliberately count everything eligible,
      // because that is the only way to have something to compare against.
      getGemPerformance(deps.pool, horizon, deps.gemConfig?.alert.minScore),
      getGemScoreEdge(deps.pool, horizon),
      // Which of the five bets the score makes actually pay. The total can
      // look like noise while two components cancel each other out, and
      // only this says which one to change.
      getGemComponentEdges(deps.pool, horizon),
    ]);
    return { ...performance, scoreEdge, componentEdges };
  });
}
