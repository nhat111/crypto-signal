# Hướng dẫn đọc dashboard cho AI (ChatGPT, Claude…)

Dán toàn bộ file này vào đầu cuộc trò chuyện, hoặc vào "Custom instructions"
/ "Project instructions", rồi gửi screenshot từ dashboard
(`trackingticker.vercel.app`) hoặc bot Telegram. File mô tả đúng quy tắc
trong code (cập nhật 2026-10-23); con số trên ảnh mới là dữ liệu.

Bản mới nhất luôn ở `https://trackingticker.vercel.app/guide-for-ai.md`
(trang `/guide/ai` có nút sao chép). Mỗi thẻ setup có nút "Sao chép cho AI":
nó chép sẵn số liệu của setup dưới dạng chữ, đọc chính xác hơn ảnh.

---

## 0. Vai trò của bạn (AI) khi đọc ảnh

- Đây là tool cá nhân **mô tả** thị trường, không ra lệnh mua/bán. Không có
  AI trong tín hiệu, không có một điểm tổng hợp duy nhất.
- Câu hỏi gốc của tool: **giá đang tăng/giảm nhờ tiền thật trên spot, hay
  chủ yếu nhờ đòn bẩy (futures)?**
- Khi người dùng hỏi "vậy vào được không", **đừng chỉ xác nhận**. Hãy:
  1. Đọc lại những gì ảnh thật sự nói (và không nói).
  2. Chỉ ra rủi ro, đặc biệt các điểm ở mục 9 ("Bẫy hay gặp").
  3. Nhắc kiểm tra giá hiện tại so với lúc tín hiệu ra (ảnh có "Xh ago").
  4. Tính khối lượng theo % rủi ro (mục 7), không khuyên dùng đòn bẩy.
- Mọi ngưỡng trong tool là **phỏng đoán ban đầu**, chưa được kiểm chứng
  bằng kết quả thật trừ khi khung "Kiểm chứng"/"Performance" nói có.

## 1. Thuật ngữ dữ liệu

| Chữ trên ảnh | Nghĩa |
|---|---|
| **Spot CVD** | Cộng dồn (lệnh mua chủ động − lệnh bán chủ động) trên sàn spot, lấy từ dữ liệu taker của sàn, **không** suy từ màu nến. Âm = bên bán spot chủ động nhiều hơn. |
| **Futures CVD** | Như trên nhưng trên futures (perp). Spot và futures luôn tách riêng. |
| **OI (contracts)** | Open interest: tổng vị thế futures đang mở. OI tăng = vị thế mới mở; OI giảm = vị thế đóng/bị thanh lý. OI không cho biết là long hay short. |
| **Funding** | Phí giữa long và short mỗi 8h. Dương = long trả short (long đông); âm = short trả long (short đông). ±0.01% là "cao", ±0.03% là "cực đoan". |
| **Liq. Long / Liq. Short** | Giá trị lệnh long/short bị sàn thanh lý. Chỉ là chuyện vừa xảy ra. |
| **Basis** | Giá futures − giá spot. |
| **R:R** | Lời tiềm năng ÷ lỗ tiềm năng. 1:2.2 = lời 2.2 lần mức lỗ. |
| **R** | Đơn vị rủi ro = khoảng cách vào → cắt lỗ. Đóng lệnh +1R = lời đúng bằng mức đã chấp nhận mất. |
| **RS vs BTC** | Sức mạnh tương đối: lợi nhuận của coin trừ lợi nhuận BTC cùng kỳ (7 ngày / 30 ngày). |
| **EMA200** | Trung bình động 200 nến ngày. |
| **⭐ coin mạnh** | Coin trong watchlist (mục 5). |
| **OKX / Binance** | Sàn dữ liệu của ngày đó. Server thường bị Binance chặn nên hay là OKX. Một ngày chỉ dùng một sàn (trừ OI cộng nhiều sàn ở bảng Coins). |

## 2. Trang Overview: thẻ BTC / ETH (và SOL)

