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

  /**
   * Returns whether it actually landed, on top of logging.
   *
   * Every caller before this ignored the result on purpose — an alert that
   * cannot be delivered must not take the collector down. But that made a
   * mistyped chat id indistinguishable from a working one: the id counts,
   * the send 400s, the warning scrolls past, and the operator concludes
   * alerting is armed. The self-test needs the truth, so it is available
   * to whoever asks for it.
   */
  async send(chatId: string, text: string): Promise<SendResult> {
    if (!this.enabled) return { ok: false, reason: 'no bot token configured' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      if (res.ok) return { ok: true };

      // Telegram explains itself in the body — "chat not found", "bot was
      // blocked by the user" — and that sentence is the whole diagnosis.
      const detail = await res.text().catch(() => '');
      this.logger.warn({ status: res.status, chatId, detail }, 'telegram sendMessage failed');
      return { ok: false, reason: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
    } catch (err) {
      this.logger.warn({ err, chatId }, 'telegram sendMessage error');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}

export interface SendResult {
  ok: boolean;
  /** Why it did not land, in Telegram's own words where possible. */
  reason?: string;
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
    // Symbol, frame and what happened, all on line one. A phone shows one
    // line in the notification, and "MARKET HEALTH ALERT" — which is what
    // this used to say — is the one thing the reader already knows.
    `${SEVERITY_EMOJI[signal.severity]} <b>${signal.symbol}</b> ${signal.timeframe} — <b>${signal.signalType.replace(/_/g, ' ')}</b>`,
    '',
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
