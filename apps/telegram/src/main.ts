import { Telegraf } from 'telegraf';
import { createLogger, loadConfig } from '@crypto-signal/shared';
import { ApiClient } from './apiClient.js';
import { formatHeatmap, formatOverview, formatSignalList, formatSymbolDetail, HELP_TEXT } from './formatting.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('telegram', config.logLevel);

  if (!config.telegramBotToken) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — telegram bot will not start. This is fine for local dev without a bot.');
    return;
  }

  const api = new ApiClient(config.apiBaseUrl);
  const bot = new Telegraf(config.telegramBotToken);

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

  bot.command('start', async (ctx) => {
    await ctx.reply(`Welcome. ${HELP_TEXT}`, { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
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

  for (const [command, symbol] of [
    ['btc', 'BTCUSDT'],
    ['eth', 'ETHUSDT'],
    ['sol', 'SOLUSDT'],
  ] as const) {
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
        `Alerts are currently ${settings.alertsEnabled ? 'ON' : 'OFF'} for this chat.\nUse /alerts on or /alerts off to change.\nSymbols: ${settings.symbols.join(', ')}\nMin severity: ${settings.minSeverity}`,
      );
    } catch (err) {
      logger.error({ err }, '/alerts failed');
      await ctx.reply('Could not read alert settings right now — try again shortly.');
    }
  });

  await bot.launch();
  logger.info('telegram bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('telegram bot failed to start', err);
  process.exit(1);
});
