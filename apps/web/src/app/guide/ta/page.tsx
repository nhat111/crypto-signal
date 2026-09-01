import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Story, Table, Takeaway, Term, Warning, Steps } from '@/components/guide/GuideBlocks';
import { GuideTabs } from '@/components/guide/GuideTabs';
import { CandleChart, CandleLegend } from '@/components/guide/CandleChart';
import {
  ATR_FIG,
  BREAKOUT,
  EMA_BASICS,
  EMA_FILTER,
  FLIP,
  NO_TRADE,
  PULLBACK,
  RSI_FIG,
  STOP_INSIDE,
  STRUCTURE,
} from '@/components/guide/taFigures';

export const metadata: Metadata = {
  title: 'Học phân tích kỹ thuật · Market Health Monitor',
  description:
    'Học đọc chart crypto spot trên khung 1D + 4H: vùng giá, EMA, RSI, ATR, cách tính cỡ lệnh và R:R, kèm ví dụ có số cụ thể.',
};

const TOC = [
  { id: 'lam-duoc-gi', label: 'TA làm được và không làm được gì' },
  { id: 'khung', label: 'Vì sao 1D + 4H' },
  { id: 'quy-trinh', label: 'Quy trình đọc chart' },
  { id: 'vung-gia', label: 'Vùng giá quan trọng' },
  { id: 'chi-bao', label: 'Chỉ ba chỉ báo' },
  { id: 'co-lenh', label: 'Cỡ lệnh — phần quan trọng nhất' },
  { id: 'dat-lenh', label: 'Đặt lệnh và giữ kỷ luật' },
  { id: 'rr', label: 'R:R và tỉ lệ thắng' },
  { id: 'vi-du-1', label: 'Ví dụ 1: mua khi hồi' },
  { id: 'vi-du-2', label: 'Ví dụ 2: phá vùng rồi test lại' },
  { id: 'vi-du-3', label: 'Ví dụ 3: khi không nên vào' },
  { id: 'vi-du-4', label: 'Ví dụ 4: vì sao TA vô dụng với gem' },
  { id: 'kiem-chung', label: 'Ghi chép và kiểm chứng' },
  { id: 'sai-lam', label: 'Sáu sai lầm hay gặp' },
  { id: 'lo-trinh', label: 'Lộ trình 7 ngày' },
];

