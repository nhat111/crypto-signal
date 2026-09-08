/**
 * The one question the gem scanner exists to answer: does it beat the
 * tokens it threw away?
 *
 * This lives in shared, and is pure, because two callers must never give
 * different answers to it — the bot's /baseline command reads it through
 * the API, the worker pushes it unprompted from the database, and a
 * divergence between those two would be a disagreement about whether the
 * thing works.
 *
 * It interprets, it does not compute: every number here was decided
 * elsewhere (getGemPerformance, compareToBaseline). What it adds is the
 * reading, including the one nobody wants — that a scanner losing to its
 * own rejects should be switched off rather than tuned.
 */

export type BaselineVerdict = 'beats' | 'worse' | 'indistinguishable';

/** Only the fields the reading needs — a structural subset of the API's GemPerformance, so either caller's shape satisfies it. */
export interface BaselineReportInput {
  horizon: string;
  sampleCount: number;
  netPositiveMovePct?: number | null;
  medianMovePct: number | null;
  sufficientData: boolean;
  /**
   * Present even when `baseline` is absent, which is the only time it
   * changes the answer: it says whether controls are missing or merely
   * young. Optional so an API predating it degrades to the old wording
   * rather than claiming a count of zero it never sent.
   */
  baselineCollection?: { pendingCount: number; pricedCount?: number; oldestPendingAgeDays?: number | null };
  baseline?: {
    sampleCount: number;
    netPositiveMovePct: number | null;
    medianMovePct: number | null;
    deltaPp: number;
    marginPp: number | null;
    verdict: BaselineVerdict;
    medianDeltaPp: number | null;
    failureCounts?: Record<string, number>;
  };
}

export type BaselineReadiness =
  /**
   * No control priced yet. `pending` separates the two reasons, because
   * they call for opposite responses: nothing recorded at all means the
   * collection is broken, while a stack of candidates too young to have
   * outcomes means wait, and roughly how long.
   */
  | { state: 'no_control'; pending: number | null; priced: number | null; oldestPendingAgeDays: number | null }
  /** Outcomes exist but one side is still too thin to compare. */
  | { state: 'waiting'; scannerSamples: number; baselineSamples: number; needed: number }
  | { state: 'ready'; verdict: BaselineVerdict };

export const MIN_BASELINE_SAMPLES = 20;

export function baselineReadiness(input: BaselineReportInput): BaselineReadiness {
  if (!input.baseline || input.baseline.sampleCount === 0) {
    return {
      state: 'no_control',
      // null, not 0: an API that never sent the field has not told us the
      // count is zero, and reporting "nothing recorded" off a missing
      // field would raise a false alarm about a broken pipeline.
      pending: input.baselineCollection?.pendingCount ?? null,
      priced: input.baselineCollection?.pricedCount ?? null,
      oldestPendingAgeDays: input.baselineCollection?.oldestPendingAgeDays ?? null,
    };
  }
  if (!input.sufficientData || input.baseline.sampleCount < MIN_BASELINE_SAMPLES) {
    return {
      state: 'waiting',
      scannerSamples: input.sampleCount,
      baselineSamples: input.baseline.sampleCount,
      needed: MIN_BASELINE_SAMPLES,
    };
  }
  return { state: 'ready', verdict: input.baseline.verdict };
}

/**
 * The largest share of the control group attributable to one rejection
 * reason, or null when there is nothing to report.
 *
 * A control dominated by a single reason is not a market baseline, it is a
 * baseline of that one reason — if nearly every reject was thrown out for
 * extreme_pump, "beats the rejects" means "beats tokens that had already
 * pumped", which is a much narrower claim than the headline implies.
 */
export function controlConcentration(
  failureCounts: Record<string, number> | undefined,
  baselineSampleCount: number,
): { reason: string; sharePct: number } | null {
  if (!failureCounts || baselineSampleCount <= 0) return null;
  const entries = Object.entries(failureCounts);
  if (entries.length === 0) return null;

  let top = entries[0] as [string, number];
  for (const e of entries) if (e[1] > top[1]) top = e as [string, number];

  const sharePct = Math.round((top[1] / baselineSampleCount) * 1000) / 10;
  return { reason: top[0], sharePct };
}

/** Above this, the control is described as dominated by one reason rather than as a market baseline. */
export const CONCENTRATION_WARN_PCT = 60;

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? 'chưa có' : `${v}%`;
}

function signed(v: number | null): string {
  if (v === null) return 'chưa có';
  return `${v >= 0 ? '+' : ''}${v}`;
}

const TITLE = '📊 <b>SCANNER SO VỚI CHÍNH ĐÁM NÓ LOẠI</b>';

/**
 * The whole message, as plain lines. HTML escaping is the caller's job —
 * every value here is a number or a reason slug the scanner itself
 * produced, never user text.
 *
 * Written in Vietnamese, the reader's language, for the same reason the
 * lookup glossary is: this is the message that decides whether to keep
 * running the gem scanner, and it is worth nothing if it is not
 * understood. The scoring vocabulary the panels print — the horizon, the
 * rejection slugs — stays as it appears elsewhere.
 */
