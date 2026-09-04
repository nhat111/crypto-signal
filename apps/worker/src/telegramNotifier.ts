import type { Logger } from '@crypto-signal/shared';
import { SIGNAL_MEANING, type Signal } from '@crypto-signal/signal-engine';
import type { HealthResult, RiskResult } from '@crypto-signal/health-engine';
import { verdictWarning, type SignalVerdict } from '@crypto-signal/db';

/**
 * Sends the proactive alert push directly to Telegram's Bot API. This is
 * intentionally separate from apps/telegram (the interactive bot): the
 * interactive bot answers /commands by calling apps/api, same as the web
 * dashboard (rule 8, "Telegram và Web dùng chung API/domain layer"); this
 * module is the one-way alert push, which has no "domain logic" to share —
 * it just formats an already-computed Signal into text.
 */
export class TelegramNotifier {
  constructor(
    private readonly botToken: string,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return this.botToken.length > 0;
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status, chatId }, 'telegram sendMessage failed');
      }
    } catch (err) {
      this.logger.warn({ err, chatId }, 'telegram sendMessage error');
    }
  }
}

const SEVERITY_EMOJI: Record<Signal['severity'], string> = {
  INFO: 'ℹ️',
  LOW: '🟡',
  MEDIUM: '🟠',
  HIGH: '🔴',
  EXTREME: '🚨',
};

/**
 * The alert, plus what the recorded outcomes say about this type.
 *
 * An alert's default reading is "this is worth paying attention to", so a
 * type the evidence says is *reliably worse than doing nothing* cannot be
 * sent looking like every other type — that is the system measuring
 * something and then not telling the person it measured it for.
 *
 * Only the negative verdict is carried. A "beats the baseline" line
 * attached to a live signal reads as a recommendation to trade, which this
 * project does not make; someone who wants the full evidence can open
 * /performance, and the warning line says where it came from.
 */
export function formatAlertMessage(
  signal: Signal,
  health: HealthResult | null,
  risk: RiskResult,
  verdict?: SignalVerdict,
): string {
  const warning = verdictWarning(verdict);
  const meaning = SIGNAL_MEANING[signal.signalType];
  const lines = [
    `${SEVERITY_EMOJI[signal.severity]} <b>MARKET HEALTH ALERT</b>`,
    '',
    `<b>${signal.symbol}</b> — ${signal.timeframe}`,
    '',
    `Signal: <b>${signal.signalType.replace(/_/g, ' ')}</b>`,
    `Severity: ${signal.severity}`,
    `Confidence: ${signal.confidence}%`,
    '',
    health ? `Health: ${health.score}/100 (${health.status.replace('_', ' ')})` : 'Health: N/A (futures-only symbol)',
    `Leverage Risk: ${risk.score}/100`,
    '',
    // The plain sentence before the evidence, not after it. The reasons
    // are precise and unreadable to anyone who does not already know what
    // a CVD skew is; an alert that opens with numbers has lost the reader
    // by line two.
    `<b>Nghĩa là:</b> ${meaning.plain}`,
    `<i>${meaning.caveat}</i>`,
    '',
    '<b>Căn cứ:</b>',
    ...signal.reasons.map((r, i) => `${i + 1}. ${r}`),
  ];
  if (warning) lines.push('', `⚠️ <b>${warning}</b>`);
  return lines.join('\n');
}
