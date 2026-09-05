import type { Logger } from '@crypto-signal/shared';
import type { TelegramNotifier } from './telegramNotifier.js';

/**
 * Proves the alert path end to end, on demand.
 *
 * `/status` reports how many chats the worker could alert, which answers
 * whether the environment variable was read — and nothing else. A mistyped
 * chat id counts exactly the same as a correct one: the send returns 400,
 * `send()` swallows it so a bad recipient cannot take the collector down,
 * and the operator sees "đang bật · 1 kênh" over a channel that will never
 * receive anything.
 *
 * That is the same shape of wrong as the silence this whole feature exists
 * to fix, one level down. The only thing that settles it is sending a real
 * message and reporting, per chat, whether it landed.
 *
 * Triggered by an environment variable because Railway gives no shell —
 * the same way the historical replay is run.
 */
export interface AlertSelfTestDeps {
  notifier: TelegramNotifier;
  logger: Logger;
  chatIds: string[];
}

export interface AlertSelfTestResult {
  attempted: number;
  delivered: string[];
  failed: { chatId: string; reason: string }[];
}

const MESSAGE = [
  '✅ <b>Kiểm tra cảnh báo</b>',
  '',
  'Nếu bro thấy tin này thì đường dẫn cảnh báo sự cố hệ thống đang thông:',
  'worker → Telegram → chat này.',
  '',
  '<i>Xoá biến TELEGRAM_ALERT_TEST đi để khỏi gửi lại mỗi lần deploy.</i>',
].join('\n');

export async function runAlertSelfTest(deps: AlertSelfTestDeps): Promise<AlertSelfTestResult> {
  const result: AlertSelfTestResult = { attempted: deps.chatIds.length, delivered: [], failed: [] };

  if (deps.chatIds.length === 0) {
    // Distinct from "every send failed": nothing was even attempted, and
    // the fix is a different one.
    deps.logger.warn(
      { env: 'TELEGRAM_ALERT_CHAT_IDS' },
      'alert self-test asked for, but no chat ids are configured — nothing to send to',
    );
    return result;
  }

  for (const chatId of deps.chatIds) {
    const sent = await deps.notifier.send(chatId, MESSAGE);
    if (sent.ok) result.delivered.push(chatId);
    else result.failed.push({ chatId, reason: sent.reason ?? 'unknown' });
  }

  if (result.failed.length === 0) {
    deps.logger.info({ delivered: result.delivered }, 'alert self-test: every chat received the message');
  } else {
    // Named individually: with several recipients, "2 of 3 worked" does not
    // tell the operator which id to fix.
    deps.logger.error(
      { delivered: result.delivered, failed: result.failed },
      'alert self-test: some chats did NOT receive the message — those ids are wrong or the bot cannot write there',
    );
  }

  return result;
}
