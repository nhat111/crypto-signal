import type { FastifyInstance } from 'fastify';
import { getBaselinePerformance, getSignalPerformance, isDataSource, type DataSource } from '@crypto-signal/db';
import { ALL_SIGNAL_TYPES, type SignalType } from '@crypto-signal/signal-engine';
import type { ApiDeps } from '../deps.js';

const VALID_HORIZONS = ['15m', '1h', '4h', '24h'] as const;
type Horizon = (typeof VALID_HORIZONS)[number];

interface PerformanceQuery {
  horizon?: string;
  source?: string;
}

/**
 * Which provenance to report on. Defaults to 'live' so this page keeps
 * meaning what it has always meant — evidence the collector observed.
 * Replayed history is real but weaker (no liquidation data, engine re-run
 * rather than run), so it is opt-in and never silently averaged in.
 */
const VALID_SOURCES = ['live', 'backfill', 'all'] as const;

function parseSource(raw: string | undefined): DataSource | undefined | null {
  const value = raw ?? 'live';
  if (value === 'all') return undefined; // undefined => no filter => both counted
  return isDataSource(value) ? value : null; // null => invalid
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
    const source = parseSource(req.query.source);
    if (source === null) {
      return reply.code(400).send({ error: `source must be one of ${VALID_SOURCES.join(', ')}` });
    }
    const [results, baseline] = await Promise.all([
      Promise.all(
        ALL_SIGNAL_TYPES.map((signalType: SignalType) => getSignalPerformance(deps.pool, signalType, horizon as Horizon, source)),
      ),
      getBaselinePerformance(deps.pool, horizon as Horizon, source),
    ]);
    return { horizon, source: req.query.source ?? 'live', results, baseline };
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
    const source = parseSource(req.query.source);
    if (source === null) {
      return reply.code(400).send({ error: `source must be one of ${VALID_SOURCES.join(', ')}` });
    }
    const result = await getSignalPerformance(deps.pool, signalType, horizon as Horizon, source);
    return result;
  });
}
