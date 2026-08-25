import { Telegraf } from 'telegraf';
import { createLogger, loadConfig, type Logger } from '@crypto-signal/shared';
import { ApiClient, ApiError } from './apiClient.js';
import {
  buildHelpText,
  formatGemList,
  formatHeatmap,
  formatJournal,
  formatOverview,
  formatSignalList,
  formatSymbolDetail,
  formatTradeClosed,
  formatTradeOpened,
  formatWatchConfirmation,
  formatWatchList,
} from './formatting.js';
import type { TradeSide } from './apiClient.js';

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
        await ctx.reply(formatSymbolDetail(detail.latest, detail.signals, detail.priceLevels), { parse_mode: 'HTML' });
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

  bot.command('gems', async (ctx) => {
    try {
      const { gems } = await api.getGems(10);
      await ctx.reply(formatGemList(gems), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (err) {
      logger.error({ err }, '/gems failed');
      await ctx.reply('Could not load small-cap candidates right now — try again shortly.');
    }
  });

  bot.command('watch', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const symbol = ctx.message.text.split(' ')[1]?.toUpperCase();
    if (!symbol) {
      await ctx.reply('Usage: /watch SYMBOL — e.g. /watch DINGER (must be a symbol you\'ve seen in /gems).');
      return;
    }
    try {
      const { watch } = await api.watchGem(chatId, symbol);
      await ctx.reply(formatWatchConfirmation(watch), { parse_mode: 'HTML' });
    } catch (err) {
      if (err instanceof ApiError) {
        await ctx.reply(err.message);
        return;
      }
      logger.error({ err, symbol }, '/watch failed');
      await ctx.reply('Could not start watching that right now — try again shortly.');
    }
  });

  bot.command('watches', async (ctx) => {
    const chatId = String(ctx.chat.id);
    try {
      const { watches } = await api.getWatches(chatId);
      await ctx.reply(formatWatchList(watches), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err }, '/watches failed');
      await ctx.reply('Could not load your watches right now — try again shortly.');
    }
  });

  bot.command('unwatch', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const symbol = ctx.message.text.split(' ')[1]?.toUpperCase();
    if (!symbol) {
      await ctx.reply('Usage: /unwatch SYMBOL');
      return;
    }
    try {
      const { watches } = await api.getWatches(chatId);
      const match = watches.find((w) => w.symbol.toUpperCase() === symbol);
      if (!match) {
        await ctx.reply(`No active watch for ${symbol}.`);
        return;
      }
      await api.unwatch(chatId, match.id);
      await ctx.reply(`Stopped watching ${symbol}.`);
    } catch (err) {
      logger.error({ err, symbol }, '/unwatch failed');
      await ctx.reply('Could not unwatch that right now — try again shortly.');
    }
  });

  bot.command('trade', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const parts = ctx.message.text.split(/\s+/).slice(1);
    const [symbolRaw, sideRaw, entryRaw, sizeRaw] = parts;
    const symbol = symbolRaw?.toUpperCase();
    const side = sideRaw?.toLowerCase() as TradeSide | undefined;
    const entryPrice = entryRaw !== undefined ? Number(entryRaw) : NaN;
    const size = sizeRaw !== undefined ? Number(sizeRaw) : null;

    if (!symbol || (side !== 'long' && side !== 'short') || !Number.isFinite(entryPrice) || (size !== null && !Number.isFinite(size))) {
      await ctx.reply('Usage: /trade SYMBOL long|short ENTRY_PRICE [SIZE]\ne.g. /trade BTCUSDT long 78000 0.1');
      return;
    }

    try {
      const { trade } = await api.openTrade(chatId, symbol, side, entryPrice, size);
      await ctx.reply(formatTradeOpened(trade), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, symbol }, '/trade failed');
      await ctx.reply('Could not log that trade right now — try again shortly.');
    }
  });

  bot.command('close', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const parts = ctx.message.text.split(/\s+/).slice(1);
    const symbol = parts[0]?.toUpperCase();
    const exitPrice = parts[1] !== undefined ? Number(parts[1]) : NaN;

    if (!symbol || !Number.isFinite(exitPrice)) {
      await ctx.reply('Usage: /close SYMBOL EXIT_PRICE\ne.g. /close BTCUSDT 79200');
      return;
    }

    try {
      const open = await api.getOpenTrade(chatId, symbol);
      if (!open) {
        await ctx.reply(`No open trade for ${symbol}. Use /journal to see what's logged.`);
        return;
      }
      const { trade } = await api.closeTrade(open.id, exitPrice);
      await ctx.reply(formatTradeClosed(trade), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, symbol }, '/close failed');
      await ctx.reply('Could not close that trade right now — try again shortly.');
    }
  });

  bot.command('journal', async (ctx) => {
    const chatId = String(ctx.chat.id);
    try {
      const [{ trades }, { summary }] = await Promise.all([api.getTrades(chatId, 20), api.getTradeSummary(chatId)]);
      await ctx.reply(formatJournal(trades, summary), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err }, '/journal failed');
      await ctx.reply('Could not load your journal right now — try again shortly.');
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
      { command: 'gems', description: 'Small-cap candidates' },
      { command: 'watch', description: 'Track a position, get a sell alert' },
      { command: 'watches', description: 'List your active watches' },
      { command: 'unwatch', description: 'Stop tracking a position' },
      { command: 'trade', description: 'Log a trade you took' },
      { command: 'close', description: 'Close a logged trade' },
      { command: 'journal', description: 'Your trade log + P&L summary' },
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