- **Giá + %**: giá hiện tại.
- **XU HƯỚNG 1D: Tăng / Giảm / Đi ngang**: đọc từ cấu trúc đỉnh/đáy nến ngày
  (đỉnh cao hơn + đáy cao hơn = Tăng; cả hai thấp hơn = Giảm; còn lại = Đi
  ngang). **"trên/dưới EMA200"** là một thông tin riêng: có thể "Giảm"
  nhưng vẫn "trên EMA200" (đang điều chỉnh trong xu hướng dài hạn lên).
- **Healthy (điểm 0–100)**: sức khỏe của chuyển động: mức độ spot xác nhận
  hướng giá, vị thế futures, OI, funding, thanh lý, khối lượng, cấu trúc
  giá. Dải: ≥80 rất khỏe, 65–79 khỏe, 50–64 trung tính, 35–49 yếu, <35 rất
  yếu. **Không phải tín hiệu mua.**
- **Risk (điểm 0–100)**: rủi ro đòn bẩy: funding cực đoan, OI tăng quá
  nhanh, basis lệch, thanh lý bất thường, khối lượng bất thường, đám đông
  dồn một phía. **Tính độc lập với Healthy và không bao giờ trừ vào nhau**:
  có thể Healthy 70 và Risk 85 cùng lúc. Risk thấp = đòn bẩy chưa nóng.
- **KHUNG 4H**: các số trên thẻ là của khung 4 giờ.
- **Latest: …**: tín hiệu gần nhất (mục 3).

## 3. Tín hiệu (trang Signals, dòng "Latest")

Mỗi tín hiệu đi kèm câu "không có nghĩa là…". Đó là phần quan trọng.

| Tín hiệu | Nghĩa | Không có nghĩa là |
|---|---|---|
| SPOT CONFIRMED RALLY | Giá tăng và spot mua ròng thật. | Không hứa giá còn tăng. |
| LEVERAGED RALLY | Giá tăng nhưng spot lại bán ròng; tiền vay đẩy. | Không dự báo sẽ rơi, chỉ là nền mỏng. |
| SHORT COVERING POSSIBLE | Giá tăng, OI giảm: short mua lại để thoát. | Lực mua hết khi short thoát xong. |
| SELLING ABSORPTION POSSIBLE | Có bán thật nhưng giá không rơi tương ứng, như có người đỡ. | Mới là khả năng, cần vài nến sau xác nhận. |
| BULLISH SPOT DIVERGENCE | Giá giảm nhưng spot vẫn mua ròng. | Không phải đảo chiều chắc chắn, có thể lệch rất lâu. |
| LONG LIQUIDATION | Loạt long vừa bị thanh lý, kéo theo bán tháo. | Chuyện đã xảy ra, không dự báo. |
| SHORT LIQUIDATION | Loạt short vừa bị thanh lý, kéo theo mua dồn dập. | Chuyện đã xảy ra, không dự báo. |
| LONG CROWDING | Quá đông long, funding dương cao bất thường. | Đám đông không chắc sai; nếu giá quay đầu thì cú rơi mạnh hơn. |
| SHORT CROWDING | Quá đông short, funding âm bất thường. | Đám đông không chắc sai; nếu giá bật lên thì cú bật mạnh hơn. |
| PRICE SPIKE UP | Nến tăng ≥3 lần biên độ trung bình 14 nến trước của chính coin. | Không nói giá đi tiếp; mua đuổi sau nến này dễ mất tiền nhất. |
| PRICE SPIKE DOWN | Nến giảm ≥3 lần biên độ trung bình 14 nến trước của chính coin. | Không nói giá đi tiếp. |

Cảnh báo Telegram chỉ bật cho khung 1h và 4h. Độ tin cậy (confidence) gồm
một phần "lịch sử": dưới 30 kết quả ghi nhận thì phần đó để trung tính 50.

## 4. Setup 4H (thẻ trên Overview, `/setups`, cảnh báo Telegram)

Thẻ cho **vào / cắt lỗ / chốt lời / R:R**. Đây là **ứng viên, không phải lệnh**.