export function formatBaselineReport(input: BaselineReportInput): string[] {
  const readiness = baselineReadiness(input);

  if (readiness.state === 'no_control') {
    // Two different problems wearing the same sentence, so they get
    // different messages: one says wait, the other says go and look.
    // Priced controls with no comparison block means the scanner is the
    // empty side, not the control. Saying "no control has matured yet"
    // here would name the wrong half as the thing that is missing.
    if (readiness.priced !== null && readiness.priced > 0) {
      return [
        TITLE,
        '',
        `Nhóm đối chứng đã có ${readiness.priced} kết quả, nhưng scanner thì chưa có lần gọi tên nào được chốt.`,
        '',
        `Bên thiếu là scanner, không phải đối chứng. Mốc ${input.horizon} tính từ lúc quét ra, nên chỉ những con được gọi tên đủ lâu mới lên số.`,
      ];
    }

    if (readiness.pending !== null && readiness.pending > 0) {
      const age =
        readiness.oldestPendingAgeDays === null
          ? ''
          : ` Con cũ nhất đã ghi được ${readiness.oldestPendingAgeDays} ngày.`;
      return [
        TITLE,
        '',
        `Đã ghi ${readiness.pending} token bị loại, nhưng chưa con nào tới hạn chốt kết quả.${age}`,
        '',
        `Mốc ${input.horizon} tính từ lúc ghi nhận, nên phải chờ đủ ngần đó thời gian rồi mới có số đầu tiên. Đang chạy đúng, chỉ là chưa tới lúc.`,
      ];
    }

    if (readiness.pending === 0) {
      return [
        TITLE,
        '',
        'Chưa ghi được token bị loại nào.',
        '',
        'Cái này khác với "đám bị loại không đi đâu cả" — nghĩa là bộ quét chưa lưu lại con nào để đối chứng. Nếu tình trạng này kéo dài qua vài lần quét thì là hỏng, không phải chờ: xem /status để biết các chain có quét ra được ứng viên nào không.',
      ];
    }

    return [
      TITLE,
      '',
      'Chưa có nhóm đối chứng nào được chốt giá.',
      '',
      'Cái này khác với "đám bị loại không đi đâu cả" — nghĩa là chưa token bị loại nào được theo tới kết quả cuối. Chừng nào chưa có, không có gì để đem scanner ra so.',
    ];
  }

  if (readiness.state === 'waiting') {
    return [
      TITLE,
      '',
      `Chưa đủ kết quả để trả lời — scanner ${readiness.scannerSamples}/${readiness.needed}, đối chứng ${readiness.baselineSamples}/${readiness.needed}.`,
      '',
      'Chưa đủ ngưỡng thì không đưa ra phần trăm nào. Một tỷ lệ thắng tính trên vài mẫu trông như một phát hiện, nhưng thực chất là nhiễu.',
      '',
      '<i>Đủ mẫu là bot tự nhắn, bro không cần hỏi lại.</i>',
    ];
  }

  const b = input.baseline as NonNullable<BaselineReportInput['baseline']>;
  const lines = [
    TITLE,
    '',
    `Mốc thời gian: ${input.horizon}`,
    `Scanner: ${pct(input.netPositiveMovePct)} số lần thắng ròng, trên ${input.sampleCount} lần gọi tên`,
    `Đám bị loại: ${pct(b.netPositiveMovePct)} trên ${b.sampleCount} con`,
    `Chênh lệch: ${signed(b.deltaPp)}pp${b.marginPp === null ? '' : ` (phải hơn ±${b.marginPp}pp mới coi là thật)`}`,
  ];

  if (b.medianDeltaPp !== null) {
    lines.push(`Mức biến động trung vị so với đối chứng: ${signed(b.medianDeltaPp)}pp`);
  }

  lines.push('', `<b>${verdictHeadline(b.verdict)}</b>`, verdictMeaning(b.verdict));

  const concentration = controlConcentration(b.failureCounts, b.sampleCount);
  if (concentration && concentration.sharePct >= CONCENTRATION_WARN_PCT) {
    lines.push(
      '',
      `⚠️ ${concentration.sharePct}% nhóm đối chứng bị loại vì <code>${concentration.reason}</code>.`,
      // Phrased without a direction: the same caveat applies whichever way
      // the verdict went, and an earlier version hardcoded "beats", so a
      // losing verdict was captioned "beats tokens rejected for ...".
      `Nên đây là so scanner với đám bị loại vì ${concentration.reason}, hẹp hơn nhiều so với "so với thị trường".`,
    );
  }

  return lines;
}

function verdictHeadline(verdict: BaselineVerdict): string {
  switch (verdict) {
    case 'beats':
      return 'Scanner thắng đám nó loại.';
    case 'worse':
      return 'Scanner THUA đám nó loại.';
    case 'indistinguishable':
      return 'Chênh lệch chưa đủ để kết luận.';
  }
}

function verdictMeaning(verdict: BaselineVerdict): string {
  switch (verdict) {
    case 'beats':
      return 'Chênh lệch lớn hơn sai số, nên việc chọn lọc có làm được điều gì đó mà đám bị loại không làm được. Chi phí giao dịch đã trừ ở cả hai bên.';
    case 'worse':
      return 'Mua đúng những con nó loại ra thì còn lãi hơn. Việc đúng đắn là tắt alert gem, không phải chỉnh lại trọng số — tinh chỉnh một tín hiệu đang thua chính nhóm đối chứng của nó chỉ là tối ưu hoá cái thua.';
    case 'indistinguishable':
      return 'Chênh lệch nằm trong sai số. Đây không phải bằng chứng là không có lợi thế, mà là chưa có bằng chứng cho cả hai chiều — cần thêm kết quả, hoặc một khoảng cách lớn hơn, mới nói được.';
  }
}
