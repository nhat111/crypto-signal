import pino from 'pino';

export type Logger = pino.Logger;

/**
 * One structured logger factory shared by worker/api/telegram so log shape
 * (level, time, name, msg + fields) is consistent everywhere. Pretty-prints
 * in a TTY (local dev), JSON lines otherwise (containers/CI).
 */
export function createLogger(name: string, level = process.env['LOG_LEVEL'] ?? 'info'): Logger {
  const isTty = Boolean(process.stdout.isTTY);
  return pino({
    name,
    level,
    ...(isTty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}
