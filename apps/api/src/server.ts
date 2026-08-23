import Fastify from 'fastify';
import cors from '@fastify/cors';
import pg from 'pg';
import { createLogger, loadConfig } from '@crypto-signal/shared';
import { registerRoutes } from './routes/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('api', config.logLevel);

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  registerRoutes(app, { pool, config });

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, 'unhandled API error');
    reply.code(500).send({ error: 'internal_error' });
  });

  await app.listen({ port: config.apiPort, host: config.apiHost });
  logger.info(`API listening on http://${config.apiHost}:${config.apiPort}`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down API');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('api failed to start', err);
  process.exit(1);
});
