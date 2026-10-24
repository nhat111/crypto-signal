# Kronos experiment (offline, not part of the bot)

Tests [Kronos](https://github.com/shiyu-coder/Kronos), a pretrained
candlestick forecasting model, on the 41 OKX spot coins the setup and
breakout replays used (ASSUMPTIONS §21, §27). Nothing here is imported by
the worker, API or web; it writes CSVs and a Markdown report to a folder.

Kronos's pretraining data ends in June 2024 (arXiv 2508.02739), so only
decision dates from July 2024 on are tested; the script refuses an earlier
`--test-start`.

## Run

```bash
git clone https://github.com/shiyu-coder/Kronos /path/to/Kronos   # tested at 67b630e
python3 -m venv .venv
.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
.venv/bin/pip install -r scripts/kronos/requirements.txt
.venv/bin/python scripts/kronos/kronos_experiment.py --kronos-dir /path/to/Kronos --out kronos-out
```

Defaults: Kronos-small, daily bars (`1Dutc`), 256-bar lookback, 5-bar
horizon, 8 sampled paths per coin-date, top 5 coins, 0.1% fee per side.
About 2–3 hours on 4 CPU cores. Forecasts are appended to a CSV as they
are made, so an interrupted run resumes; `--eval-only` rebuilds the report
from them. `--bar 4H`, `--model NeoQuasar/Kronos-mini --tokenizer
NeoQuasar/Kronos-Tokenizer-2k --max-context 2048` and `--horizon` give
other variants, each cached under its own file name.

## What it reports

- **Direction.** Per-date rank IC of the forecast return against the
  realised one, against 20-bar momentum and 5-bar reversal; a top-K
  long-only spot portfolio after fees against momentum, equal weight,
  hold BTC and 500 random top-K draws.
- **Volatility.** The forecast range over the horizon against the realised
  range, against ATR14, plus a rank regression on both to see whether
  Kronos adds anything once ATR is known.

The bar for "worth more work" is written at the end of the report. Data
are today's surviving coins, which flatters every long row equally.
