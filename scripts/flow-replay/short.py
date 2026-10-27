"""Replays `short_squeeze` as an actual short on the perpetual, after costs.

`evaluate.py` found that a coin labelled "Short bị ép" trails the day's
average coin by about 2.6% over 14 days (ASSUMPTIONS §28). That is a
relative number before costs; a reader who shorts the coin gets the
absolute move, pays fees and, while the label holds, pays funding (the
label needs funding at or below `fundingShortsPayPct`). This turns the
read into the trade a reader would take and scores it in R.

Rules, fixed before the first run:

- Signal: the coin is labelled `short_squeeze` on day D and on D-1, the
  same "second day" the held/⭐ alert reports (§22). Read at ~00:45 UTC on
  D+1, so the short opens at the D+1 open of the USDT-M perpetual.
- One trade per coin at a time: a signal while that coin's short is open
  is skipped (the label repeats daily while a squeeze lasts).
- Stop: entry + k × ATR(14) of the perpetual's daily bars through D, for
  k in 1, 1.5, 2, plus a no-stop variant. A daily high at or above the
  stop fills at the stop, or at the open when the day gaps through it.
- Exit: the close of the 14th day held (7 as a check), unless stopped.
- Costs: 0.05% taker per side; every funding print while the short is
  open is added at its rate (a short receives positive funding and pays
  negative), scaled by the price move since entry.
- R = result ÷ stop distance, both as a share of the entry price.

Controls:

- Every coin-day with the full read, same rules (no non-overlap): what a
  short entered blindly earns over the same period.
- Within-day shuffle: each signal swapped for a random coin read the same
  day, 1,000 times; p is the share of shuffles whose mean R is at least as
  good for the short.
- Hedged: short the coin and long BTC with the same notional, no stop,
  both legs paying fees and funding. The excess that `evaluate.py`
  measured, made tradeable with one instrument.

    python short.py --data flow-data --labels labels.csv --perp perp-data --out short-report.md

Perpetual daily bars come from Binance's archive (data.binance.vision),
cached one JSON per coin in --perp. Needs numpy and pandas.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from fetch import VISION, get, months, to_ms, zip_rows

FEE = 0.0005  # taker, per side
STOPS = (1.0, 1.5, 2.0, None)
HOLDS = (14, 7)
ATR_DAYS = 14


def perp_bars(coin: str, start: date, end: date, cache: Path) -> pd.DataFrame:
    """Daily OHLC of the USDT-M perpetual, indexed by UTC day."""
    path = cache / f'{coin}.json'
    if path.exists():
        rows = json.loads(path.read_text())
    else:
        sym = f'{coin}USDT'
        got: dict[int, list[float]] = {}

        def add(body):
            for r in zip_rows(body) if body else []:
                t = to_ms(r[0])
                got[t] = [t, float(r[1]), float(r[2]), float(r[3]), float(r[4])]

        last_full = date(end.year, end.month, 1) - timedelta(days=1)
        for m in months(start, last_full):
            add(get(f'{VISION}/futures/um/monthly/klines/{sym}/1d/{sym}-1d-{m}.zip'))
        d = date(end.year, end.month, 1)
        while d <= end:
            add(get(f'{VISION}/futures/um/daily/klines/{sym}/1d/{sym}-1d-{d:%Y-%m-%d}.zip'))
            d += timedelta(days=1)
        rows = [got[k] for k in sorted(got)]
        path.write_text(json.dumps(rows))
    df = pd.DataFrame(rows, columns=['t', 'open', 'high', 'low', 'close'])
    df.index = pd.to_datetime(df.pop('t'), unit='ms')
    return df.asfreq('D')


def atr(df: pd.DataFrame) -> pd.Series:
    prev = df['close'].shift(1)
    tr = pd.concat([df.high - df.low, (df.high - prev).abs(), (df.low - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(ATR_DAYS).mean()


def short_trade(bars: pd.DataFrame, fund: pd.Series, day: pd.Timestamp, a: float, k, hold: int):
    """Short opened at the open after `day`; (pct result, R or nan, stopped) or None."""
    entry_day = day + pd.Timedelta(days=1)
    seg = bars.loc[entry_day: entry_day + pd.Timedelta(days=hold - 1)]
    if len(seg) < hold or seg.isna().any().any():
        return None
    entry = seg.open.iloc[0]
    stop = entry + k * a if k is not None else None
    exit_px, exit_t, stopped = seg.close.iloc[-1], seg.index[-1] + pd.Timedelta(days=1), False
    if stop is not None:
        hit = np.flatnonzero(seg.high.to_numpy() >= stop)
        if len(hit):
            i = hit[0]
            exit_px = max(stop, seg.open.iloc[i])
            exit_t, stopped = seg.index[i] + pd.Timedelta(hours=12), True  # funding through mid-day
    pnl = (entry - exit_px) / entry - 2 * FEE
    prints = fund.loc[entry_day + pd.Timedelta(milliseconds=1): exit_t]
    if len(prints):
        scale = bars.close.reindex(prints.index.floor('D')).ffill().fillna(entry).to_numpy() / entry
        pnl += float((prints.to_numpy() * scale).sum())
    r = pnl / (k * a / entry) if k is not None else np.nan
    return pnl, r, stopped


def long_leg(bars: pd.DataFrame, fund: pd.Series, day: pd.Timestamp, hold: int):
    """A long on the same window, no stop: the hedge leg."""
    entry_day = day + pd.Timedelta(days=1)
    seg = bars.loc[entry_day: entry_day + pd.Timedelta(days=hold - 1)]
    if len(seg) < hold or seg.isna().any().any():
        return None
    entry = seg.open.iloc[0]
    pnl = seg.close.iloc[-1] / entry - 1 - 2 * FEE
    prints = fund.loc[entry_day + pd.Timedelta(milliseconds=1): seg.index[-1] + pd.Timedelta(days=1)]
    if len(prints):
        scale = bars.close.reindex(prints.index.floor('D')).ffill().fillna(entry).to_numpy() / entry
        pnl -= float((prints.to_numpy() * scale).sum())
    return pnl


def summarize(t: pd.DataFrame, col: str) -> dict:
    s = t[col].dropna()
    if not len(s):
        return {}
    return {
        'n': len(s), 'mean': s.mean(), 'median': s.median(), 'win': (s > 0).mean(),
        'total': s.sum(),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data', required=True, help='folder of <COIN>.json from fetch.py (funding)')
    p.add_argument('--labels', required=True, help='CSV from label.ts')
    p.add_argument('--perp', default='perp-data', help='cache of perpetual daily bars')
    p.add_argument('--out', default='short-report.md')
    p.add_argument('--shuffles', type=int, default=1000)
    args = p.parse_args()

    labels = pd.read_csv(args.labels, parse_dates=['day'])
    labels = labels[labels.hasOi & labels.hasFunding].sort_values(['symbol', 'day'])
    end = labels.day.max().date() + timedelta(days=21)
    end = min(end, date.today() - timedelta(days=1))
    start = labels.day.min().date() - timedelta(days=40)
    cache = Path(args.perp)
    cache.mkdir(parents=True, exist_ok=True)

    bars, funds, atrs = {}, {}, {}
    for path in sorted(Path(args.data).glob('*.json')):
        d = json.loads(path.read_text())
        sym = f'{d["coin"]}USDT'
        b = perp_bars(d['coin'], start, end, cache)
        if b.empty:
            continue
        bars[sym], atrs[sym] = b, atr(b)
        f = pd.Series({pd.Timestamp(r[0], unit='ms'): r[1] for r in d['funding']}, dtype=float)
        funds[sym] = f.sort_index()
    labels = labels[labels.symbol.isin(bars)]

    # Trade outcome for every coin-day with the full read: the blind
    # baseline, and the pool the shuffle draws from.
    rows = []
    for r in labels.itertuples():
        a = atrs[r.symbol].get(r.day, np.nan)
        if not a or np.isnan(a):
            continue
        row = {'day': r.day, 'symbol': r.symbol, 'flow': r.flow}
        ok = True
        for hold in HOLDS:
            for k in STOPS:
                out = short_trade(bars[r.symbol], funds[r.symbol], r.day, a, k, hold)
                if out is None:
                    ok = False
                    break
                tag = f'{hold}d_{k if k is not None else "none"}'
                row[f'pct_{tag}'], row[f'r_{tag}'], row[f'stop_{tag}'] = out
            if not ok:
                break
            hedge = long_leg(bars['BTCUSDT'], funds['BTCUSDT'], r.day, hold)
            row[f'hedge_{hold}d'] = row[f'pct_{hold}d_none'] + hedge if hedge is not None else np.nan
        if ok:
            rows.append(row)
    allt = pd.DataFrame(rows)

    # Signals: second consecutive squeeze day, one open trade per coin.
    sq = labels[labels.flow == 'short_squeeze'][['day', 'symbol']]
    prev = set(zip(sq.day + pd.Timedelta(days=1), sq.symbol))
    cand = sq[[(d, s) in prev for d, s in zip(sq.day, sq.symbol)]]
    cand = cand.merge(allt, on=['day', 'symbol'], how='inner').sort_values(['symbol', 'day'])

    def non_overlap(c: pd.DataFrame, hold: int) -> pd.DataFrame:
        keep, busy = [], {}
        for r in c.itertuples():
            if r.day >= busy.get(r.symbol, pd.Timestamp.min):
                keep.append(r.Index)
                busy[r.symbol] = r.day + pd.Timedelta(days=hold)
        return c.loc[keep]

    rng = np.random.default_rng(0)
    by_day = {d: g.index.to_numpy() for d, g in allt.groupby('day')}

    def shuffle_p(sig: pd.DataFrame, col: str) -> float:
        real = sig[col].mean()
        pool = allt[col].to_numpy()
        picks = [by_day[d] for d in sig.day]
        better = 0
        for _ in range(args.shuffles):
            m = np.mean([pool[rng.choice(ix)] for ix in picks])
            better += m >= real - 1e-12
        return (better + 1) / (args.shuffles + 1)

    pct = lambda x: f'{x * 100:+.2f}%'
    lines = [
        '# `short_squeeze` as a short on the perpetual',
        '',
        f'{allt.day.min():%Y-%m-%d} to {allt.day.max():%Y-%m-%d}, {allt.symbol.nunique()} coins. '
        'Signal: labelled `short_squeeze` two days running; short at the next UTC open; '
        f'{FEE * 100:.2f}% taker per side; funding at each print. Rules in `short.py`.',
        '',
    ]
    for hold in HOLDS:
        sig = non_overlap(cand, hold)
        lines += [
            f'## Held {hold} days',
            '',
            f'{len(sig)} trades on {sig.symbol.nunique()} coins '
            f'({len(cand)} signal days before the one-trade-per-coin rule).',
            '',
            '| Stop | Mean R | Median R | Win | Mean % | Stopped | p (shuffle) | Blind short, mean R | Blind % |',
            '|---|---|---|---|---|---|---|---|---|',
        ]
        for k in STOPS:
            tag = f'{hold}d_{k if k is not None else "none"}'
            s, b = summarize(sig, f'pct_{tag}'), summarize(allt, f'pct_{tag}')
            if k is None:
                pv = shuffle_p(sig, f'pct_{tag}')
                lines.append(f'| none | | | {s["win"]:.0%} | {pct(s["mean"])} | | {pv:.3f} | | {pct(b["mean"])} |')
                continue
            sr, br = summarize(sig, f'r_{tag}'), summarize(allt, f'r_{tag}')
            pv = shuffle_p(sig, f'r_{tag}')
            lines.append(
                f'| {k:g} × ATR | {sr["mean"]:+.2f} | {sr["median"]:+.2f} | {sr["win"]:.0%} | {pct(s["mean"])} | '
                f'{sig[f"stop_{tag}"].mean():.0%} | {pv:.3f} | {br["mean"]:+.2f} | {pct(b["mean"])} |'
            )
        h, hb = summarize(sig, f'hedge_{hold}d'), summarize(allt, f'hedge_{hold}d')
        lines += [
            '',
            f'Hedged (short coin + long BTC, no stop): mean {pct(h["mean"])}, median {pct(h["median"])}, '
            f'win {h["win"]:.0%}; blind {pct(hb["mean"])}.',
            '',
        ]
        if hold == HOLDS[0]:
            main_tag = f'r_{hold}d_1.5'
            yr = sig.groupby(sig.day.dt.year).agg(n=(main_tag, 'size'), mean_r=(main_tag, 'mean'),
                                                  win=(main_tag, lambda x: (x > 0).mean()),
                                                  hedge=(f'hedge_{hold}d', 'mean'))
            lines += ['By year (1.5 × ATR stop):', '', '| Year | Trades | Mean R | Win | Hedged mean |', '|---|---|---|---|---|']
            for y, r in yr.iterrows():
                lines.append(f'| {y} | {int(r.n)} | {r.mean_r:+.2f} | {r.win:.0%} | {pct(r.hedge)} |')
            worst = sig.nsmallest(5, f'pct_{hold}d_none')[['day', 'symbol', f'pct_{hold}d_none']]
            lines += ['', 'Worst five without a stop:', '']
            for r in worst.itertuples():
                lines.append(f'- {r.day:%Y-%m-%d} {r.symbol}: {pct(getattr(r, f"pct_{hold}d_none"))}')
            sig.to_csv(Path(args.out).with_suffix('.trades.csv'), index=False)
            lines.append('')
    Path(args.out).write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
