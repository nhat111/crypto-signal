import type { SignalType } from './types';

/**
 * What each signal type means, in the words someone would use out loud.
 *
 * A second copy of `packages/signal-engine/src/meanings.ts`, on purpose:
 * the web app deliberately has no workspace dependencies (see the
 * duplicated types in `lib/types.ts`), and this is static copy rather
 * than a computation — a verdict is decided in one place because two
 * implementations could disagree about the answer; a sentence cannot.
 *
 * It also has to live here for a reason the engine copy cannot serve:
 * `reasons[]` is frozen into every `market_signals` row at the moment it
 * fired. Thousands of rows already carry English text and always will.
 * Rendering the meaning from `signalType` instead is the only version
 * that works retroactively — the signals list becomes readable for
 * history that was written before any of this existed.
 */
export interface SignalMeaning {
  /** One sentence: what is happening, no jargon. */
  plain: string;
  /** One sentence: what this does not mean. */
  caveat: string;
}

export const SIGNAL_MEANING: Record<SignalType, SignalMeaning> = {
  SPOT_CONFIRMED_RALLY: {
    plain:
      'Giá tăng, và người mua bằng tiền thật (mua đứt) cũng đang mua vào thật — không phải chỉ có tiền vay đẩy lên.',
    caveat: 'Nền của cú tăng này chắc hơn bình thường. Không phải lời hứa giá sẽ còn tăng.',
  },
  LEVERAGED_RALLY: {
    plain: 'Giá tăng nhưng người mua bằng tiền thật lại đang bán ra. Cú tăng này chủ yếu do tiền vay đẩy.',
    caveat: 'Không phải dự báo giá sẽ rơi. Chỉ là cú tăng mỏng chân hơn vẻ ngoài của nó.',
  },
  SHORT_COVERING_POSSIBLE: {
    plain:
      'Giá tăng trong khi số tiền đang đặt cược giảm xuống — nhiều khả năng là người đặt cược giá xuống mua lại để thoát, chứ không phải người mới nhảy vào mua.',
    caveat: 'Lực mua kiểu này hết khi người ta thoát xong. Không phải tín hiệu tăng đã được xác nhận.',
  },
  SELLING_ABSORPTION_POSSIBLE: {
    plain: 'Có lực bán ra thật, nhưng giá không rơi tương ứng — như thể có ai đó đang đỡ hàng ở dưới.',
    caveat: 'Mới là khả năng, chưa phải kết luận. Cần vài nến sau xác nhận mới biết có đỡ thật không.',
  },
  BULLISH_SPOT_DIVERGENCE: {
    plain: 'Giá đang giảm nhưng người mua bằng tiền thật vẫn mua ròng — hai bên đang lệch nhau.',
    caveat: 'Đáng để ý, không phải đảo chiều chắc chắn. Lệch như vậy có thể kéo dài rất lâu.',
  },
  LONG_LIQUIDATION: {
    plain:
      'Một loạt lệnh đặt cược giá lên bằng tiền vay vừa bị sàn ép đóng (cháy tài khoản), kéo theo bán tháo.',
    caveat: 'Đây là việc vừa xảy ra, không phải dự báo điều gì sắp tới.',
  },
  SHORT_LIQUIDATION: {
    plain:
      'Một loạt lệnh đặt cược giá xuống bằng tiền vay vừa bị sàn ép đóng, kéo theo mua vào dồn dập.',
    caveat: 'Đây là việc vừa xảy ra, không phải dự báo điều gì sắp tới.',
  },
  LONG_CROWDING: {
    plain:
      'Quá đông người đang đặt cược giá lên bằng tiền vay, và phí họ phải trả để giữ lệnh đang cao bất thường.',
    caveat:
      'Đông không có nghĩa là họ sai. Nghĩa là nếu giá quay đầu, cú rơi sẽ mạnh hơn bình thường vì nhiều người bị ép bán cùng lúc.',
  },
  SHORT_CROWDING: {
    plain:
      'Quá đông người đang đặt cược giá xuống bằng tiền vay, và họ đang phải trả phí bất thường để giữ lệnh.',
    caveat:
      'Đông không có nghĩa là họ sai. Nghĩa là nếu giá bật lên, cú bật sẽ mạnh hơn bình thường vì nhiều người bị ép mua lại cùng lúc.',
  },
  PRICE_SPIKE_UP: {
    plain:
      'Giá vừa bật lên mạnh hơn hẳn biên độ thường ngày của chính nó — một cây nến bằng nhiều cây gộp lại.',
    caveat:
      'Chỉ nói cú bật vừa xảy ra và nó bất thường về độ lớn. Không nói giá sẽ đi tiếp, và mua đuổi ngay sau một cây nến như vậy là chỗ dễ mất tiền nhất.',
  },
  PRICE_SPIKE_DOWN: {
    plain:
      'Giá vừa rơi mạnh hơn hẳn biên độ thường ngày của chính nó — một cây nến bằng nhiều cây gộp lại.',
    caveat:
      'Chỉ nói cú rơi vừa xảy ra và nó bất thường về độ lớn. Không nói giá đã chạm đáy, cũng không nói còn rơi tiếp.',
  },
};

/**
 * Prefixes the engine used to put its own interpretation line behind,
 * before the meaning moved out of `reasons` and into the table above.
 *
 * Rows written before that change still carry the line, so without this
 * the same thought would appear twice on one card — once in the reader's
 * language at the top, once in English three lines down.
 */
const LEGACY_INTERPRETATION_PREFIXES = ['Interpretation:', 'Nghĩa là:'];

/** The evidence lines, minus any interpretation the row was born with. */
export function evidenceReasons(reasons: string[]): string[] {
  return reasons.filter(
    (r) => !LEGACY_INTERPRETATION_PREFIXES.some((prefix) => r.trimStart().startsWith(prefix)),
  );
}
