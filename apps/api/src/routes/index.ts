import type { FastifyInstance } from 'fastify';
import type { ApiDeps } from '../deps.js';
import { registerHealthRoute } from './health.js';
import { registerOverviewRoute } from './overview.js';
import { registerSymbolRoute } from './symbol.js';
import { registerSignalsRoute } from './signals.js';
import { registerPerformanceRoute } from './performance.js';
import { registerBotRoutes } from './bot.js';

export function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  registerHealthRoute(app, deps);
  registerOverviewRoute(app, deps);
  registerSymbolRoute(app, deps);
  registerSignalsRoute(app, deps);
  registerPerformanceRoute(app, deps);
  registerBotRoutes(app, deps);
}
