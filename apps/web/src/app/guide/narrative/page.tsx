import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Steps, Story, Table, Takeaway, Term, Warning } from '@/components/guide/GuideBlocks';
import { GuideTabs } from '@/components/guide/GuideTabs';

export const metadata: Metadata = {
  title: 'Đọc Narrative & Flywheel · Market Health Monitor',
  description: 'Cách đọc trang Narrative: dòng tiền theo mảng so với BTC, và các dự án trả doanh thu về cho người giữ token.',
};

const TOC = [
  { id: 'tra-loi-gi', label: 'Trang này trả lời gì' },
  { id: 'nhan', label: 'Bốn nhãn của một mảng' },
  { id: 'doc-the', label: 'Đọc một thẻ mảng' },
  { id: 'flywheel', label: 'Flywheel là gì' },
  { id: 'doc-flywheel', label: 'Đọc một thẻ flywheel' },
  { id: 'quy-trinh', label: 'Quy trình mỗi ngày' },
  { id: 'hieu-nham', label: 'Dễ hiểu nhầm' },
  { id: 'trong', label: 'Khi trang trống hoặc báo lỗi' },
];

export default function NarrativeGuidePage() {
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Đọc Narrative &amp; Flywheel</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">
          Tiền đang chảy vào mảng nào, và dự án nào đang dùng doanh thu thật để đỡ token của mình. Dùng cùng trang{' '}
          <Link href="/narratives" className="text-sky-300 hover:text-sky-200">
            Narrative
          </Link>{' '}
          hoặc lệnh <code className="rounded bg-slate-900 px-1">/sectors</code>, <code className="rounded bg-slate-900 px-1">/flywheel</code> trên bot.
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
        <Section id="tra-loi-gi" eyebrow="Bắt đầu từ đây" title="Trang này trả lời gì">
          <p>
            Trong một thị trường mà phần lớn altcoin cứ tạo đáy mới, thường chỉ có <Term>một hai mảng chạy cùng lúc</Term>: tuần này
            AI, tháng sau meme, rồi RWA. Thị trường đang nói cho bro biết tiền nằm ở đâu, câu hỏi là có nghe hay không.
          </p>
          <p>Trang Narrative có hai phần, trả lời hai câu hỏi khác nhau:</p>
          <Table
            head={['Phần', 'Câu hỏi', 'Dùng cho']}
            rows={[
              [<Term key="a">Dòng tiền theo mảng</Term>, 'Mảng nào đang tăng hơn BTC, và cả mảng cùng tăng hay chỉ vài coin?', 'Trade theo narrative, ngắn hạn'],
              [<Term key="b">Flywheel</Term>, 'Dự án nào đang lấy doanh thu thật để mua lại, đốt hoặc chia cho người giữ token?', 'Chọn coin để giữ dài hơn'],
            ]}
          />
          <p>Cả hai cập nhật mỗi ngày một lần, từ dữ liệu miễn phí của CoinGecko và DefiLlama.</p>
        </Section>

        <Section id="nhan" eyebrow="Dòng tiền theo mảng" title="Bốn nhãn của một mảng">
          <p>
            Mỗi mảng lấy <Term>30 coin vốn hoá lớn nhất</Term> trên CoinGecko và so với BTC ở hai khung: 7 ngày và 30 ngày. Thắng hay
            thua ở mỗi khung cho ra một trong bốn nhãn:
          </p>
          <Table
            head={['Nhãn', 'Nghĩa là', 'Đọc thế nào']}
            rows={[
              [<span key="a" className="font-semibold text-emerald-300">Dẫn dắt</span>, 'Thắng BTC cả 7 lẫn 30 ngày', 'Narrative đang chạy. Có thể bro đã muộn, đừng đu đỉnh.'],
              [<span key="b" className="font-semibold text-sky-300">Đang nổi</span>, 'Thắng BTC 7 ngày, chưa thắng 30 ngày', 'Đáng chú ý nhất: tiền mới bắt đầu vào.'],
              [<span key="c" className="font-semibold text-amber-300">Hạ nhiệt</span>, 'Thắng BTC 30 ngày nhưng tuần này thua', 'Narrative đang nguội, người vào sớm đang chốt.'],
              [<span key="d" className="font-semibold text-slate-400">Yếu</span>, 'Thua BTC cả hai khung', 'Tiền chưa (hoặc không còn) ở đây.'],
            ]}
          />
          <p>
            Khi nhãn vừa đổi so với hôm trước, thẻ ghi <Term>“hôm trước: …”</Term>. Một mảng chuyển từ Yếu sang Đang nổi là thứ đáng
            mở ra xem đầu tiên mỗi sáng.
          </p>
          <Takeaway>Đang nổi là nơi bắt đầu tìm hiểu, Hạ nhiệt là lúc cân nhắc chốt bớt, không phải ngược lại.</Takeaway>
        </Section>

        <Section id="doc-the" eyebrow="Dòng tiền theo mảng" title="Đọc một thẻ mảng">
          <Table
            head={['Ô trên thẻ', 'Nghĩa là']}
            rows={[
              [<Term key="a">7 ngày / 30 ngày</Term>, 'Lợi nhuận của coin trung vị trong mảng (coin đứng giữa khi xếp từ tăng nhiều nhất tới giảm nhiều nhất).'],
              [<Term key="b">so BTC</Term>, 'Hơn hay kém BTC bao nhiêu điểm %. Dương là mảng mạnh hơn BTC.'],
              [<Term key="c">Thắng BTC (7d)</Term>, 'Bao nhiêu % số coin trong mảng tăng hơn BTC. Thanh xanh càng dài thì sóng càng rộng.'],
              [<Term key="d">Dẫn đầu 7 ngày</Term>, 'Ba coin mạnh nhất mảng tuần này: chỗ để bắt đầu tìm hiểu.'],
            ]}
          />
          <Story title="Vì sao dùng coin trung vị, không dùng trung bình">
            <p>
              Mảng Meme có 30 coin: 2 coin tăng 80%, còn 28 coin giảm nhẹ. Tính trung bình thì cả mảng “tăng 5%”, nghe như meme đang
              chạy. Thực tế bro mua một coin meme bất kỳ thì nhiều khả năng là đang lỗ.
            </p>
            <p>
              Coin trung vị trả lời đúng câu hỏi “mua đại một coin trong mảng thì thường ra sao”. Khi trung bình cao mà ít coin thắng BTC,
              thẻ sẽ ghi <Term>“Hẹp: chỉ vài coin kéo”</Term>.
            </p>
          </Story>
          <p>Các dòng ghi chú dưới thẻ:</p>
          <Table
            head={['Ghi chú', 'Nghĩa là']}
            rows={[
              [<Term key="a">Rộng</Term>, 'Đa số coin trong mảng cùng tăng hơn BTC: sóng của cả mảng, không phải của một coin.'],
              [<Term key="b">Hẹp</Term>, 'Vài coin bay kéo trung bình lên, phần lớn vẫn thua BTC. Đu theo mảng lúc này là đu theo vài coin.'],
              [<Term key="c">Coin lớn kéo</Term>, 'Coin vốn hoá lớn tăng mạnh hơn hẳn coin trung vị: tiền lớn vào hàng đầu ngành trước.'],
              [<Term key="d">Coin nhỏ chạy trước</Term>, 'Coin nhỏ tăng mạnh hơn coin lớn: thường là giai đoạn đầu cơ, rủi ro cao hơn.'],
            ]}
          />
          <p className="text-sm text-slate-400">
            Để số không bị méo, mỗi mảng bỏ stablecoin, coin dưới $10M vốn hoá, và coin tăng hơn 1.000% trong 7 ngày (thường là coin mới
            niêm yết, tính từ giá lúc ra mắt). Mảng nào còn dưới 5 coin thì hôm đó không hiện.
          </p>
        </Section>

        <Section id="flywheel" eyebrow="Flywheel" title="Flywheel là gì">
          <p>
            Flywheel là vòng lặp <Term>sản phẩm có người dùng → ra doanh thu → doanh thu quay lại mua hoặc đốt token</Term>. Vòng này tạo
            lực mua thật, không phụ thuộc vào việc có KOL shill hay không.
          </p>
          <Story title="Ví dụ">
            <p>Hyperliquid dùng gần như toàn bộ phí sàn để mua lại HYPE mỗi ngày. Sàn càng nhiều người trade, lực mua HYPE càng lớn.</p>
            <p>Ethereum đốt một phần phí gas mỗi giao dịch. Mạng càng bận, ETH bị đốt càng nhiều.</p>
          </Story>
          <p>
            Số liệu lấy từ mục <Term>holders revenue</Term> của DefiLlama: phần doanh thu thật sự tới tay người giữ token (buyback, burn,
            chia phí), gộp theo dự án mẹ. Ví dụ Hyperliquid gộp cả sàn perp, sàn spot và sản phẩm khác.
          </p>
        </Section>

        <Section id="doc-flywheel" eyebrow="Flywheel" title="Đọc một thẻ flywheel">
          <Table
            head={['Ô trên thẻ', 'Nghĩa là']}
            rows={[
              [<Term key="a">$X về holder / 30 ngày</Term>, 'Số tiền thật đã quay về token trong 30 ngày qua.'],
              [<Term key="b">So tháng trước</Term>, 'Flywheel đang quay nhanh lên hay chậm lại so với 30 ngày trước đó.'],
              [<Term key="c">%/năm vốn hoá</Term>, '30 ngày nhân 12 rồi chia vốn hoá hiện tại, giống tỉ suất cổ tức của cổ phiếu. 5% nghĩa là mỗi năm dự án mua lại hoặc đốt lượng token bằng 5% vốn hoá.'],
              [<Term key="d">Giá 30 ngày</Term>, 'Giá token đi thế nào trong cùng tháng đó.'],
              [<Term key="e">Cơ chế</Term>, 'Mô tả của DefiLlama: dự án trả cho holder bằng cách nào (bấm để mở).'],
            ]}
          />
          <p>Các dòng đáng để ý:</p>
          <Table
            head={['Dòng', 'Nghĩa là']}
            rows={[
              [<span key="a" className="text-emerald-300">+ Lệch pha</span>, 'Tiền về holder tăng mạnh mà giá lại giảm: dự án đang làm ra tiền hơn nhưng thị trường chưa phản ánh. Đáng đào sâu, chưa phải tín hiệu mua.'],
              [<span key="b" className="text-amber-300">? Trên 50%/năm</span>, 'Thường là một khoản trả một lần, hoặc vốn hoá lưu hành quá nhỏ. Đừng tin con số đó là lãi đều mỗi năm.'],
              [<span key="c" className="text-amber-300">? Giảm so tháng trước</span>, 'Doanh thu đang đi xuống: flywheel chậm lại.'],
              [<span key="d" className="text-amber-300">? Không có vốn hoá</span>, 'Không tính được tỉ lệ; token có thể chưa lên CoinGecko.'],
            ]}
          />
          <p>
            Ba cách sắp xếp trả lời ba câu hỏi riêng: <Term>Trả nhiều nhất</Term> (flywheel lớn nhất), <Term>%/năm vốn hoá</Term> (rẻ
            nhất so với dòng tiền), <Term>Tăng so tháng trước</Term> (đang quay nhanh lên).
          </p>
        </Section>

        <Section id="quy-trinh" eyebrow="Thực hành" title="Quy trình mỗi ngày">
          <Steps
            items={[
              <>Sáng mở trang Narrative hoặc gõ <code className="rounded bg-slate-900 px-1">/sectors</code>. Tìm mảng <Term>Đang nổi</Term> hoặc vừa đổi nhãn.</>,
              <>Xem dòng ghi chú: <Term>Rộng</Term> thì cả mảng đang chạy; <Term>Hẹp</Term> thì chỉ vài coin, cẩn thận hơn.</>,
              <>Lấy 3 coin <Term>Dẫn đầu 7 ngày</Term>, tra từng coin bằng <Link href="/lookup" className="text-sky-300 hover:text-sky-200">Lookup</Link> để xem dòng tiền là spot thật hay đòn bẩy.</>,
              <>Lên X tìm ticker: có ai viết thesis không, người viết là ai, thesis có hợp lý không.</>,
              <>Muốn giữ lâu hơn thì xem coin đó (hoặc dự án cùng mảng) có trong danh sách <Term>Flywheel</Term> không, và flywheel đang nhanh lên hay chậm lại.</>,
              <>Vào lệnh thì ghi vào <Link href="/journal" className="text-sky-300 hover:text-sky-200">Journal</Link> (hoặc <code className="rounded bg-slate-900 px-1">/trade</code>) kèm nguồn và thesis, để sau này biết cách đọc nào của mình đúng.</>,
            ]}
          />
          <Story title="Ghép hai phần lại">
            <p>
              Mảng Perp DEX vừa chuyển sang <Term>Đang nổi</Term>, ghi chú <Term>Rộng</Term>. Trong Flywheel, một sàn perp có doanh thu
              về holder tăng 40% so với tháng trước, tỉ lệ 8%/năm vốn hoá, và có dòng <Term>Lệch pha</Term> vì giá vẫn giảm.
            </p>
            <p>
              Đó là một ứng viên có cả câu chuyện của thị trường lẫn dòng tiền thật phía sau. Vẫn phải tự kiểm tra, nhưng đáng đọc kỹ
              hơn một coin chỉ có câu chuyện.
            </p>
          </Story>
        </Section>

        <Section id="hieu-nham" eyebrow="Đọc cho đúng" title="Dễ hiểu nhầm">
          <Warning>
            <p>
              “Mảng Dẫn dắt thì mua coin trong mảng.” Nhãn chỉ mô tả 7 và 30 ngày đã qua. Một narrative có thể đảo chiều trong vài ngày,
              và phần lớn coin theo narrative về gần 0 khi narrative hết. Trade narrative là trade, không phải đầu tư: vào nhỏ, có điểm
              cắt lỗ, chốt dần.
            </p>
          </Warning>
          <Warning>
            <p>
              “%/năm vốn hoá là lãi mình nhận được.” Không. Đó là tốc độ dự án mua lại hoặc đốt token so với vốn hoá, tính theo 30 ngày
              vừa qua. Doanh thu có thể giảm, giá token có thể giảm mạnh hơn nhiều so với con số đó, và token mở khoá có thể nhiều hơn
              lượng được mua lại.
            </p>
          </Warning>
          <Warning>
            <p>
              “Không có tên trong Flywheel là dự án tệ.” Danh sách chỉ có dự án đang trả tiền cho holder theo DefiLlama. Nhiều dự án tốt
              chưa bật cơ chế này, hoặc DefiLlama chưa theo dõi.
            </p>
          </Warning>
          <Takeaway>Trang này cho biết tiền đang ở đâu. Vào đâu, bao nhiêu, và lúc nào ra vẫn là quyết định của bro.</Takeaway>
        </Section>

        <Section id="trong" eyebrow="Khi có vấn đề" title="Khi trang trống hoặc báo lỗi">
          <Table
            head={['Thấy', 'Nghĩa là', 'Làm gì']}
            rows={[
              ['“Chưa có dữ liệu”', 'Worker vừa khởi động, chưa chạy lần đầu', 'Đợi khoảng 15–20 phút'],
              ['“lỗi … liên tiếp” kèm 429 hoặc exhausted retries', 'CoinGecko chặn vì IP máy chủ dùng chung', <>Thêm key demo miễn phí của CoinGecko vào biến <code key="k" className="rounded bg-slate-900 px-1">COINGECKO_API_KEY</code> trên Render</>],
              ['Thiếu vài mảng', 'Mảng đó hôm nay không đủ 5 coin hợp lệ, hoặc lần chạy bị cắt giữa chừng', 'Worker chạy lại mỗi giờ để lấp phần còn thiếu'],
            ]}
          />
          <p>
            Tình trạng từng job xem ở trang <Link href="/status" className="text-sky-300 hover:text-sky-200">Status</Link> (dòng{' '}
            <code className="rounded bg-slate-900 px-1">sector_scan</code> và <code className="rounded bg-slate-900 px-1">flywheel_scan</code>).
          </p>
        </Section>
      </div>
    </div>
  );
}