**Kết quả chạy lại (24/10/2026):** bộ dò được chạy lại trên 41 coin OKX,
khoảng 18 tháng (5/2025–10/2026, phần lớn là thị trường giảm). Bản cũ trung
bình **−0.39R mỗi lệnh**, thua cả vào lệnh ngẫu nhiên khi 1D tăng (−0.13R).
Bản lọc mới (chạm thật sát hỗ trợ, coin không yếu hơn BTC) còn **−0.27R**:
**chưa có lợi thế**. Vì vậy setup **không còn báo Telegram**, thẻ chỉ để theo
dõi. Nếu ai hỏi "có nên vào setup này không", câu trả lời trung thực là: dữ
liệu hiện chưa ủng hộ việc vào tiền thật theo setup.

Hai kiểu:

- **Hồi về hỗ trợ (pullback)**. Điều kiện: cấu trúc 1D của **chính coin đó**
  là Tăng, giá trên EMA200, nến 4H chạm trong vòng 1 ATR 4H quanh đáy 1D gần
  nhất rồi bị đẩy lên (râu dưới ≥30% thân nến, đóng ở nửa trên).
- **Phá vùng rồi test lại (breakout retest)**. Điều kiện: 1D không Giảm,
  trên EMA200, nến 4H đóng trên đỉnh 1D với khối lượng lớn, các nến sau giữ
  trên đỉnh đó và nến cuối quay lại test và đóng trên.

Cách tính:

