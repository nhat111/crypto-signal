# Coin-scan flow label replay (offline, not part of the bot)

Asks whether any coin-scan flow label (ASSUMPTIONS §18) says anything about
what the coin does next, without waiting for months of stored scans. The
labels describe the last seven days and were never built as forecasts;
this measures whether one works as one anyway.

1. `fetch.py`: daily spot bars with the taker-buy split and funding from
   Binance's public archive (data.binance.vision), open interest in coins
   from OKX (history from about April 2024), for the 41 replayed coins.
2. `label.ts`: the production `readCoin` and thresholds over every
   coin-day, timed like the ~00:45 UTC scan.
3. `evaluate.py`: 3/7/14-day return after each label, against the day's
   average coin, by year, with a within-day label shuffle test.

```bash
python3 scripts/flow-replay/fetch.py --out flow-data          # ~25 min
npx tsx scripts/flow-replay/label.ts flow-data labels.csv
python3 scripts/flow-replay/evaluate.py --data flow-data --labels labels.csv --out report.md
```

(`evaluate.py` needs numpy and pandas.)

`short.py` turns `short_squeeze` into the trade a reader would take: a
short on the perpetual after the second labelled day, ATR stop, fees and
funding, scored in R against a blind short and a within-day shuffle:

```bash
python3 scripts/flow-replay/short.py --data flow-data --labels labels.csv --perp perp-data --out short-report.md
``` The sources differ from what
production read on a given day (it mixes OKX, Binance, Bybit and Gate), so
this replays the rules, not the stored labels.

## Result (`report-2024-04_2026-10.md`)

35,588 coin-days, 2/4/2024 – 5/10/2026. Out of 42 label × horizon tests,
one label stands out:

- **Short bị ép (`short_squeeze`)**: 14 days later the coin trailed the
  day's average coin by 2.6% (p 0.001, 394 coin-days, 30 coins; 7 days:
  −1.3%, p 0.002). 2024 −5.1%, 2025 −4.6%, 2026 +2.2% on the mean but
  −2.4% on the median (2026 Q2 was the exception). Without its five most
  frequent coins: −2.4%. On the first day of a squeeze it is only −0.6%:
  the weakness comes from coins that stay labelled for days, the later
  part of the move, which matches the label's own text ("khi hết short
  thì đà tăng thường hụt").
- Nothing else clears the bar (small p at 7 days, same sign at 3 and 14,
  every year). "Spot mua dẫn" is +0.3–0.4% at 3–7 days but p 0.09–0.17
  and gone by 14; "Spot + đòn bẩy" is +1.5% at 14 days (p 0.013) but
  negative in 2024 and with 42 tests one or two such results are
  expected by chance.

## As a short (`short-report-2024-04_2026-10.md`)

77 trades on 25 coins over 14 days. Without a stop the short gains 3.7%
on average (blind short +0.2%, p 0.016), but the losses are squeezes:
WLD −62%, four more near −30%. With a stop the edge is gone: 1.5 × ATR
+0.05R against +0.04R for a blind short (p 0.42), 2 × ATR +0.15R (p 0.06),
2024 and 2026 negative. Short coin + long BTC is +3.0% (win 68%), all of
it 2024–2025; 2026 −0.4%. Not a trade; it stays an exit reason.
