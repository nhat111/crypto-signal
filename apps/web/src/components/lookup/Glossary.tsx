/**
 * What each reading means, in words, on the page.
 *
 * The explanations used to live in `title=` attributes. There is no hover
 * on a touch screen, so on the device this dashboard is actually read on
 * they were invisible — which is the same as not having written them.
 *
 * A `<details>` instead: closed by default so it does not push the numbers
 * down, open in one tap, and the text is real text rather than a tooltip
 * the browser may or may not show.
 *
 * The explanations are in Vietnamese and the terms are not. The term has
 * to read exactly as it appears on the panel above, or somebody looking up
 * "FDV" cannot find the entry that explains it — while the teaching itself
 * belongs in the reader's own language, where a beginner can actually
 * follow it.
 *
 * They explain what a number measures and, as often, what it does not.
 * That second half is the part that keeps this a reference rather than a
 * recommendation: nothing here tells anyone to buy or sell, and
 * Glossary.test.ts holds that line.
 */
export function Glossary({ title, items }: { title: string; items: Array<{ term: string; text: string }> }) {
  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wide text-slate-400 hover:text-slate-200">
        <span className="group-open:hidden">{title} ▸</span>
        <span className="hidden group-open:inline">{title} ▾</span>
      </summary>
      <dl className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="text-xs font-semibold text-slate-300">{item.term}</dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export const TECHNICAL_GLOSSARY: Array<{ term: string; text: string }> = [
  {
    term: 'RSI 14',
    text:
      'So sức tăng với sức giảm của 14 nến gần nhất, quy về thang 0–100. Trên 70 gọi là "quá mua", dưới 30 là "quá bán" — nhưng đó chỉ là quy ước, không phải luật: nhiều mã nằm trên 70 hàng tuần liền mà vẫn tăng tiếp. Dòng nhỏ bên dưới mới là phần dùng được: nó cho biết con số này đứng ở đâu so với chính 200 nến gần nhất của mã đó.',
  },
  {
    term: 'Trend (EMA20 vs EMA50)',
    text:
      'Hai đường trung bình giá đóng cửa: một tính trên 20 nến, một trên 50 nến. Đường nhanh nằm trên đường chậm nghĩa là giá gần đây cao hơn giá cũ. Khoảng cách giữa hai đường được hiện ra vì cách nhau 0,1% và cách nhau 12% là hai chuyện hoàn toàn khác nhau. Dưới 0,5% thì ghi là "flat" (đi ngang) chứ không gọi là xu hướng, để cái nhãn không lật qua lật lại theo nhiễu.',
  },
  {
    term: 'Range (ATR)',
    text:
      'Khoảng cách trung bình giữa đỉnh và đáy của mỗi nến trong 14 nến gần nhất, tính theo phần trăm giá hiện tại. Nó trả lời "con này mỗi nến thường nhúc nhích bao nhiêu" — dùng để chọn khối lượng vào lệnh hoặc đặt cắt lỗ cho vừa với độ ồn của nó. Nó không nói gì về hướng đi.',
  },
  {
    term: 'Nearest low / high',
    text:
      'Mức giá gần nhất mà đồ thị đã từng quay đầu: một nến có đỉnh cao hơn hai nến hai bên (hoặc đáy thấp hơn). Kèm luôn khoảng cách từ giá hiện tại, vì chính khoảng cách đó là thứ để tính khối lượng vào lệnh. "cleared all" nghĩa là giá đang cao hơn mọi đỉnh loại này trong khung — đó là một sự kiện, không phải thiếu dữ liệu.',
  },
  {
    term: 'Range position',
    text:
      'Giá hiện tại nằm ở đâu giữa đáy thấp nhất và đỉnh cao nhất của khung, theo thang 0–100. Nó nói giá đang ở đâu, không nói giá sắp đi đâu: 95 có thể là phá đỉnh đi lên, cũng có thể là chạm trần rồi quay xuống, và con số này không phân biệt được hai trường hợp đó.',
  },
  {
    term: 'Volume vs avg',
    text:
      'Khối lượng của nến mới nhất chia cho khối lượng trung bình 20 nến trước đó. 1× là một nến bình thường, 3× là phiên có chuyện. Nến mới nhất cố ý không được tính vào mức trung bình của chính nó — nếu tính vào thì mốc so sánh sẽ bị kéo về phía cái đang cần đo.',
  },
  {
    term: 'Window high / low',
    text:
      'Đỉnh và đáy của cả khung, giá hiện tại cách mỗi mốc bao xa, và chuyện đó xảy ra cách đây bao nhiêu nến. "3 nến trước" và "188 nến trước" là hai câu chuyện rất khác nhau dù cùng một mức giá.',
  },
  {
    term: 'Other timeframes',
    text:
      'Cùng một cách đọc xu hướng, áp lên khung 1h, 4h và 1d. Nhìn một khung thì không biết các khung có đồng thuận hay không — mà khi chúng mâu thuẫn nhau, đó thường mới là thông tin đáng giá.',
  },
  {
    term: '"higher than X% of window"',
    text:
      'Con số hiện tại đang cao hơn bao nhiêu phần trăm số nến trong cùng khung. Đây là thứ biến một con số thành thông tin: RSI 75 mang ý nghĩa khác hẳn trên một mã thường xuyên ở mức 70, so với một mã cả tháng nay chưa vượt quá 60.',
  },
];

export const ONCHAIN_GLOSSARY: Array<{ term: string; text: string }> = [
  {
    term: 'Liquidity',
    text:
      'Thanh khoản — tổng giá trị đang nằm trong pool, tính cả hai phía. Đây là cái bro thật sự giao dịch với: pool mỏng thì chính lệnh của bro đẩy giá đi, dù vốn hoá có ghi to đến mấy.',
  },
  {
    term: 'FDV vs market cap',
    text:
      'FDV định giá toàn bộ token sẽ từng tồn tại; market cap chỉ định giá số đang lưu hành. Hai số chênh nhau nhiều nghĩa là còn một lượng lớn token chưa ra thị trường — và khi chúng ra, chúng sẽ ra ở đâu đó.',
  },
  {
    term: 'Liquidity / FDV',
    text:
      'Độ dày của pool so với mức định giá. Một token tự nhận định giá lớn nhưng ngồi trên pool mỏng là token mà giá của nó rẻ để đẩy — theo cả hai chiều.',
  },
  {
    term: 'Vol / liquidity',
    text:
      'Khối lượng một ngày chia cho độ dày pool. Rất cao nghĩa là pool đang bị quay vòng liên tục; rất thấp nghĩa là gần như không ai giao dịch. Bản thân hai thái cực đó không tốt cũng không xấu — chúng cho biết bro sẽ thoát ra dễ hay khó.',
  },
  {
    term: 'Largest holder',
    text:
      'Tỷ lệ nguồn cung nằm trong một ví lớn nhất mà bộ quét nhìn thấy được. Tập trung không chứng minh điều gì cả, nhưng nó có nghĩa là một địa chỉ đủ sức tự mình làm giá chạy.',
  },
  {
    term: 'LP locked',
    text:
      'Token thanh khoản (LP) có bị khoá hay không. Chưa khoá nghĩa là ai đang giữ chúng đều có thể rút cả pool đi, và kéo giá đi theo. Lưu ý: "unknown" là trạng thái thứ ba — nó có nghĩa là chưa đọc được, không có nghĩa là không.',
  },
  {
    term: 'Mint / freeze revoked',
    text:
      'Hợp đồng còn quyền tạo thêm token mới, hoặc khoá không cho một ví chuyển đi, hay không. Chưa thu hồi nghĩa là người deploy vẫn giữ quyền đó. Cũng như trên, "unknown" không phải là "không".',
  },
];
