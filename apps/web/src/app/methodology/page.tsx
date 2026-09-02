import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Table, Takeaway, Term, Warning, Steps } from '@/components/guide/GuideBlocks';

export const metadata: Metadata = {
  title: 'Phương pháp · Market Health Monitor',
  description:
    'Hệ thống đo gì, lấy dữ liệu từ đâu, 9 quy tắc tín hiệu, cách tính Health và Rủi ro đòn bẩy, và những giới hạn đã biết.',
};

const TOC = [
  { id: 'khong-lam', label: 'Những gì hệ thống cố ý không làm' },
  { id: 'du-lieu', label: 'Dữ liệu lấy từ đâu' },
  { id: 'luong', label: 'Luồng xử lý' },
  { id: 'health', label: 'Health và Rủi ro đòn bẩy' },
  { id: 'tin-hieu', label: '9 quy tắc tín hiệu' },
  { id: 'confidence', label: 'Confidence và Severity' },
  { id: 'hieu-qua', label: 'Đo hiệu quả' },
  { id: 'trang-thai', label: 'Độ mới dữ liệu và trạng thái' },
  { id: 'gioi-han', label: 'Giới hạn đã biết' },
  { id: 'khong-nen', label: 'Không nên dùng để' },
];

const CODE = 'rounded bg-slate-800/70 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-200';

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Phương pháp</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">
          Ứng dụng này chỉ trả lời <Term>một câu hỏi</Term>: động thái giá này được nhu cầu spot thật xác nhận, hay
          chủ yếu đến từ đòn bẩy — và rủi ro vị thế hiện tại ở mức nào?
        </p>
        <p className="mt-2 text-[15px] font-semibold text-slate-300">Nó không đưa ra lệnh mua hay bán.</p>
      </header>

      <nav className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nội dung</p>
        <ol className="mt-2.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {TOC.map((item, i) => (
            <li key={item.id} className="text-sm">
              <a href={`#${item.id}`} className="text-slate-400 transition-colors hover:text-sky-300">
                <span className="mr-2 tabular-nums text-slate-600">{i + 1}.</span>
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-14">
        {/* ---------------------------------------------------------- */}
        <Section id="khong-lam" eyebrow="Ranh giới" title="Những gì hệ thống cố ý không làm">
          <Steps
            items={[
              <>
                <Term>Nến xanh không phải lệnh mua, nến đỏ không phải lệnh bán.</Term> Tín hiệu mô tả tình hình, không
                bảo phải làm gì.
              </>,
              <>
                <Term>Không gộp Health và Rủi ro thành một điểm duy nhất.</Term> Hai trục đo hai thứ khác nhau; trung
                bình chúng lại là xoá mất thông tin.
              </>,
              <>
                <Term>Không dùng ngôn ngữ kiểu &ldquo;thị trường sắp sập&rdquo;.</Term> Tên quy tắc có chữ{' '}
                <code className={CODE}>POSSIBLE</code> là để nói thẳng rằng đó là khả năng, không phải khẳng định.
              </>,
              <>
                <Term>Không có AI trong luồng sinh tín hiệu.</Term> Chín quy tắc là ngưỡng số cố định, đọc được trong
                mã, chạy y hệt nhau mỗi lần với cùng đầu vào.
              </>,
            ]}
          />
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="du-lieu" eyebrow="Đầu vào" title="Dữ liệu lấy từ đâu">
          <Table
            head={['Cần gì', 'Lấy ở đâu', 'Lưu ý']}
            rows={[
              [
                <Term key="a">Nến spot / futures</Term>,
                'Binance kline REST + WebSocket',
                'Chỉ chấm điểm trên nến đã đóng — nến đang chạy còn thay đổi.',
              ],
              [
                <Term key="b">CVD spot / futures</Term>,
                'Khối lượng taker-buy trong dữ liệu kline',
                'Tính từ khối lượng thật, không suy ra từ màu nến.',
              ],
              [
                <Term key="c">Open Interest</Term>,
                'API OI futures Binance',
                'Sàn chỉ phục vụ khoảng 30 ngày lịch sử.',
              ],
              [<Term key="d">Funding / mark</Term>, 'Premium index và funding Binance', 'Chu kỳ thường 8 tiếng.'],
              [
                <Term key="e">Thanh lý</Term>,
                'WebSocket forceOrder',
                'Không có lịch sử toàn thị trường — mốc so sánh bất thường cần khoảng 24 giờ chạy liên tục mới vững.',
              ],
            ]}
          />
          <Takeaway>Mọi con số đều đến từ endpoint Binance. Không có số nào được mô phỏng hay ước lượng.</Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="luong" eyebrow="Đường đi" title="Luồng xử lý">
          <Steps
            items={[
              'Thu thập dữ liệu từ Binance.',
              <>
                Chuẩn hoá: nến trùng, nến lệch thứ tự, khoảng trống — tất cả quy về một{' '}
                <Term>điểm chất lượng dữ liệu</Term>.
              </>,
              'Tính chỉ báo: CVD, OI, funding, basis, bất thường khối lượng, bất thường thanh lý.',
              'Chạy 9 quy tắc tín hiệu, độc lập với nhau.',
              'Tính Health và Rủi ro đòn bẩy — hai trục riêng.',
              'Ghi vào cơ sở dữ liệu, rồi API phục vụ Web và Telegram.',
            ]}
          />
          <p>
            Web và Telegram <Term>không gọi Binance</Term>. Chúng chỉ đọc lại những gì đã được tính và ghi — nên thứ
            bro nhìn thấy luôn là thứ hệ thống thật sự đã tính, không phải một phép tính thứ hai chạy trong trình
            duyệt.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="health" eyebrow="Hai trục" title="Health và Rủi ro đòn bẩy">
          <p>
            <Term>Health (0–100)</Term> đo mức độ động thái giá được nhu cầu spot xác nhận và cấu trúc có &ldquo;sạch&rdquo;
            không. Ghép từ tám thành phần có trọng số cấu hình được:
          </p>
          <p className="font-mono text-[13px] leading-relaxed text-slate-300">
            xác nhận spot · vị thế futures · open interest · funding · thanh lý · khối lượng · cấu trúc giá · phân kỳ
          </p>
          <p>
            <Term>Rủi ro đòn bẩy (0–100)</Term> đo mức căng của vị thế vay. Sáu thành phần:
          </p>
          <p className="font-mono text-[13px] leading-relaxed text-slate-300">
            funding cực đoan · tốc độ OI · basis cực đoan · bất thường thanh lý · khối lượng cực đoan · độ đông vị thế
          </p>
          <Warning>
            <p>
              Hai trục <Term>cố ý tách rời</Term> và không bao giờ trộn. Health cao đi cùng Risk cao là chuyện bình
              thường — một cú tăng có nhu cầu spot thật xác nhận vẫn có thể đang gánh rất nhiều đòn bẩy.
            </p>
            <p>
              Trung bình hai số đó lại thành một &ldquo;điểm tổng&rdquo; sẽ biến hai sự thật khác nhau thành một con
              số không nói lên gì.
            </p>
          </Warning>
          <p>
            Với symbol <Term>chỉ có futures</Term>, không có sàn spot để so — Health hiện{' '}
            <code className={CODE}>N/A</code>. Không bịa điểm. Risk vẫn tính bình thường vì nó không cần vế spot.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="tin-hieu" eyebrow="Quy tắc" title="9 quy tắc tín hiệu">
          <p>
            Chín quy tắc chạy <Term>độc lập</Term>. Cùng lúc có thể nổ nhiều tín hiệu, và hệ thống{' '}
            <Term>không chọn ra tín hiệu thắng</Term> — mâu thuẫn giữa chúng là thông tin, không phải lỗi cần dọn.
          </p>
          <Table
            head={['Mã', 'Nổ khi', 'KHÔNG có nghĩa là']}
            rows={[
              [
                <code key="a" className={CODE}>LEVERAGED_RALLY</code>,
                'Giá tăng, spot nghiêng bán, futures nghiêng mua, OI tăng',
                'Giá sắp giảm',
              ],
              [
                <code key="b" className={CODE}>SPOT_CONFIRMED_RALLY</code>,
                'Giá tăng và CVD spot xác nhận có mua thật',
                'Lệnh mua',
              ],
              [
                <code key="c" className={CODE}>SHORT_COVERING_POSSIBLE</code>,
                'Có dấu hiệu bên short đang đóng vị thế',
                'Chắc chắn đảo chiều',
              ],
              [
                <code key="d" className={CODE}>SELLING_ABSORPTION_POSSIBLE</code>,
                'Có dấu hiệu lực bán đang bị hấp thụ',
                'Chắc chắn đã tạo đáy',
              ],
              [
                <code key="e" className={CODE}>BULLISH_SPOT_DIVERGENCE</code>,
                'Giá giảm nhưng spot vẫn mua ròng',
                'Đảm bảo sẽ đảo chiều',
              ],
              [
                <code key="f" className={CODE}>LONG_LIQUIDATION</code>,
                'Thanh lý long nổi bật so với mốc bình thường',
                'Lệnh bán',
              ],
              [
                <code key="g" className={CODE}>SHORT_LIQUIDATION</code>,
                'Thanh lý short nổi bật so với mốc bình thường',
                'Lệnh mua',
              ],
              [
                <code key="h" className={CODE}>LONG_CROWDING</code>,
                'Vị thế long đông, funding và OI cùng nghiêng',
                'Sắp sập',
              ],
              [<code key="i" className={CODE}>SHORT_CROWDING</code>, 'Vị thế short đông', 'Sắp bùng'],
            ]}
          />
          <p>
            Mỗi tín hiệu mang theo <Term>mức nghiêm trọng</Term>, <Term>độ tin cậy</Term> và một{' '}
            <Term>danh sách lý do</Term> nói rõ điều kiện nào đã kích hoạt nó. Không có tín hiệu nào xuất hiện mà
            không giải thích được vì sao.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="confidence" eyebrow="Chấm điểm" title="Confidence và Severity">
          <p>
            <Term>Confidence (0–100)</Term> ghép bốn thứ, theo đúng trọng số trong mã:
          </p>
          <Table
            head={['Thành phần', 'Trọng số', 'Nghĩa là']}
            rows={[
              ['Chất lượng dữ liệu', '25%', 'Nến thiếu, websocket lỗi, thiếu vế spot → kéo điểm xuống.'],
              ['Mức xác nhận thêm', '30%', 'Bao nhiêu điều kiện phụ cùng chỉ về một hướng.'],
              ['Biên độ vượt ngưỡng', '25%', 'Vượt ngưỡng vừa đủ khác hẳn vượt gấp ba lần.'],
              [
                'Điểm lịch sử',
                '20%',
                'Từ kết quả đã ghi được. Chưa đủ mẫu thì để trung tính, không thưởng không phạt.',
              ],
            ]}
          />
          <p>
            Tín hiệu có chữ <code className={CODE}>POSSIBLE</code> bị <Term>chặn trần confidence</Term> — dù mọi điều
            kiện đều đẹp, nó vẫn không được phép trông như một kết luận chắc chắn.
          </p>
          <p>
            <Term>Severity</Term> có mức gốc theo từng quy tắc và được nâng lên khi điều kiện nặng hơn, ví dụ funding
            ở mức cực đoan.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="hieu-qua" eyebrow="Kiểm chứng" title="Đo hiệu quả">
          <p>
            Sau mỗi tín hiệu, hệ thống ghi lại giá tại <Term>15 phút, 1 giờ, 4 giờ và 24 giờ</Term>. Trang{' '}
            <Link href="/performance" className="font-semibold text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Performance
            </Link>{' '}
            mô tả những gì đã xảy ra — không phải kỳ vọng cho tương lai.
          </p>
          <Warning>
            <p>
              Dưới <Term>30 kết quả</Term> đã ghi, hệ thống <Term>không</Term> đưa tỉ lệ thắng lên làm con số chính
              mà hiện thẳng &ldquo;chưa đủ dữ liệu&rdquo;.
            </p>
            <p>
              Lý do: với 20 mẫu, một tỉ lệ thắng 60% và một đồng xu cân bằng gần như không phân biệt được. Đưa con số
              đó ra là mời người đọc tin vào thứ chưa hề được chứng minh.
            </p>
          </Warning>
          <p>
            Dữ liệu <Term>live</Term> và dữ liệu <Term>replay</Term> (tính lại từ lịch sử) được đánh dấu tách bạch.
            Tín hiệu replay không có dữ liệu thanh lý, nên hai loại không thể trộn chung khi so sánh.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="trang-thai" eyebrow="Vận hành" title="Độ mới dữ liệu và trạng thái">
          <Table
            head={['Thuật ngữ', 'Nghĩa là']}
            rows={[
              ['Tuổi snapshot', 'Bao lâu kể từ lần tính Health gần nhất cho symbol đó.'],
              ['Chất lượng dữ liệu', 'Nến thủng lỗ, websocket lỗi, thiếu vế spot hoặc futures.'],
              ['Nhịp tim worker', 'Tiến trình thu dữ liệu còn sống hay không — nó không mở cổng HTTP nào.'],
              ['WS degraded', 'Một trong ba socket (spot / futures / thanh lý) chưa mở.'],
              ['Nhịp tim cũ', 'Khoảng 3 phút không có nhịp — hệ thống báo đỏ.'],
            ]}
          />
          <p>
            Tất cả nằm ở trang{' '}
            <Link href="/status" className="font-semibold text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Status
            </Link>
            , đọc được từ điện thoại, không cần terminal.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="gioi-han" eyebrow="Đọc kỹ" title="Giới hạn đã biết">
          <Table
            head={['Giới hạn', 'Hệ quả thực tế']}
            rows={[
              [
                <Term key="a">Thanh lý chỉ có realtime</Term>,
                'Khoảng 24 giờ đầu sau khi khởi động, mốc so sánh bất thường chưa vững.',
              ],
              [
                <Term key="b">Lịch sử OI ~30 ngày</Term>,
                'Sàn chỉ phục vụ chừng đó, nên phần tính lại từ lịch sử không thể đi xa hơn.',
              ],
              [
                <Term key="c">Mới bật hệ thống</Term>,
                'Chưa có snapshot, chưa có nhịp tim — đó KHÔNG phải là "thị trường ổn định".',
              ],
              [<Term key="d">Symbol chỉ futures</Term>, 'Không có Health score. Risk vẫn dùng được.'],
              [<Term key="e">Chỉ tập trung Binance</Term>, 'Luồng chính không đọc sàn khác.'],
              [
                <Term key="f">Gem scanner</Term>,
                'Nếu bật, đó là hệ con riêng với rủi ro DEX riêng — không trộn vào Health của Binance.',
              ],
              [<Term key="g">Ngưỡng dùng chung</Term>, 'Các khung thời gian hiện dùng chung một bộ ngưỡng.'],
            ]}
          />
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="khong-nen" eyebrow="Cảnh báo" title="Không nên dùng để">
          <Steps
            items={[
              <>Coi tín hiệu như <Term>điểm vào lệnh hoặc thoát lệnh</Term>.</>,
              <>Bỏ qua nhãn <Term>dữ liệu cũ</Term> hoặc <Term>chất lượng thấp</Term> — chúng có mặt là có lý do.</>,
              <>
                So Health của symbol có spot với symbol chỉ có futures như thể chúng cùng thang. Một bên có điểm, một
                bên <code className={CODE}>N/A</code>.
              </>,
              <>Coi kết quả quá khứ là dự báo tương lai.</>,
            ]}
          />
          <Takeaway>
            Quy tắc xác định sẵn, có lý do giải thích, không có AI trong luồng tín hiệu.
          </Takeaway>
          <p className="text-sm text-slate-500">
            Xem thêm:{' '}
            <Link href="/performance" className="text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Performance
            </Link>{' '}
            ·{' '}
            <Link href="/status" className="text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Status
            </Link>{' '}
            ·{' '}
            <Link href="/guide" className="text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Guide
            </Link>
          </p>
        </Section>
      </div>
    </div>
  );
}
