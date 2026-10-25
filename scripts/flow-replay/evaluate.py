"""Scores the replayed flow labels against what each coin did next.

The coin-scan labels describe the last seven days and say so (§18): none
was built as a forecast. The question here is whether any of them carries
one anyway, which is what a reader acting on "Spot dẫn dắt" or "Short bị
ép" is betting on.

For every label and horizon (3, 7, 14 days), from the close of the day the
label was read:

- Raw: the coin's own return, as a spot buyer would get it, before fees.
- Excess: the coin's return minus the average of every coin read that day,
  which takes out whatever the whole market did.
- Shuffle test: labels are shuffled among the coins of each day 1,000
  times; the share of shuffles whose excess is at least as far from zero
  as the real one is the p-value. Shuffling within a day keeps the
  market's path and the overlap between consecutive days intact, which a
  plain t-test on overlapping 7-day returns would not.
- By year, so a label that only worked in the 2024 rally shows it.

    python evaluate.py --data flow-data --labels labels.csv --out report.md
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

HORIZONS = (3, 7, 14)
# Vietnamese labels as the bot shows them (apps/web/src/lib/coinFlow.ts).
FLOW_VI = {
    'spot_led': 'Spot mua dẫn',
    'spot_and_leverage': 'Spot + đòn bẩy',
    'leverage_led': 'Đòn bẩy kéo',
    'short_squeeze': 'Short bị ép',
    'short_covering': 'Short đóng lệnh',
    'up_unconfirmed': 'Tăng, chưa xác nhận',
    'spot_selling': 'Spot bán ròng',
    'shorts_building': 'Short mở thêm',
    'long_unwind': 'Long xả đòn bẩy',
    'down_unconfirmed': 'Giảm, chưa rõ phe',
    'accumulation': 'Đi ngang, spot gom',
    'distribution': 'Đi ngang, spot xả',
    'leverage_building': 'Đòn bẩy tích tụ',
    'quiet': 'Yên ắng',
}


def forward_returns(data_dir: Path) -> pd.DataFrame:
    """Log returns from each day's close to h days later, per coin."""
    frames = []
    for path in sorted(data_dir.glob('*.json')):
        d = json.loads(path.read_text())
        s = pd.Series({pd.Timestamp(r[0], unit='ms'): r[1] for r in d['spot']}).sort_index()
        # Reindex to calendar days so a missing bar is a gap, not a shift.
        s = s.reindex(pd.date_range(s.index[0], s.index[-1], freq='D'))
        df = pd.DataFrame({'day': s.index, 'symbol': f'{d["coin"]}USDT'})
        for h in HORIZONS:
            df[f'fwd{h}'] = np.log(s.shift(-h) / s).to_numpy()
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def label_stats(df: pd.DataFrame, h: int, shuffles: int, rng) -> pd.DataFrame:
    col, ex = f'fwd{h}', f'ex{h}'
    d = df.dropna(subset=[col]).copy()
    d[ex] = d[col] - d.groupby('day')[col].transform('mean')
    real = d.groupby('flow')[ex].mean()

    # Shuffle labels within each day.
    days = d['day'].to_numpy()
    order = np.argsort(days, kind='stable')
    d = d.iloc[order].reset_index(drop=True)
    bounds = np.flatnonzero(np.r_[True, d['day'].to_numpy()[1:] != d['day'].to_numpy()[:-1], True])
    flows = d['flow'].to_numpy()
    exv = d[ex].to_numpy()
    names = sorted(real.index)
    idx = {n: i for i, n in enumerate(names)}
    codes = np.array([idx[f] for f in flows])
    counts = np.bincount(codes, minlength=len(names))
    extreme = np.zeros(len(names))
    for _ in range(shuffles):
        perm = codes.copy()
        for a, b in zip(bounds[:-1], bounds[1:]):
            rng.shuffle(perm[a:b])
        sums = np.bincount(perm, weights=exv, minlength=len(names))
        means = sums / np.maximum(counts, 1)
        extreme += np.abs(means) >= np.abs(real.reindex(names).to_numpy()) - 1e-12
    p = pd.Series((extreme + 1) / (shuffles + 1), index=names)

    g = d.groupby('flow')
    out = pd.DataFrame({
        'n': g.size(),
        'days': g['day'].nunique(),
        'raw_pct': g[col].mean() * 100,
        'excess_pct': real * 100,
        'beat_avg': g[ex].apply(lambda s: (s > 0).mean()),
        'p': p,
    })
    for year, gy in d.groupby(d['day'].dt.year):
        out[f'ex_{year}'] = gy.groupby('flow')[ex].mean() * 100
    return out.sort_values('excess_pct', ascending=False)


