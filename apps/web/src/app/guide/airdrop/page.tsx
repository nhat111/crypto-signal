import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Steps, Story, Table, Takeaway, Term, Warning } from '@/components/guide/GuideBlocks';
import { GuideTabs } from '@/components/guide/GuideTabs';

export const metadata: Metadata = {
  title: 'Chiến thuật airdrop · Market Health Monitor',
  description: 'Chọn dự án, chia vốn, tương tác đều, tránh bị loại vì sybil và giữ ví an toàn khi làm airdrop.',
};

const TOC = [
  { id: 'la-gi', label: 'Airdrop là gì, và vì sao không chắc' },
  { id: 'chon-du-an', label: 'Chọn dự án' },
  { id: 'chi-phi', label: 'Chi phí và vốn' },
  { id: 'tuong-tac', label: 'Tương tác thế nào cho đáng' },
  { id: 'sybil', label: 'Sybil: lý do số 1 bị loại' },
  { id: 'bao-mat', label: 'Bảo mật ví' },
  { id: 'khi-nhan', label: 'Khi airdrop về' },
  { id: 'quy-trinh', label: 'Quy trình mỗi tuần' },
];

export default function AirdropGuidePage() {
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Chiến thuật làm airdrop</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">
          Làm sao chọn đúng dự án, tốn ít phí, không bị loại và không mất ví. Dùng cùng trang{' '}
          <Link href="/airdrops" className="text-sky-300 hover:text-sky-200">
            Airdrop
          </Link>
          .
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
        <Section id="la-gi" eyebrow="Bắt đầu từ đây" title="Airdrop là gì, và vì sao không chắc">
          <p>
            Airdrop là khi một dự án ra token và <Term>chia một phần cho người đã dùng sản phẩm từ trước</Term>. Dự án
            muốn token nằm trong tay người dùng thật; người dùng sớm được trả công vì đã chịu rủi ro và chịu phí.
          </p>
          <p>
            Ngày nay đa số dự án không im lặng chờ ra token mà chạy <Term>chương trình points</Term>: dùng sản phẩm thì
            được điểm, điểm sau này quy ra token. Points công khai thì biết mình đang được tính, nhưng không biết 1 điểm
            đáng bao nhiêu tiền cho tới ngày ra token.
          </p>
          <Story title="Hai kết cục cùng một công sức">
            <p>
              Ví A dùng một sàn DEX mới suốt 6 tháng, tốn khoảng $80 phí. Dự án ra token, ví A nhận phần thưởng gấp
              nhiều lần số phí đó.
            </p>
            <p>
              Ví B làm y hệt với một dự án khác, cũng tốn $80. Dự án tuyên bố không ra token, hoặc ra token nhưng lọc ví B
              ra vì “giống bot”. Ví B mất $80 và 6 tháng.
            </p>
          </Story>
          <Warning>
            <p>
              “Dự án chưa có token thì chắc chắn sẽ airdrop.” <Term>Sai.</Term> Danh sách trên trang Airdrop chỉ lọc ra
              dự án có hình dạng giống những dự án từng airdrop: giữ tiền thật, chưa có token. Không ai biết trước dự án
              nào sẽ trả, trả bao nhiêu, cho ai.
            </p>
          </Warning>
        </Section>

        <Section id="chon-du-an" eyebrow="Bước 1" title="Chọn dự án">
          <p>Trang Airdrop cho sẵn phần dữ liệu: TVL, TVL tăng hay giảm, mới hay cũ, audit, chain. Phần còn lại bro tự kiểm:</p>
          <Table
            head={['Dấu hiệu', 'Vì sao quan trọng', 'Kiểm ở đâu']}
            rows={[
              [<Term key="a">Chưa có token</Term>, 'Đã có token thì dùng sản phẩm chỉ được token cũ, không có airdrop mới.', 'CoinGecko, X của dự án (DefiLlama có thể chậm vài ngày)'],
              [<Term key="b">TVL tăng</Term>, 'Tiền thật đang chảy vào: dự án đang lớn, chưa bị bỏ.', 'Cột 7 ngày / 30 ngày trên trang Airdrop'],
              [<Term key="c">Có points công khai</Term>, 'Biết chắc mình đang được tính. Không có points thì toàn bộ là đoán.', 'Trang chủ dự án, docs, X'],
              [<Term key="d">Gọi vốn từ quỹ lớn</Term>, 'Dự án có quỹ đứng sau thường ra token để quỹ có đường thoát.', 'CryptoRank, DefiLlama Raises, tin tức (danh sách không có dữ liệu này)'],
              [<Term key="e">Team nói “không có token”</Term>, 'Thì tin họ, bỏ qua.', 'X, Discord của dự án'],
            ]}
          />
          <p>
            Sort <Term>“Tăng 7 ngày”</Term> để thấy dự án đang nóng, <Term>“Mới lên”</Term> để vào sớm, <Term>“TVL lớn
            nhất”</Term> để thấy dự án đã có chỗ đứng. Mỗi thẻ có dòng <Term>?</Term> màu vàng: đó là những gì dữ liệu
            không trả lời được, đọc trước khi bỏ tiền.
          </p>
          <Takeaway>Ít dự án làm kỹ tốt hơn nhiều dự án làm sơ: 3–5 dự án mỗi lúc là đủ để theo kịp.</Takeaway>
        </Section>

        <Section id="chi-phi" eyebrow="Bước 2" title="Chi phí và vốn">
          <p>
            Phí gas là tiền mất chắc chắn, airdrop là tiền chưa chắc có. Nên coi airdrop như một khoản đầu tư nhỏ có ngân
            sách, không phải việc làm thêm miễn phí.
          </p>
          <Steps
            items={[
              <>Đặt <Term>ngân sách phí mỗi tháng</Term> (vd $30) và ghi mọi lần tương tác bằng nút “Ghi” hoặc /farm, để biết mình đã bỏ ra bao nhiêu.</>,
              <>Ưu tiên <Term>L2 phí rẻ</Term> (Base, Arbitrum, Optimism…) hoặc Solana. Cùng một thao tác trên Ethereum có thể đắt gấp chục lần.</>,
              <>Tiền gửi vào protocol <Term>có thể mất vì hack</Term>. Chỉ gửi số tiền chấp nhận mất, và ưu tiên dự án có audit.</>,
              <>Không vay để farm. Một đợt thanh lý có thể xoá sạch mọi phần thưởng.</>,
            ]}
          />
        </Section>

        <Section id="tuong-tac" eyebrow="Bước 3" title="Tương tác thế nào cho đáng">
          <p>Các đợt airdrop gần đây thường chấm theo những thứ giống người dùng thật:</p>
          <Table
            head={['Thường được tính', 'Làm thế nào']}
            rows={[
              [<Term key="a">Số tuần / tháng có hoạt động</Term>, '1–2 lần mỗi tuần, đều đặn, tốt hơn 50 lần trong một ngày. Trang Airdrop đếm sẵn số tuần và tháng.'],
              [<Term key="b">Giữ vốn lâu</Term>, 'Points thường tính theo số tiền × thời gian. Gửi ít mà giữ lâu thường hơn gửi nhiều rồi rút ngay.'],
              [<Term key="c">Dùng nhiều tính năng</Term>, 'Swap, cung cấp thanh khoản, vay/cho vay, bridge, bỏ phiếu: dùng như một người dùng thật.'],
              [<Term key="d">Khối lượng thật</Term>, 'Swap qua lại cùng một cặp để “bơm” khối lượng dễ bị coi là wash trading và bị loại.'],
            ]}
          />
          <p>
            Snapshot (thời điểm chốt dữ liệu) gần như không bao giờ báo trước. Vì vậy hoạt động đều mới là chiến thuật,
            không phải canh ngày. Farm nào hơn 2 tuần chưa đụng sẽ hiện viền vàng trên trang Airdrop.
          </p>
        </Section>

        <Section id="sybil" eyebrow="Rủi ro lớn nhất" title="Sybil: lý do số 1 bị loại">
          <p>
            <Term>Sybil</Term> là một người chạy nhiều ví giả làm nhiều người. Dự án nào cũng lọc sybil trước khi chia, và
            ngày càng lọc mạnh tay. Những dấu hiệu bị bắt nhiều nhất:
          </p>
          <Steps
            items={[
              <>Nhiều ví được <Term>nạp tiền từ cùng một nguồn</Term> (cùng ví mẹ, cùng lúc).</>,
              <>Các ví <Term>chuyển tiền qua lại cho nhau</Term> hoặc gom về một ví sau khi claim.</>,
              <>Các ví làm <Term>cùng thao tác, cùng thứ tự, cùng giờ</Term>, như chạy script.</>,
              <>Ví chỉ đụng đúng dự án đang farm, không có lịch sử nào khác.</>,
            ]}
          />
          <Warning>
            <p>
              “Càng nhiều ví càng nhiều tiền.” Thực tế, các đợt gần đây thường loại cả cụm ví, và có dự án còn công khai
              danh sách. Một hai ví làm như người thật thường an toàn hơn hai chục ví làm như bot.
            </p>
          </Warning>
        </Section>

        <Section id="bao-mat" eyebrow="Không được bỏ qua" title="Bảo mật ví">
          <Steps
            items={[
              <>Dùng <Term>ví riêng để farm</Term>, chỉ chứa số tiền đang dùng. Tài sản chính để ở ví khác (tốt nhất là ví cứng).</>,
              <>Chỉ vào dự án qua <Term>link từ X chính thức hoặc DefiLlama</Term> (nút trên mỗi thẻ). Kết quả tìm kiếm và quảng cáo thường là site giả.</>,
              <><Term>Không bao giờ</Term> nhập seed phrase vào bất kỳ trang nào, kể cả trang “kiểm tra airdrop”.</>,
              <>Định kỳ <Term>thu hồi quyền (revoke approve)</Term> những hợp đồng không còn dùng, vd qua revoke.cash.</>,
              <>Token lạ tự xuất hiện trong ví thường là mồi lừa: đừng swap, đừng vào link trong tên token.</>,
              <>Đọc kỹ trước khi ký: chữ ký “Permit” hoặc “setApprovalForAll” cho phép người khác rút tài sản.</>,
            ]}
          />
        </Section>

        <Section id="khi-nhan" eyebrow="Kết thúc" title="Khi airdrop về">
          <p>
            Claim trong hạn (thường có hạn chót), và chỉ claim từ link chính thức. Sau đó bấm <Term>“Đã nhận airdrop”</Term>{' '}
            trên trang Airdrop và nhập giá trị nhận được: trang sẽ trừ đi toàn bộ phí đã ghi để ra lãi/lỗ thật.
          </p>
          <p>
            Nhiều token airdrop biến động rất mạnh trong những tuần đầu sau khi ra mắt, vì rất nhiều người nhận cùng lúc
            và mỗi người có kế hoạch riêng. Giữ hay bán là quyết định của bro; quan trọng là quyết định trước ngày nhận,
            không phải lúc đang nhìn giá nhảy.
          </p>
          <p>Nếu dự án tuyên bố không ra token, hoặc bro thấy không còn đáng, bấm “Bỏ dự án” để số liệu không bị treo.</p>
        </Section>

        <Section id="quy-trinh" eyebrow="Tóm tắt" title="Quy trình mỗi tuần">
          <Steps
            items={[
              <>Mở trang <Link href="/airdrops" className="text-sky-300 hover:text-sky-200">Airdrop</Link>, sort “Tăng 7 ngày” và “Mới lên”, đọc lý do và các dòng <Term>?</Term>.</>,
              <>Với dự án nào hứng thú: kiểm tra token trên CoinGecko, points và tin gọi vốn trên X.</>,
              <>Chọn tối đa vài dự án, bấm <Term>“Theo dõi farm”</Term>.</>,
              <>Mỗi tuần 1–2 lần tương tác thật trên mỗi dự án, ghi phí bằng nút “Ghi” hoặc <code className="rounded bg-slate-900 px-1">/farm Tên 0,3 swap</code>.</>,
              <>Mỗi tháng xem tổng phí so với ngân sách; dự án nào TVL rút mạnh hoặc team nói không có token thì bỏ.</>,
            ]}
          />
          <Takeaway>Đều đặn, ít ví, ghi hết chi phí, và không bao giờ đưa seed phrase cho ai.</Takeaway>
        </Section>
      </div>
    </div>
  );
}