export default function TaGuidePage() {
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Học phân tích kỹ thuật</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">
          Crypto spot, khung 1D và 4H. Mọi con số bên dưới là <Term>ví dụ minh hoạ</Term> để tập tính, không phải giá
          thật và không phải lời khuyên đầu tư.
        </p>
        <GuideTabs />
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
        <Section id="lam-duoc-gi" eyebrow="Bắt đầu từ đây" title="TA làm được và không làm được gì">
          <p>
            Phân tích kỹ thuật là dùng <Term>giá</Term> và <Term>khối lượng</Term> trong quá khứ để trả lời bốn câu:
            thị trường đang đi lên hay xuống, vùng giá nào quan trọng, lực đang mạnh hay yếu, và biên độ rung đang
            rộng hay hẹp.
          </p>
          <p>
            Nó <Term>không</Term> trả lời được &ldquo;giá ngày mai bao nhiêu&rdquo;. Cái nó cho bro là một{' '}
            <Term>kịch bản có điểm sai rõ ràng</Term>: nếu giá làm thế này thì mình đúng, nếu làm thế kia thì mình
            sai và cắt. Chỉ vậy thôi — nhưng chỉ vậy là đủ để không cháy tài khoản.
          </p>
          <Story title="Ví như dự báo thời tiết">
            <p>
              Dự báo nói &ldquo;70% khả năng mưa&rdquo;. Nó không hứa trời sẽ mưa. Nó chỉ nói mang ô là hợp lý. Nếu
              trời không mưa, dự báo đó không &ldquo;sai&rdquo; — chỉ là hôm nay rơi vào 30% kia.
            </p>
            <p>
              TA y hệt. Một setup đẹp mà thua không có nghĩa là setup sai. Chỉ khi thống kê hàng trăm lệnh mới biết
              được cái ô đó có đáng mang không.
            </p>
          </Story>
          <Warning>
            <p>
              Sai lầm lớn nhất của người mới: coi một lệnh thắng là bằng chứng phương pháp đúng. Một lệnh là{' '}
              <Term>n = 1</Term>. Nó không chứng minh được gì hết — kể cả tung đồng xu cũng thắng 50%.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="khung" eyebrow="Khung thời gian" title="Vì sao 1D + 4H">
          <Table
            head={['Khung', 'Dùng để', 'Vì sao']}
            rows={[
              [
                <Term key="a">1D (ngày)</Term>,
                'Đọc bối cảnh: đang lên, đang xuống, hay đi ngang. Vẽ các vùng giá lớn.',
                'Ít nhiễu nhất. Một cây nến 1D gói trọn một ngày tranh chấp, nên nó phản ánh quyết định của người có tiền lớn.',
              ],
              [
                <Term key="b">4H</Term>,
                'Tìm điểm vào và điểm ra, trong vài ngày.',
                'Đủ chi tiết để có entry gọn, nhưng vẫn lọc được phần lớn nhiễu của khung 15m hay 1H.',
              ],
            ]}
          />
          <p>
            Thứ tự bắt buộc: <Term>đọc 1D trước, rồi mới xuống 4H</Term>. Đảo ngược thứ tự này là cách nhanh nhất để
            mua vào giữa một xu hướng giảm mà không biết.
          </p>
          <Warning>
            <p>
              Nến 1D đóng lúc nào là tuỳ sàn. Binance chốt <Term>00:00 UTC</Term> (7 giờ sáng Việt Nam). Cùng một coin
              trên hai sàn khác múi giờ có thể ra hai cây nến 1D khác hẳn nhau. Nếu kế hoạch của bro phụ thuộc vào
              &ldquo;đóng nến 1D trên vùng X&rdquo; thì phải biết mình đang xem đồng hồ của ai.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="quy-trinh" eyebrow="Playbook" title="Quy trình đọc chart">
          <Steps
            items={[
              <>
                <Term>1D — xu hướng.</Term> Đang lên = đỉnh sau cao hơn đỉnh trước <Term>và</Term> đáy sau cao hơn đáy
                trước. Đang xuống = ngược lại. Không thấy rõ cái nào = đi ngang, và đi ngang là trạng thái phổ biến
                nhất.
              </>,
              <>
                <Term>1D — bộ lọc.</Term> Giá nằm trên đường EMA200 thì chỉ tìm lệnh mua. Nằm dưới thì đứng ngoài.
                Với spot, &ldquo;đứng ngoài&rdquo; là một lựa chọn hoàn toàn hợp lệ.
              </>,
              <>
                <Term>1D — vẽ vùng.</Term> Ba đến sáu vùng thôi. Vẽ nhiều hơn thì nhìn đâu cũng thấy tín hiệu.
              </>,
              <>
                <Term>4H — chờ setup.</Term> Chỉ có hai kiểu đáng học lúc đầu: giá hồi về vùng hỗ trợ, hoặc giá phá
                vùng kháng cự rồi quay lại test.
              </>,
              <>
                <Term>Viết ra ba con số trước khi bấm mua:</Term> giá vào, giá cắt lỗ, giá chốt lời. Chưa viết được
                thì chưa được vào.
              </>,
              <>
                <Term>Tính cỡ lệnh</Term> từ khoảng cách cắt lỗ — xem mục Cỡ lệnh. Đây là bước hay bị bỏ nhất và cũng là
                bước tốn tiền nhất khi bỏ.
              </>,
            ]}
          />
          <CandleLegend />
          <p>
            Bước 1 trông như thế này. Không cần chỉ báo nào — chỉ cần nhìn xem đỉnh và đáy có đang cao dần lên không:
          </p>
          <CandleChart
            caption="Xu hướng tăng: đỉnh 2 cao hơn đỉnh 1, và quan trọng hơn — đáy 2 cũng cao hơn đáy 1. Chỉ cần một đáy thủng đáy cũ là cấu trúc này hỏng."
            candles={STRUCTURE.candles}
            domain={STRUCTURE.domain}
            markers={STRUCTURE.markers}
          />
          <Takeaway>
            Không viết được điểm sai thì không phải là kế hoạch, mà là hy vọng.
          </Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="vung-gia" eyebrow="Nền tảng" title="Vùng giá quan trọng (hỗ trợ / kháng cự)">
          <p>
            Đây là thứ đáng học nhất, hơn mọi chỉ báo cộng lại. <Term>Hỗ trợ</Term> là vùng giá từng nhiều lần ngừng
            rơi. <Term>Kháng cự</Term> là vùng từng nhiều lần ngừng tăng.
          </p>
          <p>
            Vẽ thành <Term>vùng</Term>, không phải một đường mỏng. Vùng 98–100 chứ không phải đúng 99.0. Giá không
            tôn trọng con số lẻ của ai cả, nó chỉ phản ứng quanh một khu vực.
          </p>
          <Story title="Như cái trần và cái sàn nhà">
            <p>
              Ném bóng lên trần: nó nảy xuống. Trần là kháng cự. Nhưng nếu ném đủ mạnh làm thủng trần, thì lên tầng
              trên cái trần cũ trở thành <Term>sàn</Term> — bóng rơi xuống là nó đỡ.
            </p>
            <p>
              Đó chính là lý do vùng kháng cự bị phá thường thành hỗ trợ khi giá quay lại test, và ngược lại.
            </p>
          </Story>
          <CandleChart
            caption="Vùng 60–62 chặn giá hai lần. Đến lần thứ ba giá đóng hẳn lên trên, rồi quay lại test — và chính vùng đó đỡ giá. Cái trần cũ thành cái sàn mới."
            candles={FLIP.candles}
            domain={FLIP.domain}
            zones={FLIP.zones}
            markers={FLIP.markers}
          />
          <p>
            Về cây nến: đừng học thuộc hàng chục mẫu nến. Chỉ cần hai ý. <Term>Thân nến dài</Term> = một bên thắng
            dứt khoát. <Term>Râu nến dài</Term> = giá đã bị đẩy tới đó rồi bị từ chối. Râu dài xuất hiện{' '}
            <Term>ngay tại vùng đã vẽ</Term> mới có ý nghĩa; râu dài ở giữa khoảng trống thì chỉ là nhiễu.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="chi-bao" eyebrow="Công cụ" title="Chỉ ba chỉ báo, không hơn">
          <Table
            head={['Chỉ báo', 'Đọc thế nào', 'Bẫy']}
            rows={[
              [
                <Term key="a">EMA200 trên 1D</Term>,
                'Giá trên nó: ưu tiên tìm mua. Giá dưới: đứng ngoài.',
                'Khi thị trường đi ngang, giá cắt lên cắt xuống EMA200 liên tục. Lúc đó nó vô dụng — đừng ép nó phải nói gì.',
              ],
              [
                <Term key="b">EMA50 trên 4H</Term>,
                'Nơi giá hay hồi về trong một xu hướng tăng.',
                'Nó là nam châm, không phải bức tường. Đừng đặt cắt lỗ dựa vào nó.',
              ],
              [
                <Term key="c">RSI(14) trên 4H</Term>,
                'Trong xu hướng tăng, RSI về vùng 40–50 rồi bật lên = một nhịp hồi lành mạnh.',
                'RSI trên 70 KHÔNG phải tín hiệu bán. Trong sóng mạnh nó ở trên 70 hàng tuần. Bán vì RSI cao là cách bỏ lỡ toàn bộ đoạn ngon nhất.',
              ],
              [
                <Term key="d">ATR(14)</Term>,
                'Biên độ rung trung bình một cây nến. ATR = 5 nghĩa là mỗi 4H giá đi khoảng 5 điểm.',
                'Cắt lỗ đặt gần hơn 1× ATR rất dễ bị quét bởi dao động bình thường, kể cả khi hướng đoán đúng.',
              ],
            ]}
          />
          <h3 className="pt-2 text-base font-bold text-slate-100">EMA — đường trung bình là gì</h3>
          <p>
            Lấy giá đóng cửa của N nến gần nhất rồi tính trung bình, nến mới tính nặng hơn nến cũ. Vẽ ra thành một
            đường mượt bám theo giá. Chấm hết — không có phép màu nào ở đây.
          </p>
          <CandleChart
            caption="Hai đường trung bình trên cùng bộ nến. EMA 5 chỉ nhớ 5 nến nên bám sát giá và quay đầu sớm; EMA 15 nhớ lâu hơn nên mượt hơn và quay đầu trễ hơn. Nhớ càng lâu thì càng ít bị nhiễu đánh lừa, đổi lại càng chậm."
            candles={EMA_BASICS.candles}
            domain={EMA_BASICS.domain}
            overlays={EMA_BASICS.overlays}
            markers={EMA_BASICS.markers}
          />
          <p>
            Đó là toàn bộ khác biệt giữa EMA50 và EMA200: cùng một phép tính, khác số nến được nhớ. EMA200 trên khung
            ngày nhớ 200 ngày, nên nó gần như không rung theo tin tức — đúng thứ cần cho một bộ lọc.
          </p>
          <CandleChart
            caption="Dùng làm bộ lọc: suốt đoạn giá nằm trên đường trung bình, chỉ đi tìm lệnh mua. Khi giá đóng hẳn xuống dưới và đường bắt đầu đi xuống, trạng thái đã đổi — đứng ngoài, không cố tìm lý do mua tiếp."
            candles={EMA_FILTER.candles}
            domain={EMA_FILTER.domain}
            overlays={EMA_FILTER.overlays}
            markers={EMA_FILTER.markers}
          />
          <Warning>
            <p>
              Đường trung bình là <Term>nam châm, không phải bức tường</Term>. Giá xuyên qua nó suốt. Đừng bao giờ đặt
              cắt lỗ dựa vào EMA — cắt lỗ đặt theo vùng giá — xem mục Vùng giá quan trọng.
            </p>
          </Warning>

          <h3 className="pt-2 text-base font-bold text-slate-100">RSI — và vì sao 70 không phải tín hiệu bán</h3>
          <p>
            RSI đo <Term>trong 14 nến vừa rồi, phần tăng chiếm bao nhiêu so với phần giảm</Term>. Toàn tăng thì RSI
            gần 100, toàn giảm thì gần 0, cân bằng thì quanh 50. Nó không đo giá cao hay thấp — nó đo lực.
          </p>
          <CandleChart
            caption="Đây là lý do câu “RSI trên 70 là bán” làm mất tiền: RSI nằm trên 70 suốt 13 nến liền trong khi giá đi từ 112 lên 130. Bán ở lần đầu chạm 70 là bỏ lỡ toàn bộ đoạn đó. Đến nhịp hồi cuối, RSI mới rơi vào vùng 40–50 rồi bật lên — đó mới là tín hiệu đáng nhìn trong xu hướng tăng. Đường RSI chỉ bắt đầu từ nến thứ 15, vì trước đó chưa đủ 14 nhịp thay đổi để tính."
            candles={RSI_FIG.candles}
            domain={RSI_FIG.domain}
            markers={RSI_FIG.markers}
            pane={RSI_FIG.pane}
          />
          <Takeaway>
            RSI cao nghĩa là lực mua đang mạnh — trong xu hướng tăng đó là tin tốt, không phải lệnh bán.
          </Takeaway>

          <h3 className="pt-2 text-base font-bold text-slate-100">ATR — thị trường đang rung mạnh cỡ nào</h3>
          <p>
            ATR là <Term>biên độ trung bình của một cây nến</Term>. ATR = 5 nghĩa là mỗi nến giá thường đi qua lại
            khoảng 5 điểm. Nó không nói hướng, chỉ nói độ rung.
          </p>
          <CandleChart
            caption="Cùng một mức cắt lỗ, hai chế độ thị trường. Nửa đầu ATR quanh 1,2 — nến bé, cắt lỗ không hề bị chạm. Nửa sau ATR lên 7,6 — biên độ gấp hơn sáu lần, và cắt lỗ bị quét ngay dù mức đặt không hề đổi. Rung mạnh thì phải đặt cắt lỗ xa hơn, và theo công thức ở mục Cỡ lệnh, phải mua ít hơn."
            candles={ATR_FIG.candles}
            domain={ATR_FIG.domain}
            levels={ATR_FIG.levels}
            markers={ATR_FIG.markers}
            pane={ATR_FIG.pane}
          />

          <Takeaway>
            Chỉ báo không tạo ra tín hiệu. Nó chỉ mô tả cái mà giá đã làm. Vùng giá mới là nơi ra quyết định.
          </Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="co-lenh" eyebrow="Quan trọng nhất" title="Cỡ lệnh — phần quyết định sống chết">
          <p>
            Bản gốc của mục này thường bị bỏ qua, mà nó lại là thứ duy nhất quyết định bro còn tiền để giao dịch tiếp
            hay không. Quy tắc: <Term>mỗi lệnh chỉ được phép mất tối đa 1% tài khoản</Term>.
          </p>
          <p>Cỡ lệnh không phải do bro thích, mà do khoảng cách cắt lỗ quyết định:</p>
          <div className="rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-4 py-3.5">
            <p className="text-xs font-bold uppercase tracking-wide text-sky-300">Công thức</p>
            <p className="mt-2 font-mono text-sm leading-relaxed text-slate-100">
              Số coin mua = (Tài khoản × 1%) ÷ (Giá vào − Giá cắt lỗ)
            </p>
          </div>
          <p>
            Ví dụ: tài khoản <Term>1.000&nbsp;$</Term>, chấp nhận mất 1% là <Term>10&nbsp;$</Term>. Vào ở 103, cắt lỗ
            ở 97,5 — khoảng cách là 5,5.
          </p>
          <Table
            head={['Bước', 'Tính', 'Ra']}
            rows={[
              ['Tiền được phép mất', '1.000 × 1%', '10 $'],
              ['Khoảng cách cắt lỗ', '103 − 97,5', '5,5 / coin'],
              ['Số coin', '10 ÷ 5,5', '1,81 coin'],
              [<Term key="a">Giá trị lệnh</Term>, '1,81 × 103', <Term key="b">186 $ (≈ 19% tài khoản)</Term>],
            ]}
          />
          <Warning>
            <p>
              <Term>Công thức này có thể đòi nhiều tiền hơn bro đang có.</Term> Nó không tự biết dừng, nên bro phải
              biết.
            </p>
            <p>
              Giá trị lệnh luôn bằng <Term>1% chia cho khoảng cách cắt lỗ tính theo phần trăm</Term>. Cắt lỗ càng gần
              thì con số đó càng phình:
            </p>
          </Warning>
          <Table
            head={['Cắt lỗ cách giá vào', 'Lệnh chiếm bao nhiêu tài khoản', '']}
            rows={[
              ['10%', '10%', 'Thoải mái'],
              ['5%', '20%', 'Như ví dụ 1'],
              ['2%', '50%', 'Đã là một nửa tài khoản'],
              ['1%', '100%', 'Toàn bộ tiền mặt, không còn gì để mua coin khác'],
              [
                <Term key="a">0,5%</Term>,
                <Term key="b">200%</Term>,
                <span key="c" className="text-rose-300">Không làm được trên spot — bro không có số tiền đó</span>,
              ],
            ]}
          />
          <p>
            Khi công thức đòi quá số tiền đang có, chỉ có hai lối ra đúng: <Term>nới cắt lỗ ra chỗ thật sự phủ định
            luận điểm</Term> (rồi mua ít lại theo công thức), hoặc <Term>bỏ qua lệnh đó</Term>. Lối ra sai — và là lối
            gần như ai cũng chọn — là giữ nguyên cỡ lệnh rồi tự nhủ &ldquo;chắc không xuống tới đó đâu&rdquo;.
          </p>
          <Warning>
            <p>
              <Term>Cắt lỗ không phải lời hứa.</Term> Lệnh cắt lỗ khớp ở giá thị trường lúc chạm, không phải đúng con
              số bro đặt. Thị trường rơi nhanh thì 97,5 có thể khớp ở 96,8 — mất khoảng 1,1% thay vì đúng 1%.
            </p>
            <p>
              Nghĩa là 1% là <Term>mức thường lệ, không phải mức trần</Term>. Đó là thêm một lý do nữa để không đặt
              1% sát mép khả năng chịu đựng của mình.
            </p>
          </Warning>
          <p>
            <Term>Tài khoản nhỏ:</Term> Binance có mức đặt lệnh tối thiểu (thường khoảng 5&nbsp;$/lệnh) và bước làm
            tròn số lượng coin. Với tài khoản vài chục đô, công thức có thể ra một con số nhỏ hơn mức tối thiểu — lúc
            đó bro <Term>không</Term> ép cho đủ bằng cách mua nhiều hơn, mà chấp nhận rằng số vốn đó chưa giao dịch
            theo kỷ luật 1% được, và tập trước bằng giấy.
          </p>
          <Warning>
            <p>
              Chú ý điều ngược đời ở đây: <Term>cắt lỗ càng xa thì phải mua càng ít</Term>. Người mới thường làm
              ngược — thấy cắt lỗ xa nên sợ, bèn dời cắt lỗ lại gần cho &ldquo;an toàn&rdquo;, rồi bị quét đúng chỗ
              nhiễu.
            </p>
            <p>
              Cắt lỗ đặt ở đâu là do <Term>chart</Term> quyết định. Mua bao nhiêu là do <Term>công thức</Term> quyết
              định. Không bao giờ đổi chỗ hai việc đó cho nhau.
            </p>
          </Warning>
          <p>
            Với 1% mỗi lệnh, thua liền 10 lệnh thì tài khoản còn <Term>90%</Term>. Với 10% mỗi lệnh, thua liền 10
            lệnh thì còn <Term>35%</Term> — và từ 35% muốn về lại vốn phải lãi 186%, gần như không thể.
          </p>
          <p>
            Thua liền 10 lệnh không phải xui hiếm gặp. Với hệ thống thắng 40%, trong 100 lệnh thì{' '}
            <Term>chuỗi thua dài nhất thường rơi vào khoảng 9 lệnh liên tiếp</Term>. Đó là con số phải sống được qua,
            không phải con số để hy vọng tránh.
          </p>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="dat-lenh" eyebrow="Thực hành" title="Đặt lệnh và giữ kỷ luật">
          <Warning>
            <p>
              <Term>Đặt lệnh cắt lỗ lên sàn ngay lúc vào lệnh.</Term> Không phải ghi trong đầu, không phải &ldquo;để
              đó canh&rdquo;.
            </p>
            <p>
              Cắt lỗ nằm trong đầu là cắt lỗ không tồn tại. Lúc giá lao xuống đúng mức đó cũng là lúc bro đang ngủ,
              đang họp, hoặc đang ngồi nhìn và tự thuyết phục mình đợi thêm một nến nữa. Cả trang này sụp đổ nếu bước
              đó không được bấm.
            </p>
          </Warning>
          <p>Vào lệnh xong thì chỉ còn đúng ba kết cục, và cả ba đều đã viết ra từ trước:</p>
          <Steps
            items={[
              <>
                <Term>Chạm cắt lỗ</Term> — ra, không suy nghĩ lại. Lệnh này sai, còn tiền để đánh lệnh sau.
              </>,
              <>
                <Term>Chạm chốt lời</Term> — ra, hoặc bán một phần và dời cắt lỗ lên hoà vốn cho phần còn lại.
              </>,
              <>
                <Term>Luận điểm hỏng trước khi chạm cái nào</Term> — ví dụ giá đóng nến 4H dưới vùng hỗ trợ mà chưa
                tới giá cắt. Ra sớm cũng được, miễn là điều kiện đó đã viết ra <Term>trước</Term> khi vào lệnh.
              </>,
            ]}
          />
          <Warning>
            <p>
              Không có kết cục thứ tư tên là &ldquo;đợi thêm chút&rdquo;. Và cắt lỗ chỉ được dời <Term>theo hướng có
              lợi</Term> — lên khi đang lãi, không bao giờ xuống khi đang lỗ.
            </p>
          </Warning>
          <Takeaway>
            Chỉ giao dịch bằng số tiền mà mất hết vẫn không đổi gì trong cuộc sống của bro. Không phải tiền học, tiền
            nhà, và tuyệt đối không phải tiền đi vay.
          </Takeaway>
        </Section>

        <Section id="rr" eyebrow="Số học" title="R:R và tỉ lệ thắng — hai mặt của một đồng xu">
          <p>
            <Term>R</Term> là số tiền bro chấp nhận mất trong một lệnh. Lời gấp 3 lần số đó gọi là <Term>3R</Term>.
            Điều quan trọng: tỉ lệ thắng cần thiết <Term>phụ thuộc hoàn toàn</Term> vào R:R.
          </p>
          <Table
            head={['R:R của lệnh', 'Thắng bao nhiêu là hoà vốn', 'Nghĩa là']}
            rows={[
              ['1 : 1', '50%', 'Phải đúng hơn nửa số lần. Rất khó.'],
              ['1 : 2', '33%', 'Sai 2 trên 3 lần vẫn không mất tiền.'],
              [<Term key="a">1 : 3</Term>, <Term key="b">25%</Term>, 'Sai 3 trên 4 lần vẫn hoà. Đây là chỗ nên nhắm.'],
            ]}
          />
          <p>
            (Công thức: tỉ lệ hoà vốn = 1 ÷ (R + 1). Cứ thế mà tính, không cần nhớ bảng.)
          </p>
          <Takeaway>
            Đừng đi tìm cách &ldquo;đoán đúng nhiều hơn&rdquo;. Hãy đi tìm lệnh có R:R tốt rồi chấp nhận sai thường
            xuyên.
          </Takeaway>
          <Warning>
            <p>
              <Term>Phí giao dịch ăn vào R.</Term> Spot trên Binance khoảng 0,1% mỗi chiều, khứ hồi 0,2%. Lệnh 186&nbsp;$
              mất khoảng 0,40&nbsp;$ phí — bằng 4% của số tiền rủi ro 10&nbsp;$.
            </p>
            <p>
              Một lệnh thì không đáng kể. Nhưng 30 lệnh một tháng thì phí bằng đúng 1,2 lệnh thua. Đó là lý do đánh
              càng nhiều càng khó có lãi, chứ không phải càng nhiều càng nhanh giàu.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="vi-du-1" eyebrow="Ví dụ 1" title="Mua khi giá hồi trong xu hướng tăng">
          <p className="text-slate-400">
            Bối cảnh 1D: đỉnh sau cao hơn đỉnh trước, giá nằm trên EMA200. Hỗ trợ <Term>98–100</Term>, kháng cự{' '}
            <Term>118–120</Term>. Trên 4H, giá từ 115 hồi về 100–102, EMA50 4H quanh 101, RSI về 45 rồi bật.
          </p>
          <CandleChart
            caption="Giá lên tới 115 rồi hồi về vùng 98–100. Cây nến cuối có râu dưới dài đâm vào vùng rồi đóng cao — đó là chỗ ra quyết định. Hình dừng ở đây vì lúc thật bro cũng chỉ nhìn được tới đây."
            candles={PULLBACK.candles}
            domain={PULLBACK.domain}
            zones={PULLBACK.zones}
            levels={PULLBACK.levels}
            markers={PULLBACK.markers}
          />
          <Table
            head={['Mục', 'Giá', 'Vì sao']}
            rows={[
              ['Vào lệnh', '103', 'Sau khi có một cây nến 4H râu dưới dài tại vùng 100–102 — tức là đã có người đỡ.'],
              [
                <span key="a" className="text-rose-300">Cắt lỗ</span>,
                <Term key="b">97,5</Term>,
                'Nằm DƯỚI cả vùng hỗ trợ, không nằm trong nó.',
              ],
              ['Chốt lời 1', '118', 'Mép dưới vùng kháng cự 1D — nơi người bán đã từng chờ sẵn.'],
              ['Rủi ro', '5,5 (5,3%)', '103 − 97,5'],
              ['Lợi nhuận', '15', '118 − 103'],
              [<Term key="c">R:R</Term>, <Term key="d">1 : 2,7</Term>, 'Chỉ cần đúng 27% số lần là hoà vốn.'],
              ['Cỡ lệnh', '1,81 coin ≈ 187 $', 'Theo công thức ở mục Cỡ lệnh, tài khoản 1.000 $.'],
            ]}
          />
          <Warning>
            <p>
              <Term>Đây là chỗ bản gốc sai, và sai theo kiểu tốn tiền.</Term> Bản gốc đặt cắt lỗ ở <Term>99</Term>,
              trong khi vùng hỗ trợ là 98–100. Tức là cắt lỗ nằm <Term>bên trong</Term> chính cái vùng mình đang
              trông cậy.
            </p>
            <p>
              Giá chọc xuống 98,5 rồi bật lên là chuyện xảy ra suốt — đó chính là cách vùng hỗ trợ hoạt động. Đặt cắt
              lỗ ở 99 nghĩa là bro sẽ bị quét ra <Term>đúng lúc mình đoán đúng</Term>. Cắt lỗ phải nằm ở chỗ mà nếu
              giá tới đó thì luận điểm đã hỏng thật — tức là dưới 98.
            </p>
          </Warning>
          <CandleChart
            caption="Cùng một kịch bản, hai chỗ đặt cắt lỗ. Giá thủng xuống 98,1 rồi bật lên 107: đường 99 bị quét sạch và bro mất tiền dù đọc đúng hướng, còn đường 97,5 thì không hề bị chạm."
            candles={STOP_INSIDE.candles}
            domain={STOP_INSIDE.domain}
            zones={STOP_INSIDE.zones}
            levels={STOP_INSIDE.levels}
            markers={STOP_INSIDE.markers}
          />
          <Warning>
            <p>
              Bản gốc còn viết &ldquo;Stop: 99 (đóng 4H dưới support)&rdquo;. Đó là <Term>hai kiểu cắt lỗ khác nhau</Term>{' '}
              bị gộp làm một:
            </p>
            <p>
              <Term>Cắt theo giá</Term> — chạm 97,5 là ra ngay, đặt lệnh sẵn trên sàn. <Term>Cắt theo nến đóng</Term> —
              chỉ ra khi cây nến 4H đóng dưới vùng, chấp nhận có lúc lỗ sâu hơn dự tính.
            </p>
            <p>
              Cả hai đều dùng được. Nhưng phải <Term>chọn một trước khi vào lệnh</Term>. Đổi kiểu giữa chừng thì không
              còn là cắt lỗ nữa, mà là đang tự thuyết phục mình gồng thêm.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="vi-du-2" eyebrow="Ví dụ 2" title="Phá vùng rồi quay lại test">
          <p className="text-slate-400">
            Bối cảnh 1D: giá đi ngang trong khoảng <Term>48–50</Term> đến <Term>60–62</Term> đã nhiều tuần. EMA200
            nằm ngang — bộ lọc xu hướng đang không nói gì, và đó cũng là một thông tin.
          </p>
          <Steps
            items={[
              <>
                Một cây nến 4H đóng <Term>trên 62</Term>, tức là trên hẳn vùng kháng cự.
              </>,
              <>
                <Term>Kiểm tra khối lượng của chính cây nến đó.</Term> Nó phải cao rõ rệt so với trung bình 20 cây
                gần nhất — cỡ gấp rưỡi trở lên. Phá vùng mà khối lượng èo uột thì thường là phá giả.
              </>,
              <>Giá quay xuống test lại vùng 60–62 (giờ vùng này đóng vai hỗ trợ).</>,
              <>Xuất hiện nến 4H râu dưới tại vùng test. Đây mới là lúc vào.</>,
            ]}
          />
          <CandleChart
            caption="Cây nến phá vùng có khối lượng gấp hơn hai lần trung bình — cột xanh dưới cùng. Đó là bằng chứng có người thật sự mua, không phải giá trôi lên vì vắng người bán."
            candles={BREAKOUT.candles}
            domain={BREAKOUT.domain}
            zones={BREAKOUT.zones}
            levels={BREAKOUT.levels}
            markers={BREAKOUT.markers}
            volumes={BREAKOUT.volumes}
            volumeHighlight={BREAKOUT.volumeHighlight}
          />
          <Table
            head={['Mục', 'Giá', 'Ghi chú']}
            rows={[
              ['Vào lệnh', '63', 'Sau khi test xong và bật lên, không phải lúc vừa phá.'],
              [<span key="a" className="text-rose-300">Cắt lỗ</span>, '58,5', 'Dưới hẳn vùng 60–62. Về lại trong khoảng cũ nghĩa là cú phá đã thất bại.'],
              ['Chốt lời', '72', 'Vùng kháng cự tiếp theo trên 1D.'],
              [<Term key="b">R:R</Term>, <Term key="c">1 : 2</Term>, 'Rủi ro 4,5 — lợi nhuận 9.'],
              ['Cỡ lệnh', '2,22 coin ≈ 140 $', '10 ÷ 4,5 = 2,22'],
            ]}
          />
          <p>
            <Term>Vì sao không mua ngay lúc phá?</Term> Vì phá giả rất phổ biến: giá vọt lên qua vùng, quét hết lệnh
            cắt lỗ của người bán khống, rồi rơi ngược lại. Chờ test lại là bro trả giá cao hơn một chút để đổi lấy
            việc biết cú phá đó có thật hay không.
          </p>
          <Warning>
            <p>
              Bản gốc nhắc &ldquo;khối lượng&rdquo; ở phần mở đầu rồi không dùng lại lần nào nữa. Với setup phá vùng
              thì khối lượng chính là bằng chứng <Term>duy nhất</Term> phân biệt phá thật với phá giả. Thiếu nó thì
              setup này chỉ còn là đoán.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="vi-du-3" eyebrow="Ví dụ 3" title="Khi không nên vào lệnh">
          <p className="text-slate-400">
            1D đi ngang chặt trong 100–110. Trên 4H giá đang ở 105–106, tức là <Term>chính giữa</Term>. Nến 4H râu
            dài cả hai phía liên tục.
          </p>
          <CandleChart
            caption="Mười hai cây nến, râu dài cả hai phía, không cây nào tới gần vùng nào — giá quanh quẩn giữa 100 và 110. Nhìn thì có vẻ nhiều chuyện đang xảy ra, thực ra không có gì cả."
            candles={NO_TRADE.candles}
            domain={NO_TRADE.domain}
            zones={NO_TRADE.zones}
            markers={NO_TRADE.markers}
          />
          <p>Thử tính thì thấy ngay vì sao nên bỏ:</p>
          <Table
            head={['', 'Khoảng cách', 'Kết quả']}
            rows={[
              ['Lên tới kháng cự', '110 − 105,5 = 4,5', 'Lợi nhuận tối đa'],
              ['Xuống tới hỗ trợ', '105,5 − 100 = 5,5', 'Rủi ro'],
              [<Term key="a">R:R</Term>, '4,5 ÷ 5,5', <Term key="b">0,8 — dưới 1</Term>],
              ['Cần thắng bao nhiêu để hoà', '1 ÷ (0,8 + 1)', '56% — chưa tính phí'],
            ]}
          />
          <p>
            Vào giữa vùng là tự đặt mình vào thế phải đúng hơn một nửa số lần chỉ để không mất tiền. Đó không phải
            giao dịch, đó là đóng phí cho sàn.
          </p>
          <Takeaway>
            Không vào lệnh cũng là một quyết định, và nó là quyết định bro sẽ dùng nhiều nhất. Phần lớn thời gian
            thị trường không có gì để làm.
          </Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="vi-du-4" eyebrow="Ví dụ 4" title="Vì sao TA gần như vô dụng với gem mới">
          <p>
            Mục này không có trong bản gốc nhưng cần thiết, vì mục tiêu của bro là săn gem và làm airdrop. Ở đó phần
            lớn nội dung phía trên <Term>không áp dụng được</Term>, và biết trước điều đó tiết kiệm rất nhiều tiền.
          </p>
          <Table
            head={['TA cần', 'Coin lớn (BTC, ETH)', 'Gem mới ra 3 ngày']}
            rows={[
              ['Lịch sử giá', 'Nhiều năm', 'Vài chục cây nến. Không đủ để vẽ vùng nào cả.'],
              ['Thanh khoản', 'Hàng tỉ đô', '200 nghìn đô. Một ví bán là giá xuống 20%.'],
              ['Nhiều người tham gia', 'Hàng triệu', 'Vài trăm ví, trong đó vài ví nắm phần lớn nguồn cung.'],
              [
                'Vùng hỗ trợ có nghĩa gì',
                'Nơi nhiều người thật sự muốn mua',
                <span key="a" className="text-rose-300">Không nghĩa gì cả — chỉ là chỗ một ví ngừng bán</span>,
              ],
            ]}
          />
          <p>
            Vùng hỗ trợ chỉ có ý nghĩa khi nó đại diện cho <Term>quyết định của nhiều người độc lập</Term>. Trên một
            token mà ba ví nắm 60% nguồn cung, cái gọi là &ldquo;vùng hỗ trợ&rdquo; chỉ là chỗ một người tình cờ dừng
            tay. Ngày mai họ đổi ý thì vùng đó biến mất.
          </p>
          <Takeaway>
            Với gem, câu hỏi không phải &ldquo;vào ở đâu&rdquo; mà là &ldquo;có bị rút thảm không, và nếu mất trắng
            thì mình có sao không&rdquo;. Đó là việc của trang{' '}
            <Link href="/gems" className="font-semibold text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Gems
            </Link>{' '}
            và cột Gem Risk, không phải của chart.
          </Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="kiem-chung" eyebrow="Vòng lặp" title="Ghi chép và kiểm chứng">
          <p>
            Đọc hết trang này bro vẫn chưa biết phương pháp của mình có hiệu quả không. Chỉ có một cách biết: ghi lại
            mọi lệnh rồi đếm.
          </p>
          <p>Mỗi lần xem chart, điền đúng tám dòng này — kể cả khi quyết định không vào:</p>
          <Steps
            items={[
              'Xu hướng 1D: lên / xuống / ngang',
              'Giá so với EMA200 1D: trên / dưới',
              'Vùng hỗ trợ và kháng cự đã vẽ',
              'Setup 4H: hồi về / phá rồi test / không rõ',
              'Giá vào dự kiến',
              'Giá cắt lỗ, và cắt theo giá hay theo nến đóng',
              'Giá chốt lời, và R:R tính ra bao nhiêu',
              'Nếu bỏ qua: lý do bỏ',
            ]}
          />
          <p>
            Trang{' '}
            <Link href="/journal" className="font-semibold text-sky-300 underline decoration-sky-500/40 underline-offset-2">
              Journal
            </Link>{' '}
            trong dashboard này là chỗ để ghi. Sau 30–50 lệnh mới bắt đầu có gì đó để đọc — dưới ngưỡng đó thì con số
            nào cũng chỉ là may rủi.
          </p>
          <Warning>
            <p>
              <Term>Con số quan trọng nhất không phải tỉ lệ thắng.</Term> Nếu setup của bro thắng 60% mà coin đó
              trong cùng kỳ tăng 65% số phiên, thì setup đó <Term>tệ hơn</Term> việc mua rồi ngồi im.
            </p>
            <p>
              Luôn phải so với &ldquo;nếu không làm gì thì sao&rdquo;. Trang{' '}
              <Link href="/performance" className="font-semibold text-sky-300 underline decoration-sky-500/40 underline-offset-2">
                Performance
              </Link>{' '}
              tính sẵn cái mốc so sánh đó cho tín hiệu của hệ thống — và đó là lý do nó tồn tại.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="sai-lam" eyebrow="Cạm bẫy" title="Sáu sai lầm hay gặp">
          <Table
            head={['Sai lầm', 'Nghe như thế nào trong đầu', 'Thực tế']}
            rows={[
              [
                <Term key="a">Đổi khung để biện minh</Term>,
                '“Trên 4H thì xấu, nhưng nhìn 1H vẫn ổn mà.”',
                'Khung đã chọn lúc vào lệnh là khung duy nhất được dùng để thoát. Đổi khung giữa chừng là bỏ cắt lỗ bằng lời lẽ.',
              ],
              [
                <Term key="b">Dời cắt lỗ ra xa</Term>,
                '“Sắp chạm rồi, nới thêm chút cho nó thở.”',
                'Đây là hành động phá huỷ tài khoản nhanh nhất. Cắt lỗ chỉ được dời theo hướng có lợi, không bao giờ ngược lại.',
              ],
              [
                <Term key="c">Gấp đôi lệnh khi lỗ</Term>,
                '“Rẻ hơn thì mua thêm cho về bờ nhanh.”',
                'Bro đang tăng rủi ro đúng lúc luận điểm đã sai. Giá thấp hơn không có nghĩa là rẻ hơn.',
              ],
              [
                <Term key="d">Nhiều chỉ báo quá</Term>,
                '“Thêm MACD với Ichimoku cho chắc.”',
                'Các chỉ báo đều tính từ cùng một dữ liệu giá. Thêm chỉ báo không thêm thông tin, chỉ thêm cớ để vào lệnh.',
              ],
              [
                <Term key="e">Vào lệnh vì buồn tay</Term>,
                '“Cả tuần không có gì, chán quá.”',
                'Phí và trượt giá thì có thật, còn edge thì không. Không có setup là kết quả bình thường của một tuần bình thường.',
              ],
              [
                <Term key="f">Một lệnh thắng = phương pháp đúng</Term>,
                '“Ăn rồi, cách này chuẩn.”',
                'n = 1. Cần vài chục lệnh mới nói được gì. Cái bẫy này nguy hiểm nhất vì nó khiến bro tăng cỡ lệnh ngay trước chuỗi thua.',
              ],
            ]}
          />
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="lo-trinh" eyebrow="Thực hành" title="Lộ trình 7 ngày, không cần code">
          <Table
            head={['Ngày', 'Làm gì', 'Xong là biết']}
            rows={[
              ['1–2', 'Mở 5 chart 1D. Đánh dấu đỉnh và đáy. Ghi lên / xuống / ngang.', 'Nhận ra xu hướng mà không cần chỉ báo nào.'],
              ['3', 'Vẽ 3–6 vùng trên mỗi chart. Chỉ vùng, không vẽ đường.', 'Thấy được giá phản ứng ở đâu.'],
              ['4', 'Bật EMA200 (1D) và EMA50 (4H). Xem giá đã hồi về EMA50 bao nhiêu lần.', 'Phân biệt được hồi bình thường với đảo chiều.'],
              ['5', 'Bật RSI. Tìm những lần RSI về 40–50 trong xu hướng tăng.', 'Không còn bán vì RSI trên 70 nữa.'],
              ['6', <Term key="a">Tính cỡ lệnh cho 10 setup trong quá khứ. Chỉ tính, không vào tiền.</Term>, 'Công thức tính cỡ lệnh thành phản xạ.'],
              ['7', 'Mỗi ngày chọn 5 chart, điền đủ 8 dòng ở mục Ghi chép và kiểm chứng. Kể cả khi bỏ qua.', 'Có thói quen viết kế hoạch trước, không phải sau.'],
            ]}
          />
          <Takeaway>
            Tuần đầu không vào lệnh nào cả. Nếu 7 ngày không đặt lệnh mà thấy bứt rứt, đó là dấu hiệu cần biết về bản
            thân trước khi cần biết thêm về chart.
          </Takeaway>
          <Warning>
            <p>
              Spot không bị sàn ép bán như futures, nhưng rủi ro của spot là <Term>ôm một coin không bao giờ về
              lại</Term>. Không ai cắt lỗ hộ bro cả — cắt lỗ ở spot hoàn toàn là kỷ luật của chính mình.
            </p>
            <p>Toàn bộ trang này là nội dung học tập, không phải lời khuyên đầu tư.</p>
          </Warning>
        </Section>
      </div>
    </div>
  );
}
