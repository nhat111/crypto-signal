import type { SignalType } from './types.js';

/**
 * What each signal type means, in the words someone would use out loud.
 *
 * The `reasons[]` on a signal are evidence: numbers, thresholds, which
 * checks held. They are precise and they are unreadable to anyone who
 * does not already know what "CVD skew" is — which is the person this
 * dashboard was built for. Evidence without a plain sentence beside it
 * does not explain anything; it only proves the engine was not guessing.
 *
 * `caveat` is not decoration. Every one of these patterns is routinely
 * read as a buy or sell instruction, and none of them is one. The single
 * most common way a beginner loses money here is reading "absorption" as
 * "it is going up" — so what the signal does *not* say travels with it
 * everywhere the signal goes.
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
    plain:
      'Giá tăng nhưng người mua bằng tiền thật lại đang bán ra. Cú tăng này chủ yếu do tiền vay đẩy.',
    caveat: 'Không phải dự báo giá sẽ rơi. Chỉ là cú tăng mỏng chân hơn vẻ ngoài của nó.',
  },
  SHORT_COVERING_POSSIBLE: {
    plain:
      'Giá tăng trong khi số tiền đang đặt cược giảm xuống — nhiều khả năng là người đặt cược giá xuống mua lại để thoát, chứ không phải người mới nhảy vào mua.',
    caveat: 'Lực mua kiểu này hết khi người ta thoát xong. Không phải tín hiệu tăng đã được xác nhận.',
  },
  SELLING_ABSORPTION_POSSIBLE: {
    plain:
      'Có lực bán ra thật, nhưng giá không rơi tương ứng — như thể có ai đó đang đỡ hàng ở dưới.',
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