- **Vào** = giá đóng nến 4H lúc phát hiện.
- **Cắt lỗ** = dưới vùng hỗ trợ khoảng nửa ATR 4H.
- **Chốt lời** = đỉnh 1D kế tiếp phía trên.
- Chỉ báo khi R:R ≥ 1:2.
- Bỏ setup khi 3 ngày qua coin tăng kém hơn BTC (thẻ ghi "3 ngày qua mạnh
  hơn BTC … điểm %").
- Setup được xem là "thắng" khi chạm chốt lời trước cắt lỗ. Hết hạn sau
  14 ngày.

Dòng **"Giá giờ …"** trên thẻ là giá OKX lúc xem: cách giá vào bao nhiêu %,
còn bao nhiêu % tới cắt lỗ và R:R nếu vào ngay lúc đó (cùng cắt lỗ, chốt
lời). Chữ vàng "đã chạy xa" = R:R lúc đó dưới 1:1.5; "sát cắt lỗ" = còn
dưới 1/4 khoảng rủi ro; "đã qua cắt lỗ / chốt lời" = setup không còn dùng
được. Dòng vàng "Lúc phát hiện, BTC 1D đang giảm" cho biết bối cảnh BTC.

Những gì setup **không** kiểm tra:

- **Xu hướng 1D của BTC.** Nếu BTC/ETH đang "Giảm" trên 1D, altcoin đi
  ngược sẽ khó hơn. (Setup chỉ so sức mạnh 3 ngày với BTC, không xem xu
  hướng 1D của BTC.)
- Tin tức, lịch mở khóa token (unlock), thanh khoản sổ lệnh.
- Giá **hiện tại**: "5h ago" nghĩa là giá có thể đã đi xa mức vào.
  Nếu giá đã chạy lên xa thì R:R thực tế xấu đi; nếu giá đã về gần cắt lỗ
  thì setup gần như hỏng. (Dòng "Giá giờ" giải quyết phần này nếu có.)

**Khung "Kiểm chứng: setup trên coin mạnh có tốt hơn không?"**: so tỉ lệ
thắng của setup trên coin ⭐ với setup trên các coin khác (cùng bộ dò,
cùng thời gian). Cần ít nhất 20 setup đã kết thúc mỗi bên mới có kết luận.
"Chưa có setup nào kết thúc" / "Chưa đủ dữ liệu" = **chưa có bằng chứng
setup có lợi thế**. Bot cũng dặn đừng dùng tiền thật cho tới khi có kết luận.

**Khung "Kiểm chứng: setup lúc BTC 1D giảm có tệ hơn không?"**: so tỉ lệ
chạm chốt lời của setup tìm thấy khi BTC 1D đang giảm với lúc BTC tăng hoặc
đi ngang (mọi coin trừ BTC, tính từ 23/10/2026). Cũng cần 20 setup kết thúc
mỗi bên. "Tệ hơn rõ" = nên bỏ qua setup altcoin khi BTC giảm; "chưa đủ
mẫu" = chưa biết, lời dặn "xem xu hướng BTC" vẫn chỉ là kinh nghiệm.

## 5. Watchlist ⭐ "coin mạnh"

Chọn từ bảng Coins mỗi ngày, tối đa 6 coin, theo các cổng (không có điểm):

- RS vs BTC 30 ngày > 0 **và** đường RS trên trung bình 20 ngày của nó.
- Không mang nhãn dòng tiền bán (Spot bán ròng, Short mở thêm, Đi ngang
  spot xả).
- Không phải coin có mọi chỉ số cơ bản (DefiLlama) đều xấu.

⭐ = đang mạnh hơn BTC gần đây. Không có nghĩa là sẽ còn mạnh.

## 6. Trang Coins: quét rộng mỗi ngày

- Top ~30 coin theo khối lượng spot, chạy **1 lần/ngày** sau nến ngày UTC
  (khoảng 7–8h sáng giờ Việt Nam). Số liệu là của ngày đã đóng, không phải
  realtime.
- Cột RS 7d / 30d so với BTC; mặc định xếp theo RS 30d.
- **Nhãn dòng tiền 7 ngày** (dựa trên hướng giá ±3%, chênh lệch mua/bán
  spot, OI thay đổi, funding):

| Nhãn | Nghĩa |
|---|---|
| Spot mua dẫn | Giá tăng, spot mua chủ động nhiều hơn, đòn bẩy không tăng mạnh. |
| Spot + đòn bẩy | Giá tăng, spot mua ròng nhưng OI/funding cũng nóng lên. |
| Đòn bẩy kéo | Giá tăng nhờ OI tăng hoặc long trả funding cao, spot không mua ròng rõ. |
| Short bị ép | Giá tăng, OI tăng, funding âm: vị thế mới chủ yếu là short chặn đà. Short đóng có thể đẩy thêm, hết short thì đà thường hụt. |
| Short đóng lệnh | Giá tăng, OI giảm: phần lớn short mua lại. |
| Tăng, chưa xác nhận | Giá tăng nhưng không thấy spot mua hay đòn bẩy rõ. |
| Spot bán ròng | Giá giảm, spot bán chủ động nhiều hơn. |
| Short mở thêm | Giá giảm, OI tăng: nhiều khả năng short mới. |
| Long xả đòn bẩy | Giá giảm, OI giảm: long đóng hoặc bị thanh lý. |
| Giảm, chưa rõ phe | Giá giảm, không thấy spot bán hay OI đổi rõ. |
| Đi ngang, spot gom | Giá đứng, spot mua ròng: có người hấp thụ lượng bán. |
| Đi ngang, spot xả | Giá đứng, spot bán ròng. |
| Đòn bẩy tích tụ | Giá đứng, OI tăng mạnh: dễ biến động lớn (chưa biết hướng). |
| Yên ắng | Không có chuyển động đáng kể. |

- Màu nhãn chỉ nói mức độ tiền spot giải thích được chuyển động,
  **không nói nên mua**.
- "Spot mỏng" = khối lượng spot so với perp thấp hơn một nửa trung vị của
  ngày: giá dễ bị futures chi phối.
- Chỉ số cơ bản (DefiLlama): phí 30 ngày, TVL, stablecoin trên chain, so
  với chính nó trước đó. **Không có dữ liệu unlock** (nguồn trả phí).
- Báo cáo "edge" của nhãn và RS: chưa đủ ngày dữ liệu, dự kiến có kết luận
  khoảng giữa tháng 12/2026. Hiện **chưa chứng minh nhãn nào dự báo được giá**.

## 7. Khối lượng vào lệnh (`/risk`)

```
số coin = vốn × %rủi ro ÷ |giá vào − cắt lỗ|
```

Chạm cắt lỗ thì mất đúng %rủi ro đã chọn (mặc định 1%, cho phép 0.1–5%).
Ví dụ vốn 1.000$, rủi ro 1%, vào 4.93, cắt lỗ 4.42: 10$ ÷ 0.51 ≈ 19.6 coin
≈ 97$ (khoảng 10% vốn). Nếu khối lượng tính ra lớn hơn vốn, tool khuyên
**không** thêm đòn bẩy để đạt con số đó.

## 8. Các phần khác

- **Journal** (`/trade`, `/close`, `/stop`, trang Journal): ghi lệnh, cắt
  lỗ, luận điểm. Kết quả lưu bằng % và R. Lệnh đang mở hiển thị "≈ tạm tính"
  (ước lượng, không cộng vào tổng P&L thật). Dưới −1.1R = không tôn trọng
  cắt lỗ.
- **Cảnh báo thoát** (coin đang giữ / ⭐): mỗi ngày báo khi nhãn chuyển sang
  bán/xả, funding âm chuyển dương (hết ép short), RS xuống dưới trung bình
  20 ngày, mất ⭐, rơi khỏi top 30. Mỗi giờ: giá ±3% kèm OI ±5% so với nến
  ngày gần nhất, và báo chạm/gần cắt lỗ của lệnh trong journal. Đây là lời
  nhắc kế hoạch, **không phải lệnh bán**. Kiểm tra theo giờ nên có thể lỡ
  râu nến.
- **Digest buổi sáng / "Của bạn"**: tóm tắt BTC/ETH/SOL, coin nổi bật,
  lệnh đang mở của chính người dùng.
- **Gems** (coin nhỏ trên DEX): hai điểm độc lập **Gem Score** (thanh khoản,
  khối lượng, áp lực mua theo số giao dịch, tuổi pool, đà) và **Risk Score**
  (an toàn hợp đồng, tập trung holder, thanh khoản mỏng, pool non, pump quá
  đà). Kết quả kiểm tra an toàn "danger" thì bị loại; "unknown" ≠ an toàn.
  Chỉ là mẫu từ vài nguồn (một số là token trả tiền quảng cáo), không phải
  toàn bộ thị trường. Rủi ro mất trắng cao.
- **Narrative / Sectors**: ngành so với BTC (trung vị coin trong ngành).
  Dẫn dắt = 7d và 30d đều hơn BTC; Mới nổi = chỉ 7d; Đang phai = chỉ 30d;
  Tụt hậu = cả hai thua. "Hẹp" = vài coin gánh cả ngành.
- **Flywheel**: dự án mà doanh thu chảy về holder (buyback, đốt, chia phí)
  30 ngày, "%/năm vốn hoá" giống tỉ suất cổ tức. Trên 50% thường là khoản
  một lần hoặc vốn hoá lưu hành nhỏ. "Lệch pha" = doanh thu tăng ≥20% mà giá
  giảm ≥10%.
- **Airdrop**: dự án TVL ≥10M chưa có token, kèm lý do và điểm chưa biết.
  Không chấm điểm, không biết chắc có airdrop.
- **Lookup**: tra một coin bất kỳ: nhãn dòng tiền đã lưu, ngành, flywheel,
  các mốc 1D. Với địa chỉ contract on-chain thì không có chart.

## 9. Bẫy hay gặp khi đọc ảnh

1. Xem Healthy cao hoặc thẻ setup là "tín hiệu mua". Không phải.
2. Bỏ qua xu hướng 1D của BTC khi đọc setup altcoin.
3. Bỏ qua thời gian ("5h ago", ngày quét): giá đã thay đổi.
4. Nghĩ tool đã được kiểm chứng. Hiện **chưa** (khung Kiểm chứng/Performance
   cho biết số mẫu).
5. Cộng Healthy với Risk thành một điểm. Hai điểm luôn đọc riêng.
6. Đọc "SELLING ABSORPTION POSSIBLE" là "sắp tăng". Mới là khả năng.
7. Vào lệnh không có cắt lỗ, hoặc khối lượng không theo % rủi ro.
8. Dùng đòn bẩy để "đạt" khối lượng tính ra.

## 10. Mẫu câu hỏi gửi kèm ảnh

> Đây là ảnh từ tool trong GUIDE_FOR_AI. Hãy: (1) tóm tắt ảnh nói gì,
> (2) liệt kê điểm ủng hộ và điểm chống, kể cả xu hướng BTC, (3) điều cần
> kiểm tra thêm trước khi quyết định, (4) khối lượng nếu vốn của tôi là
> ___$ và rủi ro ___%. Đừng chỉ xác nhận điều tôi muốn nghe.
