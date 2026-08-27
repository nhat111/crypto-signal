import type { FastifyInstance } from 'fastify';
import { getBaselinePerformance, getSignalPerformance } from '@crypto-signal/db';
import { ALL_SIGNAL_TYPES, type SignalType } from '@crypto-signal/signal-engine';
import type { ApiDeps } from '../deps.js';

const VALID_HORIZONS = ['15m', '1h', '4h', '24h'] as const;
type Horizon = (typeof VALID_HORIZONS)[number];

interface PerformanceQuery {
  horizon?: string;
}

/**
 * Spec §24 "Signal Performance" — always computed from real signal_outcomes
 * rows (Phase 9), never claimed without evidence: sufficientData is false
 * (and the caller should say so) below 30 samples.
 */
export function registerPerformanceRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: PerformanceQuery }>('/api/performance', async (req, reply) => {
    const horizon = (req.query.horizon ?? '1h') as string;
    if (!VALID_HORIZONS.includes(horizon as Horizon)) {
      return reply.code(400).send({ error: `horizon must be one of ${VALID_HORIZONS.join(', ')}` });
    }
    // The baseline is what every result on this page has to be read
    // against — a signal type's hit rate means nothing without knowing how
    // often price rose anyway over the same window.
    const [results, baseline] = await Promise.all([
      Promise.all(ALL_SIGNAL_TYPES.map((signalType: SignalType) => getSignalPerformance(deps.pool, signalType, horizon as Horizon))),
      getBaselinePerformance(deps.pool, horizon as Horizon),
    ]);
    return { horizon, results, baseline };
  });

  app.get<{ Params: { signalType: string }; Querystring: PerformanceQuery }>('/api/performance/:signalType', async (req, reply) => {
    const horizon = (req.query.horizon ?? '1h') as string;
    if (!VALID_HORIZONS.includes(horizon as Horizon)) {
      return reply.code(400).send({ error: `horizon must be one of ${VALID_HORIZONS.join(', ')}` });
    }
    const signalType = req.params.signalType.toUpperCase();
    if (!ALL_SIGNAL_TYPES.includes(signalType as SignalType)) {
      return reply.code(404).send({ error: `Unknown signal type ${signalType}` });
    }
    const result = await getSignalPerformance(deps.pool, signalType, horizon as Horizon);
    return result;
  });
}