def fmt(x, spec):
    return '' if pd.isna(x) else format(x, spec)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data', required=True, help='folder of <COIN>.json from fetch.py')
    p.add_argument('--labels', required=True, help='CSV from label.ts')
    p.add_argument('--out', default='flow-replay-report.md')
    p.add_argument('--shuffles', type=int, default=1000)
    p.add_argument('--fee', type=float, default=0.001, help='per side, for the spot note')
    args = p.parse_args()

    labels = pd.read_csv(args.labels, parse_dates=['day'])
    total = len(labels)
    # Only coin-days the full read was possible on: OI and funding both
    # present. Earlier days (before OKX's OI records) and the weeks after the
    # last archived funding month would otherwise read as spot-only labels.
    labels = labels[labels.hasOi & labels.hasFunding]
    df = labels.merge(forward_returns(Path(args.data)), on=['day', 'symbol'], how='left')
    rng = np.random.default_rng(0)

    lines = [
        '# Coin-scan flow labels: what came next',
        '',
        f'{df.day.min():%Y-%m-%d} to {df.day.max():%Y-%m-%d}, {df.symbol.nunique()} coins, '
        f'{len(df)} coin-days with the full read (of {total} labelled). Labels from the '
        'production `readCoin`; spot bars and funding from Binance\'s archive, open interest '
        'from OKX. Excess = the coin\'s return minus the average coin that day. '
        f'p = share of {args.shuffles} within-day label shuffles at least as far from zero.',
        '',
    ]
    for h in HORIZONS:
        st = label_stats(df, h, args.shuffles, rng)
        years = [c for c in st.columns if c.startswith('ex_')]
        lines += [
            f'## {h} days after the read',
            '',
            '| Label | Coin-days | Days | Raw | Excess | Beat avg | p | '
            + ' | '.join(c[3:] for c in years) + ' |',
            '|---|---|---|---|---|---|---|' + '---|' * len(years),
        ]
        for flow, r in st.iterrows():
            lines.append(
                f'| {FLOW_VI.get(flow, flow)} (`{flow}`) | {int(r.n)} | {int(r.days)} | {fmt(r.raw_pct, "+.2f")}% | '
                f'{fmt(r.excess_pct, "+.2f")}% | {r.beat_avg:.0%} | {r.p:.3f} | '
                + ' | '.join(f'{fmt(r[c], "+.2f")}%' for c in years)
                + ' |'
            )
        lines.append('')
    n_labels = df.flow.nunique()
    lines += [
        '## How to read this',
        '',
        f'- {n_labels} labels × {len(HORIZONS)} horizons = {n_labels * len(HORIZONS)} tests: '
        f'about {n_labels * len(HORIZONS) * 0.05:.0f} will show p < 0.05 by chance alone. A label '
        'counts only if p is small at 7 days, the sign holds at 3 and 14 days, and every year '
        'agrees.',
        f'- A spot buyer pays about {2 * args.fee * 100:.1f}% per round trip; an excess smaller '
        'than that is not a trade even if it is real.',
        '- The 41 coins are today\'s survivors, chosen in 2026. Excess is measured against the '
        'same 41, so the bias cancels in that column but not in Raw.',
    ]
    Path(args.out).write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
