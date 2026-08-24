import { Telegraf } from 'telegraf';
import { createLogger, loadConfig, type Logger } from '@crypto-signal/shared';
import { ApiClient } from './apiClient.js';
import { buildHelpText, formatHeatmap, formatOverview, formatSignalList, formatSymbolDetail } from './formatting.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('telegram', config.logLevel);

  if (!config.telegramBotToken) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — telegram bot will not start. This is fine for local dev without a bot.');
    return;
  }

  const api = new ApiClient(config.apiBaseUrl);
  const bot = new Telegraf(config.telegramBotToken);

  // Telegraf needs every command registered before launch, so the symbol
  // list is read once here from the API (which reads it from the database,
  // where the collector registered it). Adding a symbol therefore only
  // needs the worker's config changed — but the bot must be restarted to
  // pick up the new /command.
  const symbols = await fetchSymbolsWithRetry(api, logger);

  bot.use(async (ctx, next) => {
    if (ctx.chat) {
      try {
        await api.registerUser(String(ctx.chat.id), 'username' in ctx.chat ? ctx.chat.username : undefined);
      } catch (err) {
        logger.warn({ err }, 'failed to register bot user (non-fatal)');
      }
    }
    await next();
  });

  const helpText = buildHelpText(symbols);

  bot.command('start', async (ctx) => {
    await ctx.reply(`Welcome. ${helpText}`, { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  bot.command('status', async (ctx) => {
    try {
      const overview = await api.getOverview();
      await ctx.reply(formatOverview(overview.rows, '15m'), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err }, '/status failed');
      await ctx.reply('Could not load market status right now — try again shortly.');
    }
  });

  bot.command('market', async (ctx) => {
    try {
      const overview = await api.getOverview();
      await ctx.reply(formatHeatmap(overview.rows, overview.symbols, overview.timeframes), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err }, '/market failed');
      await ctx.reply('Could not load market heatmap right now — try again shortly.');
    }
  });

  for (const symbol of symbols) {
    const command = commandNameFor(symbol);
    bot.command(command, async (ctx) => {
      try {
        const detail = await api.getSymbol(symbol, '15m');
        if (!detail.latest) {
          await ctx.reply(`No data yet for ${symbol} — the collector may still be warming up.`);
          return;
        }
        await ctx.reply(formatSymbolDetail(detail.latest, detail.signals), { parse_mode: 'HTML' });
      } catch (err) {
        logger.error({ err, symbol }, `/${command} failed`);
        await ctx.reply(`Could not load ${symbol} right now — try again shortly.`);
      }
    });
  }

  bot.command('signals', async (ctx) => {
    try {
      const { signals } = await api.getSignals(10);
      await ctx.reply(formatSignalList(signals), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err }, '/signals failed');
      await ctx.reply('Could not load recent signals right now — try again shortly.');
    }
  });

  bot.command('alerts', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    try {
      if (arg === 'on' || arg === 'off') {
        const { settings } = await api.setAlertsEnabled(chatId, arg === 'on');
        await ctx.reply(`Alerts ${settings.alertsEnabled ? 'enabled' : 'disabled'} for this chat.`);
        return;
      }
      const { settings } = await api.getSettings(chatId);
      await ctx.reply(
        `Alerts are currently ${settings.alertsEnabled ? 'ON' : 'OFF'} for this chat.\nUse /alerts on or /alerts off to change.\nSymbols: ${settings.symbols.length === 0 ? 'all tracked symbols' : settings.symbols.join(', ')}\nMin severity: ${settings.minSeverity}`,
      );
    } catch (err) {
      logger.error({ err }, '/alerts failed');
      await ctx.reply('Could not read alert settings right now — try again shortly.');
    }
  });

  // Populates Telegram's own command menu so /hype (and any future symbol)
  // is discoverable without reading /help.
  try {
    await bot.telegram.setMyCommands([
      { command: 'status', description: 'Health overview (15m)' },
      { command: 'market', description: 'Heatmap across timeframes' },
      ...symbols.map((symbol) => ({ command: commandNameFor(symbol), description: `${symbol} detail` })),
      { command: 'signals', description: 'Recent signals' },
      { command: 'alerts', description: 'Toggle alerts for this chat' },
      { command: 'help', description: 'Show help' },
    ]);
  } catch (err) {
    logger.warn({ err }, 'setMyCommands failed (non-fatal)');
  }

  await bot.launch();
  logger.info({ symbols }, 'telegram bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

/** "BTCUSDT" -> "btc". Telegram commands are lowercase and can't contain most punctuation. */
function commandNameFor(symbol: string): string {
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  return base.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

const SYMBOL_FETCH_ATTEMPTS = 5;

/**
 * The API may still be booting when this service starts (both deploy at
 * once), so retry briefly rather than starting a bot with no symbol
 * commands at all. Falls back to whatever this service has configured
 * locally — better a partial bot than none.
 */
async function fetchSymbolsWithRetry(api: ApiClient, logger: Logger): Promise<string[]> {
  for (let attempt = 1; attempt <= SYMBOL_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const overview = await api.getOverview();
      if (overview.symbols.length > 0) return overview.symbols;
      logger.warn({ attempt }, 'API returned an empty symbol list');
    } catch (err) {
      logger.warn({ err, attempt }, 'could not fetch symbol list from API');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }

  const fallback = [...loadConfig().symbols, ...loadConfig().futuresOnlySymbols];
  logger.error({ fallback }, 'giving up on the API symbol list, falling back to local config');
  return fallback;
}

main().catch((err) => {
  console.error('telegram bot failed to start', err);
  process.exit(1);
});
