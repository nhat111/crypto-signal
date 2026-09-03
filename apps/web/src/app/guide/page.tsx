import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Story, Table, Takeaway, Term, Warning, Steps } from '@/components/guide/GuideBlocks';
import { GuideTabs } from '@/components/guide/GuideTabs';

export const metadata: Metadata = {
  title: 'Guide · Market Health Monitor',
  description: 'Giải thích mọi con số trên dashboard bằng ví dụ đời thường, không cần biết gì về trading từ trước.',
};

const TOC = [
  { id: 'lam-gi', label: 'Hệ thống này làm gì' },
  { id: 'tien-that', label: 'Tiền thật và tiền vay' },
  { id: 'overview', label: 'Trang Overview' },
  { id: 'signals', label: 'Trang Signals' },
  { id: 'performance', label: 'Trang Performance' },
  { id: 'gems', label: 'Trang Gems' },
  { id: 'journal', label: 'Trang Journal' },
  { id: 'tu-dien', label: 'Từ điển' },
];

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Đọc dashboard</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">
          Giải thích mọi con số trên trang này bằng ví dụ đời thường. Không cần biết gì về trading từ trước.
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
        <Section id="lam-gi" eyebrow="Bắt đầu từ đây" title="Hệ thống này làm gì?">
          <p>
            Nó theo dõi <Term>ai đang thật sự mua bán</Term> phía sau một cú tăng giá — chứ không đoán giá sẽ lên hay
            xuống.
          </p>
          <p>
            Nói cách khác: khi giá Bitcoin tăng, câu hỏi không phải &ldquo;tăng bao nhiêu nữa?&rdquo; mà là{' '}
            <Term>&ldquo;cú tăng này có chắc chân không?&rdquo;</Term>
          </p>
          <Warning>
            <p>
              Hệ thống này <Term>không bao giờ</Term> bảo bro mua hay bán. Nó chỉ mô tả tình hình. Quyết định là của
              bro.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="tien-that" eyebrow="Khái niệm nền" title="Tiền thật và tiền vay">
          <p>Muốn hiểu mọi thứ còn lại thì phải hiểu chỗ này trước. Có hai kiểu mua coin:</p>
          <Table
            head={['Kiểu mua', 'Nghĩa là', 'Gọi là']}
            rows={[
              [
                <Term key="a">Mua đứt</Term>,
                'Bỏ tiền mặt ra mua, ôm coin về ví. Giá xuống thì lỗ, nhưng không ai ép bán.',
                <span key="b" className="text-emerald-300">Spot</span>,
              ],
              [
                <Term key="c">Mua bằng tiền vay</Term>,
                'Đặt cọc một ít, vay sàn để đánh cược số lớn. Giá đi ngược là bị sàn ép bán sạch.',
                <span key="d" className="text-amber-300">Futures / đòn bẩy</span>,
              ],
            ]}
          />
          <Story title="Ví dụ: giá nhà trong xóm">
            <p>Giá nhà trong xóm tăng 20%. Tin vui đúng không? Còn tùy ai đang mua.</p>
            <p>
              Nếu người ta <Term>trả tiền mặt</Term> để mua — giá tăng đó có nền. Không ai ép họ bán cả.
            </p>
            <p>
              Nếu ai cũng <Term>vay ngân hàng</Term> để mua — chỉ cần ngân hàng siết nợ là cả xóm bán tháo cùng lúc,
              giá rơi tự do.
            </p>
            <p>Giá y hệt nhau. Nhưng hai tình huống hoàn toàn khác nhau.</p>
          </Story>
          <Takeaway>
            Cả hệ thống này sinh ra chỉ để trả lời: cú tăng đang diễn ra là loại &ldquo;tiền mặt&rdquo; hay loại
            &ldquo;vay ngân hàng&rdquo;.
          </Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="overview" eyebrow="Trang chính" title="Trang Overview — hai điểm số">
          <p>
            Mỗi đồng coin có hai điểm số, mỗi điểm từ <Term>0 đến 100</Term>. Hai điểm này <Term>độc lập</Term> — đừng
            cộng, đừng trừ, đừng gộp lại.
          </p>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Health — &ldquo;có bao nhiêu tiền mặt?&rdquo;</h3>
          <p>
            Điểm càng cao nghĩa là cú tăng càng được người mua đứt (tiền mặt) ủng hộ. Điểm thấp nghĩa là giá đang lên
            chủ yếu nhờ tiền vay.
          </p>
          <Table
            head={['Điểm', 'Chữ hiện trên màn hình', 'Đọc là']}
            rows={[
              ['80 – 100', <span key="a" className="text-emerald-300">VERY_HEALTHY</span>, 'Người mua tiền mặt đang dẫn dắt'],
              ['65 – 79', <span key="b" className="text-emerald-300">HEALTHY</span>, 'Khá chắc chân'],
              ['50 – 64', <span key="c" className="text-slate-400">NEUTRAL</span>, 'Bình thường. Đa số thời gian nằm ở đây'],
              ['35 – 49', <span key="d" className="text-amber-300">WEAK</span>, 'Giá và người mua thật đang lệch nhau'],
              ['0 – 34', <span key="e" className="text-rose-300">VERY_WEAK</span>, 'Gần như không có nền tiền mặt'],
            ]}
          />
          <Warning>
            <p>
              Health 80 <Term>không</Term> nghĩa là &ldquo;80% khả năng giá lên&rdquo;. Nó chỉ nói cú tăng này chắc
              chân. Chắc chân vẫn có thể rơi — chỉ là rơi vì lý do khác, không phải vì nó rỗng ruột từ đầu.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Risk — &ldquo;có bao nhiêu người đang vay nợ?&rdquo;</h3>
          <p>
            Điểm này <Term>ngược chiều</Term>: 0 là an toàn nhất, 100 là căng nhất. Nó đo mức độ nhiều người đang dùng
            tiền vay để đánh cược.
          </p>
          <Table
            head={['Điểm', 'Đọc là']}
            rows={[
              ['15 – 30', 'Bình thường. Đây là mức hay gặp nhất'],
              ['30 – 70', 'Đòn bẩy đang tăng dần'],
              ['70 – 100', 'Rất nhiều người đang vay nợ đánh cược'],
            ]}
          />
          <Warning>
            <p>
              Risk cao <Term>không</Term> nghĩa là sắp giảm. Nó nghĩa là: <Term>nếu</Term> có cú đảo chiều, cú đó sẽ
              mạnh hơn bình thường — vì nhiều người vay nợ bị ép bán cùng một lúc.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Đọc hai điểm cùng lúc</h3>
          <Table
            head={['', 'Risk thấp', 'Risk cao']}
            rows={[
              [
                <Term key="a">Health cao</Term>,
                'Tiền mặt dẫn dắt, ít người vay nợ. Trạng thái yên tâm nhất — và hiếm nhất.',
                'Tiền mặt có thật, nhưng người vay nợ cũng đã chất lên theo. Rung lắc sẽ mạnh.',
              ],
              [
                <Term key="b">Health thấp</Term>,
                'Chẳng ai đặc biệt tin, cũng chẳng ai cược lớn. Thường là thị trường đi ngang.',
                'Giá lên nhờ tiền vay là chính. Đây là ô đáng dè chừng nhất.',
              ],
            ]}
          />
          <Takeaway>Đọc hai điểm như một cặp. Gộp thành một số là mất đúng cái ô nguy hiểm nhất.</Takeaway>
                  <Warning>
            <p>
              Có coin hiện <Term>N/A</Term> ở ô Health Score — HYPE chẳng hạn. Đó <Term>không phải lỗi</Term> và cũng
              không phải &ldquo;chưa có dữ liệu&rdquo;.
            </p>
            <p>
              Health Score trả lời đúng một câu: <Term>người mua bằng tiền thật có xác nhận cú tăng này không</Term> —
              tức là so sàn thường với sàn đòn bẩy. HYPE chỉ có trên sàn đòn bẩy của Binance, không có sàn thường. Không
              có vế để so thì câu hỏi đó không có câu trả lời, và bịa ra một con số còn tệ hơn là nói không biết.
            </p>
            <p>
              Risk Score của mấy coin đó vẫn tính bình thường và vẫn dùng được — nó không cần vế sàn thường.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="signals" eyebrow="Trang Signals" title="Tín hiệu là gì?">
          <p>
            Tín hiệu là <Term>lời mô tả tình hình</Term>, không phải lệnh mua bán. Hệ thống có đúng 9 kiểu, không hơn.
            Mỗi kiểu bật lên khi một tổ hợp điều kiện cụ thể xảy ra.
          </p>
          <Table
            head={['Tên tín hiệu', 'Nghĩa dễ hiểu']}
            rows={[
              ['SPOT_CONFIRMED_RALLY', 'Giá lên và người mua tiền mặt cũng đang mua vào. Cú tăng có nền.'],
              ['LEVERAGED_RALLY', 'Giá lên nhưng người mua tiền mặt đang bán ra. Chỉ có tiền vay đẩy lên.'],
              ['BULLISH_SPOT_DIVERGENCE', 'Giá đang giảm mà người mua tiền mặt vẫn gom. Đáng để ý.'],
              ['SELLING_ABSORPTION_POSSIBLE', 'Có người bán ra nhiều mà giá không giảm. Có vẻ ai đó đang đỡ giá.'],
              ['SHORT_COVERING_POSSIBLE', 'Giá lên vì người cược giảm đang tháo chạy, không phải vì có người tin giá lên.'],
              ['LONG_LIQUIDATION', 'Vừa có một đợt cháy tài khoản hàng loạt ở phe cược tăng.'],
              ['SHORT_LIQUIDATION', 'Vừa có một đợt cháy tài khoản hàng loạt ở phe cược giảm.'],
              ['LONG_CROWDING', 'Quá đông người cược giá lên. Đông quá thì dễ đạp.'],
              ['SHORT_CROWDING', 'Quá đông người cược giá xuống.'],
            ]}
          />

          <h3 className="pt-2 text-lg font-bold text-slate-100">Hai con số đi kèm mỗi tín hiệu</h3>
          <Table
            head={['Con số', 'Nghĩa']}
            rows={[
              [
                <Term key="a">Severity</Term>,
                'Mức đáng chú ý của sự việc. Từ thấp tới cao: INFO → LOW → MEDIUM → HIGH → EXTREME.',
              ],
              [
                <Term key="b">Độ tin cậy</Term>,
                'Mức độ rõ ràng của tín hiệu: dữ liệu có đầy đủ không, điều kiện khớp bao nhiêu cái, vượt ngưỡng bao xa.',
              ],
              [
                <Term key="c">Chip &ldquo;kém hơn mức nền&rdquo;</Term>,
                'Loại tín hiệu này đã được đo và kết luận là đi kém hơn cả khi không làm gì. Chi tiết ở banner vàng đầu danh sách, và ở mục Trang Performance bên dưới.',
              ],
            ]}
          />
          <Warning>
            <p>
              Độ tin cậy 78 <Term>không</Term> nghĩa là &ldquo;78% đúng&rdquo;. Nó chỉ nghĩa là tín hiệu này rõ ràng,
              dữ liệu sạch. Một tín hiệu rất rõ ràng vẫn có thể sai.
            </p>
            <p>
              Muốn biết một loại tín hiệu có &ldquo;ăn&rdquo; hay không thì phải xem{' '}
              <a href="#performance" className="text-sky-400 underline underline-offset-2 hover:text-sky-300">
                Trang Performance
              </a>
              . Độ tin cậy nói về <Term>một lần</Term> tín hiệu bật; Performance nói về <Term>cả nghìn lần</Term>.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="performance" eyebrow="Trang Performance" title="Mấy tín hiệu này có ăn thua gì không?">
          <Story title="Ông hàng xóm đoán mưa">
            <p>
              Có ông hàng xóm hay nói &ldquo;chiều nay mưa đó&rdquo;. Bro ghi lại 100 lần ông nói. Ông đúng{' '}
              <Term>60 lần</Term>. Nghe giỏi ha?
            </p>
            <p>
              Khoan. Đang mùa mưa, chiều nào trời cũng mưa. Trong 100 buổi chiều đó, trời <Term>tự mưa 60 buổi</Term>{' '}
              — chẳng cần ai đoán.
            </p>
            <p>
              Vậy ông giỏi không? <Term>Không.</Term> Ông đoán ngang với việc nhắm mắt nói &ldquo;mưa&rdquo; mỗi ngày.
            </p>
          </Story>
          <p>Trang Performance làm đúng chuyện đó với 9 tín hiệu ở trên.</p>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Trên màn hình có gì</h3>
          <Table
            head={['Thấy gì', 'Là gì']}
            rows={[
              [
                <Term key="a">Khung xanh trên cùng — &ldquo;Baseline&rdquo;</Term>,
                'Đây là "trời tự mưa bao nhiêu %". Tức là: nếu mua bừa vào một lúc ngẫu nhiên, không nhìn tín hiệu gì hết, thì bao nhiêu lần giá đi lên? Bốn ô: Tăng, Trung vị, và hai ô "đủ bù phí" (xem mục phí bên dưới).',
              ],
              [<Term key="b">Chín cái thẻ</Term>, 'Mỗi thẻ là một "ông hàng xóm" — một kiểu tín hiệu.'],
              [<Term key="c">Tăng</Term>, 'Bao nhiêu % số lần giá lên sau đó. Là số LẦN, không phải lên bao nhiêu tiền.'],
              [<Term key="d">Giảm</Term>, 'Bao nhiêu % số lần giá xuống.'],
              [
                <Term key="e">Trung vị</Term>,
                'Lên/xuống bao nhiêu, lấy mức Ở GIỮA. Xếp hết các lần theo thứ tự rồi lấy cái nằm chính giữa — để một lần trúng đậm không kéo cả bảng lên trông đẹp giả tạo.',
              ],
              [
                <Term key="f">Khối &ldquo;so với baseline&rdquo;</Term>,
                'Ông này hơn hay kém việc đoán bừa. ĐÂY LÀ KHỐI QUAN TRỌNG NHẤT.',
              ],
              [
                <Term key="g">Khối &ldquo;sau phí&rdquo;</Term>,
                'Trừ tiền phí ra thì còn lại bao nhiêu. Có mục riêng bên dưới.',
              ],
            ]}
          />
          <Warning>
            <p>
              Đừng nhìn ô <Term>Tăng 58%</Term> trước. Con số đó một mình không nói lên gì — y như biết &ldquo;ông
              đúng 60 lần&rdquo; mà chưa biết trời tự mưa mấy lần.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Khối &ldquo;so với baseline&rdquo; nói gì</h3>
          <p>Chỉ có đúng ba câu trả lời. Không có câu thứ tư.</p>
          <Table
            head={['Màu + chữ', 'Nghĩa thật', 'Nên làm gì']}
            rows={[
              [
                <span key="a" className="font-semibold text-emerald-300">
                  Xanh — &ldquo;Tốt hơn baseline một cách rõ rệt&rdquo;
                </span>,
                'Có bằng chứng thật là hơn việc mua bừa.',
                'Đọc tiếp khối "sau phí" trước khi kết luận là giao dịch được.',
              ],
              [
                <span key="b" className="font-semibold text-rose-300">
                  Đỏ — &ldquo;Kém hơn baseline một cách rõ rệt&rdquo;
                </span>,
                'Có bằng chứng thật là TỆ HƠN cả việc không làm gì.',
                'Đừng dùng cái này làm lý do vào lệnh.',
              ],
              [
                <span key="c" className="font-semibold text-slate-400">
                  Xám — &ldquo;Chưa phân biệt được&rdquo;
                </span>,
                'Chưa đủ bằng chứng để nói hơn hay kém. KHÔNG phải là "xấu".',
                'Chờ thêm mẫu. Trang có ghi luôn cần khoảng bao nhiêu mẫu nữa.',
              ],
            ]}
          />
          <Warning>
            <p>
              Thẻ <Term>đỏ</Term> không có nghĩa là &ldquo;vậy làm ngược lại thì lời&rdquo;. Nó chỉ nói: đừng lấy tín
              hiệu này làm lý do vào lệnh. Làm ngược lại là một cú cược khác, chưa ai đo.
            </p>
            <p>
              Thẻ <Term>xám</Term> không có nghĩa là tín hiệu dở. Nó nghĩa là <Term>chưa biết</Term> — hai chuyện
              hoàn toàn khác nhau.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Con số &ldquo;±3pp&rdquo; là gì?</h3>
          <Story title="Cái cân ở chợ">
            <p>
              Bro cân con gà, cân báo <Term>2kg</Term>. Nhưng cái cân đó sai số nửa lạng. Nên con gà thật ra nặng đâu
              đó từ <Term>1,95kg đến 2,05kg</Term>.
            </p>
            <p>
              Giờ có người nói &ldquo;con gà của tôi 2,02kg, nặng hơn của bro&rdquo;. Nặng hơn thật không? Không biết
              được — chênh lệch còn nhỏ hơn cả sai số của cân.
            </p>
          </Story>
          <p>
            <Term>±pp</Term> chính là &ldquo;sai số của cái cân&rdquo;. Thẻ ghi{' '}
            <Term>&ldquo;+2pp tỉ lệ đúng (±3pp)&rdquo;</Term> nghĩa là: đo được hơn 2 điểm, nhưng cây thước sai tới 3
            điểm — nên chưa kết luận được gì.
          </p>
          <Table
            head={['Thẻ ghi', 'Kết luận']}
            rows={[
              ['+2pp (±3pp)', 'Xám. Chênh lệch nhỏ hơn sai số.'],
              ['+7pp (±3pp)', 'Xanh. Chênh lệch vượt hẳn sai số.'],
              ['−3pp (±1pp)', 'Đỏ. Kém hơn, và kém chắc chắn.'],
            ]}
          />
          <p>
            Sai số nhỏ lại khi <Term>số mẫu tăng lên</Term>. Đó là lý do một thẻ 900 mẫu có thể kết luận với chênh
            lệch 3 điểm, còn thẻ 60 mẫu thì chênh 15 điểm vẫn chưa nói được gì.
          </p>

          <h3 className="pt-2 text-lg font-bold text-slate-100">
            Vì sao có dòng &ldquo;N thẻ đang cùng đưa ra kết luận&rdquo;
          </h3>
          <Story title="Chín người cùng tung đồng xu">
            <p>
              Cho 9 người, mỗi người tung đồng xu 10 lần. Kiểu gì cũng có <Term>ít nhất một người</Term> ra 8 lần
              ngửa. Người đó có tay ăn may không? Không. Chỉ là <Term>tung nhiều lượt thì kiểu gì cũng có lượt dị
              thường</Term>.
            </p>
            <p>Giờ nếu bro chỉ nhìn đúng người ra 8 ngửa và kết luận &ldquo;anh này có biệt tài&rdquo; — bro bị lừa.</p>
          </Story>
          <p>
            Trang này bày 9 thẻ cùng lúc, mắt bro tự động dừng ở thẻ có màu. Nếu mỗi thẻ đều dùng một cây thước
            &ldquo;sai 1 lần trên 20&rdquo;, thì gần như <Term>mỗi lần mở trang sẽ có một thẻ ăn may bị tô màu</Term>.
          </p>
          <p>
            Nên trang <Term>nới cây thước rộng ra</Term> theo số thẻ đang cùng kết luận. Càng nhiều thẻ cùng đưa ra
            kết luận, ±pp càng lớn, càng khó được tô màu. Đó là lý do con số ±pp có thể đổi khi số thẻ đủ mẫu thay
            đổi.
          </p>
          <Warning>
            <p>
              Trang chỉ trừ hao được số thẻ <Term>trên một màn hình</Term>. Bro bấm qua lại 15m → 1h → 4h → 24h để tìm
              thẻ xanh thì đang tự mở rộng số lượt tung xu, và không ai trừ hao chỗ đó. Chọn khung thời gian{' '}
              <Term>trước</Term> khi xem, đừng chọn sau khi thấy màu.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Khối &ldquo;sau phí&rdquo; — cái bẫy chết người</h3>
          <Story title="Bán trà đá">
            <p>
              Bro bán một ly trà đá lời <Term>500 đồng</Term>. Ngày bán 100 ly, lời 50 nghìn. Nghe ổn.
            </p>
            <p>
              Nhưng mỗi ngày đi lấy đá tốn <Term>60 nghìn tiền xăng</Term>. Bán càng nhiều càng lỗ.
            </p>
            <p>&ldquo;Có lời&rdquo; và &ldquo;lời đủ bù chi phí&rdquo; là hai chuyện khác nhau.</p>
          </Story>
          <p>
            Mỗi lần vào rồi ra một lệnh, sàn ăn khoảng <Term>0,1%</Term> (phí hai chiều cộng chênh lệch mua/bán). Mà{' '}
            <Term>trung vị của baseline ở khung 4h chỉ khoảng +0,05%</Term>.
          </p>
          <p>
            Nghĩa là: một lần giá nhích lên <Term>0,02%</Term> vẫn được đếm là &ldquo;Tăng&rdquo; ở ô trên cùng — mà
            thực tế vào lệnh lần đó là <Term>lỗ</Term>.
          </p>
          <Table
            head={['Thẻ ghi', 'Nghĩa']}
            rows={[
              [<Term key="a">54% đủ lãi khi long</Term>, 'Chỉ 54% số lần giá lên ĐỦ XA để bù phí. Phần còn lại: đúng hướng nhưng vẫn lỗ.'],
              [
                <Term key="b">41% đủ lãi khi short</Term>,
                'Tương tự cho chiều xuống. Có ô này vì bán khống cũng trả phí y hệt — tín hiệu báo trước cú giảm vẫn dùng được.',
              ],
              [
                <Term key="c">Baseline sau phí: 45% / 44%</Term>,
                'Mức nền, cũng đã trừ phí. So thẻ với dòng này, đừng so với 0%.',
              ],
            ]}
          />
          <Warning>
            <p>
              Một thẻ có thể <Term>xanh ở khối trên</Term> mà vẫn không đáng đánh, nếu khối &ldquo;sau phí&rdquo; của
              nó không hơn baseline sau phí. Khối trên trả lời &ldquo;tín hiệu có nhìn thấy gì không&rdquo;; khối dưới
              trả lời &ldquo;có đáng vào lệnh không&rdquo;. Hai câu hỏi khác nhau.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Cách đọc, theo thứ tự</h3>
          <Steps
            items={[
              'Chọn khung thời gian và nguồn dữ liệu TRƯỚC. Đừng đổi sau khi thấy màu.',
              'Nhìn khung xanh baseline — không làm gì thì được bao nhiêu %?',
              'Quét 9 thẻ, chỉ đọc khối "so với baseline" và con số ±pp.',
              'Thẻ nào xanh hoặc đỏ mới đọc tiếp. Thẻ xám là "chưa biết", bỏ qua.',
              'Với thẻ xanh: đọc khối "sau phí", so với baseline sau phí.',
              'Cuối cùng mới liếc số mẫu ở đáy thẻ.',
            ]}
          />

          <h3 className="pt-2 text-lg font-bold text-slate-100">Khi nào tin được con số?</h3>
          <Story title="Tung đồng xu">
            <p>
              Tung đồng xu 10 lần, ra 7 lần ngửa. Đồng xu bị lệch à? Không, chuyện thường thôi. Tung{' '}
              <Term>1000 lần</Term> mà ra 700 ngửa — lúc đó mới lạ.
            </p>
            <p>Số lần thử càng ít thì càng dễ ăn may.</p>
          </Story>
          <Table
            head={['Đã chạy được', 'Tin được chưa?']}
            rows={[
              ['Dưới 30 lần', 'Trang không thèm hiện số. Nó ghi "Chưa đủ dữ liệu".'],
              ['53 lần, đúng 55%', 'Giống tung xu 53 lần ra 29 ngửa. ±pp sẽ rất to, thẻ ra xám.'],
              ['Vài nghìn lần', 'Lúc đó mới nói chuyện được.'],
            ]}
          />
          <p>
            Mốc 30 chỉ là ngưỡng để <Term>hiện</Term> số ra, chưa phải ngưỡng để <Term>tin</Term>. Cái quyết định tin
            hay không là <Term>±pp</Term>, không phải con số 30.
          </p>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Nút Quan sát / Replay / Cả hai</h3>
          <Table
            head={['Nút', 'Nghĩa']}
            rows={[
              [<Term key="a">Quan sát</Term>, 'Dữ liệu hệ thống tận mắt ghi lại lúc nó đang chạy. Mặc định.'],
              [
                <Term key="b">Replay</Term>,
                'Hệ thống chạy lại trên dữ liệu quá khứ để có nhiều lần thử hơn, nhanh hơn.',
              ],
              [<Term key="c">Cả hai</Term>, 'Gộp chung.'],
            ]}
          />
          <Warning>
            <p>
              Khi bật <Term>Replay</Term> hoặc <Term>Cả hai</Term>, hai thẻ <Term>Long Liquidation</Term> và{' '}
              <Term>Short Liquidation</Term> sẽ hiện &ldquo;chưa có tín hiệu nào&rdquo;.
            </p>
            <p>
              Đó <Term>không phải</Term> &ldquo;chuyện này chưa từng xảy ra&rdquo;. Đó là{' '}
              <Term>&ldquo;không đo được&rdquo;</Term> — sàn Binance không lưu lại lịch sử cháy tài khoản, nên chạy
              lại quá khứ thì không có dữ liệu đó.
            </p>
          </Warning>

          <h3 className="pt-2 text-lg font-bold text-slate-100">Kết luận đi theo bro ra ngoài trang này</h3>
          <p>
            Không ai mở trang Performance đúng lúc một tín hiệu đang nổ. Nên khi một loại tín hiệu bị kết luận{' '}
            <Term>kém hơn mức nền</Term>, hệ thống mang kết luận đó theo:
          </p>
          <Table
            head={['Ở đâu', 'Thấy gì']}
            rows={[
              [<Term key="a">Trang Signals</Term>, 'Banner vàng đầu danh sách + chip "KÉM HƠN MỨC NỀN" cạnh tên loại.'],
              [<Term key="b">Trang symbol</Term>, 'Y hệt, trong danh sách tín hiệu của mã đó.'],
              [<Term key="c">Alert Telegram</Term>, 'Một dòng ⚠️ ở cuối tin nhắn, kèm số mẫu và khung thời gian.'],
            ]}
          />
          <p>
            Kết luận này luôn lấy ở <Term>khung 4h</Term>, nguồn <Term>Cả hai</Term>, cố định — không phải chọn khung
            nào đẹp nhất cho từng loại. Cập nhật lại mỗi giờ.
          </p>
          <Warning>
            <p>
              Hệ thống <Term>không bao giờ</Term> gắn nhãn xanh &ldquo;loại này ngon&rdquo; ở ngoài trang Performance.
              Chỉ cảnh báo chiều xấu. Vì một cái nhãn xanh cạnh tín hiệu đang nổ thì đọc ra thành lời khuyên vào lệnh
              — và hệ thống này không khuyên bro vào lệnh bao giờ.
            </p>
          </Warning>

          <Takeaway>
            Baseline trước. Rồi khối &ldquo;so với baseline&rdquo; kèm ±pp. Thẻ xám là chưa biết, không phải dở. Thẻ
            xanh còn phải qua cửa &ldquo;sau phí&rdquo;. Xong.
          </Takeaway>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="gems" eyebrow="Trang Gems" title="Đi tìm coin nhỏ">
          <p>
            Trang này quét các coin nhỏ trên sàn phi tập trung và chấm điểm. Cũng <Term>hai điểm số độc lập</Term>,
            giống Overview:
          </p>
          <Table
            head={['Điểm', 'Nghĩa']}
            rows={[
              [
                <span key="a" className="font-semibold text-emerald-300">Gem Score</span>,
                'Coin này khớp với hồ sơ đang tìm tới mức nào: đủ người mua bán thật, sống đủ lâu, và CHƯA chạy quá xa.',
              ],
              [
                <span key="b" className="font-semibold text-rose-300">Risk Score</span>,
                'Mức rủi ro. 0 là an toàn nhất. Gồm: có dấu hiệu lừa đảo không, tiền có bị vài ví lớn nắm hết không, pool có mỏng quá không.',
              ],
            ]}
          />
          <p>Coin phải qua được mấy cửa lọc thì mới được chấm điểm. Trượt một cửa là không hiện lên danh sách:</p>
          <Table
            head={['Cửa lọc', 'Vì sao']}
            rows={[
              ['Tiền trong pool từ 50 nghìn đến 5 triệu đô', 'Ít quá thì mua vào bán ra không nổi. Nhiều quá thì hết là coin nhỏ.'],
              ['Có ít nhất 25 nghìn đô giao dịch trong 24h', 'Dưới mức này thì gần như không ai mua bán thật.'],
              ['Pool đã tồn tại ít nhất 7 ngày', 'Tìm coin đã sống sót, không tìm coin vừa mới mở.'],
              ['Chưa tăng quá 300% trong 24h', 'Qua mức đó là kèo người ta đã tìm ra rồi, không còn là kèo mới.'],
              ['Không có cảnh báo lừa đảo nghiêm trọng', 'Loại thẳng, bất kể số liệu đẹp cỡ nào.'],
            ]}
          />
          <Warning>
            <p>
              Điểm cao <Term>không</Term> nghĩa là coin sẽ tăng. Nó chỉ nghĩa là coin khớp với tiêu chí đang tìm. Coin
              nhỏ có thể mất gần hết giá trị rất nhanh.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="journal" eyebrow="Trang Journal" title="Nhật ký giao dịch">
          <p>Đây là sổ ghi tay các lệnh bro thật sự đã vào. Hệ thống không tự ghi vào đây.</p>
          <Table
            head={['Ô nhập', 'Điền gì']}
            rows={[
              [
                <Term key="a">Size</Term>,
                'SỐ LƯỢNG COIN, không phải số tiền. Mua 0.1 BTC thì điền 0.1. Bỏ trống cũng được.',
              ],
              [<Term key="b">Side</Term>, 'Mua thường (spot) thì chọn "long". Công thức tính lãi lỗ y hệt nhau.'],
              [<Term key="c">Entry price</Term>, 'Giá lúc mua vào.'],
              [<Term key="d">Exit price</Term>, 'Giá lúc bán ra. Điền vào là lệnh coi như đã đóng.'],
            ]}
          />
          <Warning>
            <p>
              Nếu bro thấy dấu <Term>—</Term> ở chỗ tổng lãi lỗ, nghĩa là <Term>chưa tính được</Term> (vì chưa nhập
              số lượng), <Term>không phải</Term> là hòa vốn 0 đồng.
            </p>
          </Warning>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="tu-dien" eyebrow="Tra nhanh" title="Từ điển">
          <p>Mấy từ hay gặp trên biểu đồ, dịch sang tiếng người:</p>
          <Table
            head={['Từ', 'Nghĩa dễ hiểu']}
            rows={[
              [<Term key="a">Spot</Term>, 'Chợ mua đứt bán đoạn. Trả tiền, ôm coin về.'],
              [<Term key="b">Futures</Term>, 'Chợ đặt cược. Đặt cọc một ít, vay sàn để cược số lớn hơn nhiều.'],
              [
                <Term key="c">CVD</Term>,
                'Đếm xem bên mua hay bên bán sốt ruột hơn. Ai sốt ruột thì chịu thiệt giá để khớp lệnh ngay. CVD đi lên = bên mua đang sốt ruột hơn.',
              ],
              [
                <Term key="d">Open Interest (OI)</Term>,
                'Tổng số tiền đang được đặt cược. OI tăng = có người mới vào cược. OI giảm = có người rút ra.',
              ],
              [
                <Term key="e">Funding</Term>,
                'Cứ 8 tiếng, phe nào đông hơn phải trả phí cho phe kia. Funding dương = phe cược tăng đang đông và đang trả tiền.',
              ],
              [
                <Term key="f">Thanh lý (Liquidation)</Term>,
                'Người vay tiền cược bị cháy tài khoản, sàn tự động bán sạch. Con số này càng lớn nghĩa là vừa có đợt cháy hàng loạt.',
              ],
              [
                <Term key="g">Basis</Term>,
                'Chênh lệch giá giữa chợ mua đứt và chợ đặt cược. Chênh nhiều = bên đặt cược đang trả giá cao hơn hàng thật.',
              ],
              [
                <Term key="h">Timeframe (5m, 1h...)</Term>,
                'Gom dữ liệu theo từng khoảng bao lâu. 5m = mỗi 5 phút một điểm. Khung càng ngắn càng nhiễu.',
              ],
              [
                <Term key="i">Horizon</Term>,
                'Đo giá sau bao lâu kể từ lúc tín hiệu bật. Chỉ dùng ở trang Performance.',
              ],
            ]}
          />
          <Warning>
            <p>
              Giá trên dashboard là <Term>giá của nến vừa đóng</Term>, không phải giá đang chạy như app Binance. Ở
              khung 5 phút thì có thể chậm tới 5 phút. Cố ý làm vậy để mọi con số cùng tính trên một mốc thời gian.
            </p>
          </Warning>
        </Section>
      </div>

      <footer className="mt-16 border-t border-slate-800 pt-6">
        <p className="text-sm text-slate-500">
          Còn chỗ nào khó hiểu thì cứ hỏi. Quay lại{' '}
          <Link href="/" className="text-sky-400 hover:text-sky-300">
            trang chính
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
