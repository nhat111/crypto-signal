"""Offline test of Kronos (github.com/shiyu-coder/Kronos) on OKX spot coins.

The question: does a pretrained candlestick model forecast anything these
coins' own simple history does not, on data it never saw? Kronos was
pretrained on data up to June 2024 (paper, arXiv 2508.02739), so only bars
closed after that are tested. Nothing here touches the bot, the database or
production; it is a one-off script whose report decides whether Kronos is
worth any more work.

What is measured, at each decision bar t (every `horizon` bars, so holding
periods never overlap):

- Direction: Kronos's mean forecast return over the next `horizon` bars
  against the realised one, as a cross-sectional rank IC per date (the
  paper's own metric) and as a top-K long-only spot portfolio after fees.
  Baselines: 20-bar momentum, 5-bar reversal, equal weight on every coin,
  hold BTC, and random top-K picks (the portfolio is placed as a percentile
  of 500 random draws, since one lucky path proves nothing).
- Volatility: the spread of Kronos's sampled paths (the forecast range over
  the horizon) against the realised range. Baseline: ATR14, which already
  predicts range well; Kronos has to beat it, not just correlate.

Each sample is a separate series in the batch (sample_count=1), because
Kronos's own sample_count averages paths and so hides the spread the
volatility test needs.

Usage (see README.md next to this file):

    python kronos_experiment.py --kronos-dir /path/to/Kronos --out out/
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

# The 41 pairs the setup and breakout replays used (DEFAULT_BREAKOUT_SYMBOLS
# in packages/shared/src/config.ts), so results compare with ASSUMPTIONS §21/§27.
DEFAULT_COINS = (
    'BTC ETH SOL BNB XRP DOGE ADA TRX LINK AVAX DOT LTC BCH ETC NEAR SUI APT ARB OP INJ TIA SEI '
    'ATOM AAVE UNI FIL HBAR RENDER FET WLD ENA ICP STX ONDO JUP PYTH LDO CRV GALA POL ALGO'
).split()

# OKX's plain 1D/4H bars close on Hong Kong time; the *utc bars match the
# daily close the rest of the repo uses (packages/market-data/src/okx/spotCandles.ts).
OKX_BAR = {'1D': '1Dutc', '4H': '4Hutc', '1H': '1H'}
BAR_MS = {'1D': 86_400_000, '4H': 14_400_000, '1H': 3_600_000}
PRETRAIN_END = '2024-07-01'


# --------------------------------------------------------------------------
# Data


def fetch_okx(inst_id: str, bar: str, since_ms: int) -> pd.DataFrame:
    """All closed bars from since_ms to now, oldest first."""
    rows: list[list[str]] = []
    after = ''
    while True:
        url = (
            f'https://www.okx.com/api/v5/market/history-candles?instId={inst_id}'
            f'&bar={OKX_BAR[bar]}&limit=100' + (f'&after={after}' if after else '')
        )
        for attempt in range(5):
            try:
                # OKX's edge refuses urllib's default User-Agent with a 403.
                req = urllib.request.Request(url, headers={'User-Agent': 'crypto-signal-kronos-experiment'})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = json.loads(resp.read())
                break
            except Exception:  # network blips; OKX also rate-limits at 20 req/2s
                time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f'OKX unreachable for {inst_id}')
        if body.get('code') != '0':
            raise RuntimeError(f'OKX {inst_id}: {body.get("msg")}')
        page = body['data']
        if not page:
            break
        rows.extend(page)
        oldest = int(page[-1][0])
        if oldest <= since_ms:
            break
        after = str(oldest)
        time.sleep(0.12)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(
        [[int(r[0]), *map(float, r[1:5]), float(r[5]), float(r[7]), r[8]] for r in rows],
        columns=['ts', 'open', 'high', 'low', 'close', 'volume', 'amount', 'confirm'],
    )
    df = df[(df.confirm == '1') & (df.ts >= since_ms)].drop(columns='confirm')
    df = df.drop_duplicates('ts').sort_values('ts').reset_index(drop=True)
    df['timestamps'] = pd.to_datetime(df.ts, unit='ms')
    return df


def load_coins(coins: list[str], bar: str, since: str, cache: Path) -> dict[str, pd.DataFrame]:
    cache.mkdir(parents=True, exist_ok=True)
    since_ms = int(pd.Timestamp(since).timestamp() * 1000)
    out = {}
    for coin in coins:
        path = cache / f'{coin}-USDT_{bar}.csv'
        if path.exists():
            df = pd.read_csv(path, parse_dates=['timestamps'])
        else:
            df = fetch_okx(f'{coin}-USDT', bar, since_ms)
            if df.empty:
                print(f'  {coin}: no OKX spot data, skipped', file=sys.stderr)
                continue
            df.to_csv(path, index=False)
        out[coin] = df.set_index('ts')
        print(f'  {coin}: {len(df)} bars from {df.timestamps.iloc[0]:%Y-%m-%d}', file=sys.stderr)
    return out


# --------------------------------------------------------------------------
# Forecasts


def load_kronos(kronos_dir: str, model_name: str, tokenizer_name: str, max_context: int):
    sys.path.insert(0, str(Path(kronos_dir).resolve()))
    from model import Kronos, KronosPredictor, KronosTokenizer  # type: ignore

    tokenizer = KronosTokenizer.from_pretrained(tokenizer_name)
    model = Kronos.from_pretrained(model_name)
    return KronosPredictor(model, tokenizer, device='cpu', max_context=max_context)


def load_timesfm(checkpoint: str):
    from timesfm3 import ModelConfig, TimesFM3Evaluator  # type: ignore

    return TimesFM3Evaluator(ModelConfig(checkpoint_path=checkpoint, per_core_batch_size=64, device='cpu'))


def windows_at(data, t: int, args) -> list[tuple[str, pd.DataFrame]]:
    """The last `lookback` bars up to and including t, per coin that has them."""
    step = BAR_MS[args.bar]
    out = []
    for coin, df in data.items():
        if t not in df.index:
            continue
        i = df.index.get_loc(t)
        if i + 1 < args.lookback:
            continue
        hist = df.iloc[i + 1 - args.lookback : i + 1]
        # A gap (delisting pause, missing bars) would hand the model a
        # series that is not what it looks like; skip that coin-date.
        if (hist.index[-1] - hist.index[0]) != (args.lookback - 1) * step:
            continue
        out.append((coin, hist))
    return out


def kronos_rows(predictor, t: int, wins, args) -> list[dict]:
    """Kronos reads full OHLCV; one sampled path per batch entry."""
    import torch

    # Same seed per date: a rerun gives the same paths.
    torch.manual_seed(int(t // 1000) % (2**31))
    step = BAR_MS[args.bar]
    cols = ['open', 'high', 'low', 'close', 'volume', 'amount']
    future_ts = pd.Series(pd.to_datetime([t + step * k for k in range(1, args.horizon + 1)], unit='ms'))
    dfs, xs, ys, keys = [], [], [], []
    for coin, hist in wins:
        for s in range(args.samples):
            dfs.append(hist[cols].reset_index(drop=True))
            xs.append(hist.timestamps.reset_index(drop=True))
            ys.append(future_ts)
            keys.append((coin, s))
    preds = []
    for b in range(0, len(dfs), args.batch):
        preds += predictor.predict_batch(
            dfs[b : b + args.batch], xs[b : b + args.batch], ys[b : b + args.batch],
            pred_len=args.horizon, T=args.temperature, top_p=args.top_p,
            sample_count=1, verbose=False,
        )
    return [
        {
            'ts': t, 'coin': coin, 'sample': s,
            'pred_close': float(p.close.iloc[-1]),
            'pred_high': float(p.high.max()),
            'pred_low': float(p.low.min()),
        }
        for (coin, s), p in zip(keys, preds)
    ]


def timesfm_rows(forecaster, t: int, wins, args) -> list[dict]:
    """TimesFM reads the close series only and is deterministic: its nine
    quantile paths (0.1 … 0.9) stand in for Kronos's sampled paths, so the
    mean, share-above-entry and spread read the same way downstream. The
    high/low of a quantile path is not a forecast intraday range, so
    pred_high/pred_low are left empty and the range test uses the spread."""
    contexts = [hist.close.to_numpy(dtype=np.float32) for _, hist in wins]
    # Benchmark defaults (symmetric averaging, positive, sorted quantiles):
    # the settings Google reports its own scores with.
    outs = list(forecaster.predict_batch(contexts, horizon=args.horizon, return_quantiles=True))
    rows = []
    for (coin, _), out in zip(wins, outs):
        q = np.asarray(out.quantiles)[: args.horizon]  # (horizon, 9)
        for s in range(q.shape[1]):
            rows.append({
                'ts': t, 'coin': coin, 'sample': s,
                'pred_close': float(q[-1, s]),
                'pred_high': np.nan,
                'pred_low': np.nan,
            })
    return rows


def forecast_all(make_rows, data, dates, args, cache_path: Path) -> pd.DataFrame:
    """One row per (date, coin, sample): forecast close at the horizon and
    the forecast high/low over it. Resumes from cache_path if present."""
    done = pd.read_csv(cache_path) if cache_path.exists() else pd.DataFrame()
    done_dates = set(done.ts.unique()) if not done.empty else set()
    started = time.time()
    todo = [t for t in dates if t not in done_dates]
    for n, t in enumerate(todo, 1):
        wins = windows_at(data, t, args)
        if not wins:
            continue
        rows = make_rows(t, wins)
        pd.DataFrame(rows).to_csv(cache_path, mode='a', header=not cache_path.exists(), index=False)
        elapsed = time.time() - started
        eta = elapsed / n * (len(todo) - n)
        print(
            f'  {pd.Timestamp(t, unit="ms"):%Y-%m-%d %H:%M}  {len(wins)} coins'
            f'  [{n}/{len(todo)}, ~{eta / 60:.0f} min left]',
            file=sys.stderr,
        )
    return pd.read_csv(cache_path)


# --------------------------------------------------------------------------
# Evaluation


def build_panel(data, preds: pd.DataFrame, args) -> pd.DataFrame:
    """One row per (date, coin) with Kronos's signals, baselines and the
    realised outcome. Pure function of the inputs."""
    h = args.horizon
    atr14 = {
        coin: pd.concat(
            [df.high - df.low, (df.high - df.close.shift()).abs(), (df.low - df.close.shift()).abs()],
            axis=1,
        ).max(axis=1).rolling(14).mean()
        for coin, df in data.items()
    }
    rows = []
    for (ts, coin), g in preds.groupby(['ts', 'coin']):
        df = data[coin]
        i = df.index.get_loc(ts)
        if i + h >= len(df):
            continue  # outcome not closed yet
        c0 = df.close.iloc[i]
        fut = df.iloc[i + 1 : i + h + 1]
        closes = g.pred_close.to_numpy()
        rows.append({
            'ts': ts,
            'coin': coin,
            'k_ret': math.log(closes.mean() / c0),
            'k_prob_up': float(np.mean(closes > c0)),
            # NaN for TimesFM, whose quantile paths carry no intraday high/low.
            'k_range': math.log(g.pred_high.mean() / g.pred_low.mean()) if g.pred_high.notna().all() else np.nan,
            'k_spread': closes.std(ddof=1) / c0 if len(closes) > 1 else np.nan,
            'mom20': math.log(c0 / df.close.iloc[i - 20]) if i >= 20 else np.nan,
            'rev5': -math.log(c0 / df.close.iloc[i - 5]) if i >= 5 else np.nan,
            'atr_pct': atr14[coin].iloc[i] / c0,
            'ret': math.log(fut.close.iloc[-1] / c0),
            'range': math.log(fut.high.max() / fut.low.min()),
            'abs_ret': abs(math.log(fut.close.iloc[-1] / c0)),
        })
    return pd.DataFrame(rows)


def rank_ic(panel: pd.DataFrame, signal: str, target: str) -> tuple[float, float, int]:
    """Mean per-date Spearman correlation, its t-stat, and the date count."""
    ics = []
    for _, g in panel.dropna(subset=[signal, target]).groupby('ts'):
        if len(g) >= 5:
            ics.append(g[signal].rank().corr(g[target].rank()))
    ics = np.array([x for x in ics if not np.isnan(x)])
    if len(ics) < 2:
        return float('nan'), float('nan'), len(ics)
    return ics.mean(), ics.mean() / ics.std(ddof=1) * math.sqrt(len(ics)), len(ics)


def portfolio(panel: pd.DataFrame, pick, fee: float) -> pd.Series:
    """Per-period net return of an equal-weight spot basket chosen by
    pick(group) -> rows, bought at the close of t and sold h bars later.
    Cash (0) when nothing is picked."""
    out = {}
    for ts, g in panel.groupby('ts'):
        chosen = pick(g)
        if len(chosen) == 0:
            out[ts] = 0.0
        else:
            out[ts] = float((np.exp(chosen.ret) - 1).mean()) - 2 * fee
    return pd.Series(out).sort_index()


def summarise(name: str, r: pd.Series, bars_per_year: float, h: int) -> dict:
    eq = (1 + r).cumprod()
    dd = (eq / eq.cummax() - 1).min()
    periods_per_year = bars_per_year / h
    sharpe = r.mean() / r.std(ddof=1) * math.sqrt(periods_per_year) if r.std() > 0 else float('nan')
    by_year = (1 + r).groupby(pd.to_datetime(r.index, unit='ms').year).prod() - 1
    return {
        'name': name,
        'periods': len(r),
        'invested': int((r != 0).sum()),
        'mean_pct': r.mean() * 100,
        'total_pct': (eq.iloc[-1] - 1) * 100,
        'max_dd_pct': dd * 100,
        'sharpe': sharpe,
        'by_year': {int(y): round(v * 100, 1) for y, v in by_year.items()},
    }


def evaluate(panel: pd.DataFrame, args) -> str:
    h, k, fee = args.horizon, args.top_k, args.fee
    bars_per_year = 365 * 86_400_000 / BAR_MS[args.bar]
    lines = [
        f'# Kronos on OKX spot: {args.model}, {args.bar} bars, horizon {h}',
        '',
        f'Test window: {pd.Timestamp(panel.ts.min(), unit="ms"):%Y-%m-%d} to '
        f'{pd.Timestamp(panel.ts.max(), unit="ms"):%Y-%m-%d} (Kronos\'s pretraining ends {PRETRAIN_END[:7]}), '
        f'{panel.ts.nunique()} decision dates, {panel.coin.nunique()} coins, '
        f'{len(panel)} coin-dates. Lookback {args.lookback} bars, '
        + (
            'close only, 9 quantile paths. '
            if args.family == 'timesfm'
            else f'{args.samples} sampled paths, T={args.temperature}, top_p={args.top_p}. '
        )
        + f'Fee {fee * 100:.2f}% per side.',
        '',
        '## Direction: rank IC against the realised return',
        '',
        'Mean per-date Spearman correlation across coins. |t| under ~2 is noise.',
        '',
        '| Signal | IC | t | Dates |',
        '|---|---|---|---|',
    ]
    for sig, label in [
        ('k_ret', 'Kronos mean forecast return'),
        ('k_prob_up', 'Kronos share of paths up'),
        ('mom20', 'Momentum, 20 bars'),
        ('rev5', 'Reversal, 5 bars'),
    ]:
        ic, t, n = rank_ic(panel, sig, 'ret')
        lines.append(f'| {label} | {ic:+.3f} | {t:+.1f} | {n} |')

    up_rate = (panel.ret > 0).mean()
    called_up = panel[panel.k_ret > 0]
    called_dn = panel[panel.k_ret <= 0]
    lines += [
        '',
        f'Sign: {up_rate:.0%} of coin-dates rose. When Kronos forecast up '
        f'({len(called_up)}), {(called_up.ret > 0).mean():.0%} rose; when it forecast down '
        f'({len(called_dn)}), {(called_dn.ret > 0).mean():.0%} rose.',
        '',
        '## Volatility: forecast range against the realised range',
        '',
        'Pooled Spearman over every coin-date, and per-date across coins. ATR14 is the bar to beat.',
        '',
        '| Signal | Pooled vs range | Per-date IC vs range | t | Pooled vs abs return |',
        '|---|---|---|---|---|',
    ]
    for sig, label in [
        ('k_range', 'Kronos forecast range'),
        ('k_spread', 'Kronos spread of path closes'),
        ('atr_pct', 'ATR14 / close'),
    ]:
        if panel[sig].isna().all():
            continue
        pooled = panel[sig].rank().corr(panel['range'].rank())
        pooled_abs = panel[sig].rank().corr(panel['abs_ret'].rank())
        ic, t, _ = rank_ic(panel, sig, 'range')
        lines.append(f'| {label} | {pooled:.3f} | {ic:+.3f} | {t:+.1f} | {pooled_abs:.3f} |')
    # Does Kronos add anything once ATR is known? Rank-regress the realised
    # range on both; a Kronos coefficient near 0 means it only restates ATR.
    vol_sig = 'k_range' if panel.k_range.notna().all() else 'k_spread'
    x = np.column_stack([
        np.ones(len(panel)),
        panel.atr_pct.rank(pct=True),
        panel[vol_sig].rank(pct=True),
    ])
    beta, *_ = np.linalg.lstsq(x, panel.range.rank(pct=True), rcond=None)
    lines += [
        '',
        f'Rank regression of realised range on both: ATR {beta[1]:+.3f}, Kronos {beta[2]:+.3f} '
        f'(`{vol_sig}`; Kronos near 0 = it adds nothing over ATR).',
        '',
        f'## Portfolio: top {k} long-only spot, held {h} bars, fees in',
        '',
        '| Strategy | Periods (invested) | Mean / period | Total | Max DD | Sharpe | By year |',
        '|---|---|---|---|---|---|---|',
    ]
    strategies = {
        f'Kronos top {k}': lambda g: g.nlargest(k, 'k_ret'),
        f'Kronos top {k}, only forecast up': lambda g: g[g.k_ret > 0].nlargest(k, 'k_ret'),
        f'Kronos top {k}, ≥{args.prob_gate:.0%} paths up': (
            lambda g: g[g.k_prob_up >= args.prob_gate].nlargest(k, 'k_ret')
        ),
        f'Momentum top {k}': lambda g: g.dropna(subset=['mom20']).nlargest(k, 'mom20'),
        'Equal weight, every coin': lambda g: g,
        'Hold BTC': lambda g: g[g.coin == 'BTC'],
    }
    results = {}
    for name, pick in strategies.items():
        r = portfolio(panel, pick, fee)
        results[name] = r
        s = summarise(name, r, bars_per_year, h)
        years = ', '.join(f'{y}: {v:+.1f}%' for y, v in s['by_year'].items())
        lines.append(
            f'| {name} | {s["periods"]} ({s["invested"]}) | {s["mean_pct"]:+.2f}% | '
            f'{s["total_pct"]:+.1f}% | {s["max_dd_pct"]:.1f}% | {s["sharpe"]:.2f} | {years} |'
        )

    rng = np.random.default_rng(0)
    random_totals = []
    for _ in range(500):
        r = portfolio(panel, lambda g: g.sample(min(k, len(g)), random_state=rng), fee)
        random_totals.append((1 + r).prod() - 1)
    random_totals = np.array(random_totals)
    k_total = (1 + results[f'Kronos top {k}']).prod() - 1
    pct = (random_totals < k_total).mean()
    lines += [
        '',
        f'Random top {k} (500 draws): median total {np.median(random_totals) * 100:+.1f}%, '
        f'5th–95th percentile {np.percentile(random_totals, 5) * 100:+.1f}% to '
        f'{np.percentile(random_totals, 95) * 100:+.1f}%. Kronos top {k} beats '
        f'{pct:.0%} of them.',
        '',
        '## How to read this',
        '',
        '- Direction is worth more work only if the Kronos IC is positive with t above ~2, '
        'beats momentum and reversal, and the top-K portfolio sits above the 95th percentile '
        'of random picks in both years, after fees.',
        '- Volatility is worth more work only if the Kronos range beats ATR14 and keeps a '
        'clearly positive coefficient once ATR is in the regression.',
        '- The coins are today\'s survivors (picked in 2026), which flatters every long '
        'strategy here equally; compare rows, not absolute returns.',
    ]
    report = '\n'.join(lines) + '\n'
    if args.family == 'timesfm':
        # Every "Kronos " in the text names the model under test; "Kronos's
        # pretraining" is the test window's cutoff and stays.
        report = report.replace('Kronos ', 'TimesFM ')
    return report


# --------------------------------------------------------------------------


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--family', choices=['kronos', 'timesfm'], default='kronos')
    p.add_argument('--kronos-dir', help='a clone of github.com/shiyu-coder/Kronos (family kronos)')
    p.add_argument('--out', default='kronos-out', help='output folder (data cache, forecasts, report)')
    p.add_argument('--model', default=None,
                   help='default NeoQuasar/Kronos-small, or google/timesfm-3.0-pytorch')
    p.add_argument('--tokenizer', default='NeoQuasar/Kronos-Tokenizer-base')
    p.add_argument('--max-context', type=int, default=512, help='2048 for Kronos-mini')
    p.add_argument('--coins', default=','.join(DEFAULT_COINS))
    p.add_argument('--bar', choices=list(OKX_BAR), default='1D')
    p.add_argument('--lookback', type=int, default=256)
    p.add_argument('--horizon', type=int, default=5, help='bars forecast and held')
    p.add_argument('--samples', type=int, default=8, help='sampled paths per coin-date')
    p.add_argument('--temperature', type=float, default=1.0)
    p.add_argument('--top-p', type=float, default=0.9)
    p.add_argument('--test-start', default=PRETRAIN_END,
                   help='first decision date; never before the pretraining end')
    p.add_argument('--test-end', default=None)
    p.add_argument('--top-k', type=int, default=5)
    p.add_argument('--prob-gate', type=float, default=0.6)
    p.add_argument('--fee', type=float, default=0.001, help='per side, 0.001 = 0.1%%')
    p.add_argument('--batch', type=int, default=128, help='series per forward pass')
    p.add_argument('--threads', type=int, default=0, help='torch CPU threads, 0 = default')
    p.add_argument('--eval-only', action='store_true', help='report from cached forecasts')
    args = p.parse_args()

    if args.model is None:
        args.model = 'NeoQuasar/Kronos-small' if args.family == 'kronos' else 'google/timesfm-3.0-pytorch'
    if args.family == 'kronos' and not args.kronos_dir:
        sys.exit('--kronos-dir is required for --family kronos.')
    if args.family == 'timesfm':
        args.samples = 9  # its nine quantiles, not samples
    # TimesFM 3.0's training data hold no crypto prices from 2024 on
    # (GiftEval, Wikipedia to 11/2023, Google Trends to 2022, synthetic), so
    # the same window as Kronos is out of sample for both and they compare.
    if pd.Timestamp(args.test_start) < pd.Timestamp(PRETRAIN_END):
        sys.exit(f'--test-start before {PRETRAIN_END} would test on Kronos\'s own training data.')

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    coins = [c.strip().upper() for c in args.coins.split(',') if c.strip()]
    # Enough history before the first test date for the lookback and ATR.
    warmup_bars = args.lookback + 30
    since = pd.Timestamp(args.test_start) - pd.Timedelta(milliseconds=BAR_MS[args.bar] * warmup_bars)

    print(f'Loading {len(coins)} coins, {args.bar}, from {since:%Y-%m-%d}', file=sys.stderr)
    data = load_coins(coins, args.bar, str(since.date()), out / 'data')

    btc = data.get('BTC')
    if btc is None:
        sys.exit('BTC data is needed to define the decision dates.')
    start_ms = int(pd.Timestamp(args.test_start).timestamp() * 1000)
    end_ms = int(pd.Timestamp(args.test_end).timestamp() * 1000) if args.test_end else None
    all_ts = [t for t in btc.index if t >= start_ms and (end_ms is None or t <= end_ms)]
    dates = all_ts[:: args.horizon]

    samples = 'Q9' if args.family == 'timesfm' else f'S{args.samples}'
    tag = f'{args.model.split("/")[-1]}_{args.bar}_L{args.lookback}_H{args.horizon}_{samples}'
    cache_path = out / f'forecasts_{tag}.csv'
    if args.eval_only:
        preds = pd.read_csv(cache_path)
    else:
        import torch

        if args.threads:
            torch.set_num_threads(args.threads)
        if args.family == 'kronos':
            predictor = load_kronos(args.kronos_dir, args.model, args.tokenizer, args.max_context)
            make_rows = lambda t, wins: kronos_rows(predictor, t, wins, args)  # noqa: E731
        else:
            forecaster = load_timesfm(args.model)
            make_rows = lambda t, wins: timesfm_rows(forecaster, t, wins, args)  # noqa: E731
        print(f'Forecasting {len(dates)} decision dates -> {cache_path}', file=sys.stderr)
        preds = forecast_all(make_rows, data, dates, args, cache_path)

    panel = build_panel(data, preds, args)
    panel.to_csv(out / f'panel_{tag}.csv', index=False)
    report = evaluate(panel, args)
    (out / f'report_{tag}.md').write_text(report)
    print(report)


if __name__ == '__main__':
    main()
