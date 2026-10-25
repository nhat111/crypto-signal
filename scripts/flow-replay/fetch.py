"""Downloads the history the coin-scan flow replay needs, one JSON per coin.

The live scan reads a week of spot taker volume, open interest and funding
(ASSUMPTIONS §18). None of the live endpoints keep enough of that history,
so the replay assembles it from what does:

- Daily spot bars with the taker-buy split: Binance's public archive
  (data.binance.vision), monthly files plus daily files for the current
  month. Binance's own klines carry the taker field the scan was designed
  on; OKX's taker endpoint keeps only recent days.
- Open interest in coins: OKX `open-interest-history` (period 1Dutc),
  which goes back to about April 2024 and so sets the replay's start.
- Funding: Binance's archived funding files (OKX keeps three months).

Each source differs a little from what production read on a given day
(production mixes OKX, Binance, Bybit and Gate depending on who answered),
so this replays the rules, not the exact stored labels.

    python fetch.py --out data/
"""

from __future__ import annotations

import argparse
import calendar
import csv
import io
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path

DEFAULT_COINS = (
    'BTC ETH SOL BNB XRP DOGE ADA TRX LINK AVAX DOT LTC BCH ETC NEAR SUI APT ARB OP INJ TIA SEI '
    'ATOM AAVE UNI FIL HBAR RENDER FET WLD ENA ICP STX ONDO JUP PYTH LDO CRV GALA POL ALGO'
).split()

VISION = 'https://data.binance.vision/data'
UA = {'User-Agent': 'crypto-signal-flow-replay'}
DAY_MS = 86_400_000


def get(url: str) -> bytes | None:
    """Body, or None on 404 (a month before listing, a day not yet published)."""
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2**attempt)
        except Exception:
            time.sleep(2**attempt)
    raise RuntimeError(f'unreachable: {url}')


def zip_rows(body: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        text = z.read(z.namelist()[0]).decode()
    rows = list(csv.reader(io.StringIO(text)))
    # Newer archive files start with a header row, older ones do not.
    return [r for r in rows if r and r[0][:1].isdigit()]


def months(start: date, end: date) -> list[str]:
    out, d = [], date(start.year, start.month, 1)
    while d <= end:
        out.append(f'{d:%Y-%m}')
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return out


def to_ms(ts: str) -> int:
    t = int(ts)
    # Binance's spot archive switched to microseconds in 2025.
    return t // 1000 if t > 10**14 else t


def spot_bars(coin: str, start: date, end: date) -> list[list[float]]:
    """[openTime, close, quoteVolume, takerBuyQuoteVolume], oldest first."""
    sym = f'{coin}USDT'
    rows: dict[int, list[float]] = {}
    last_full = date(end.year, end.month, 1) - timedelta(days=1)
    for m in months(start, last_full):
        body = get(f'{VISION}/spot/monthly/klines/{sym}/1d/{sym}-1d-{m}.zip')
        for r in zip_rows(body) if body else []:
            rows[to_ms(r[0])] = [to_ms(r[0]), float(r[4]), float(r[7]), float(r[10])]
    d = date(end.year, end.month, 1)
    while d <= end:
        body = get(f'{VISION}/spot/daily/klines/{sym}/1d/{sym}-1d-{d:%Y-%m-%d}.zip')
        for r in zip_rows(body) if body else []:
            rows[to_ms(r[0])] = [to_ms(r[0]), float(r[4]), float(r[7]), float(r[10])]
        d += timedelta(days=1)
    return [rows[k] for k in sorted(rows)]


def funding(coin: str, start: date, end: date) -> list[list[float]]:
    """[fundingTime, rate] as printed (per settlement period), oldest first."""
    sym = f'{coin}USDT'
    out = []
    for m in months(start, end):
        body = get(f'{VISION}/futures/um/monthly/fundingRate/{sym}/{sym}-fundingRate-{m}.zip')
        for r in zip_rows(body) if body else []:
            # calc_time, funding_interval_hours, last_funding_rate
            out.append([to_ms(r[0]), float(r[2])])
    return sorted(out)


def okx_oi(coin: str, start: date, end: date) -> list[list[float]]:
    """[ts, oi in coins] at UTC days, oldest first."""
    inst = f'{coin}-USDT-SWAP'
    t0 = calendar.timegm(start.timetuple()) * 1000
    t_end = calendar.timegm(end.timetuple()) * 1000 + DAY_MS
    rows: dict[int, float] = {}
    while t0 < t_end:
        t1 = min(t0 + 90 * DAY_MS, t_end)
        url = (
            'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history'
            f'?instId={inst}&period=1Dutc&begin={t0}&end={t1}&limit=100'
        )
        body = json.loads(get(url) or b'{}')
        if body.get('code') not in ('0', None):
            if body.get('code') == '51001':
                return []  # no perpetual on OKX
            raise RuntimeError(f'OKX {inst}: {body}')
        for r in body.get('data', []):
            rows[int(r[0])] = float(r[2])
        t0 = t1
        time.sleep(0.45)  # rubik: 5 requests per 2 s
    return [[k, rows[k]] for k in sorted(rows)]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--out', default='flow-data')
    p.add_argument('--coins', default=','.join(DEFAULT_COINS))
    p.add_argument('--start', default='2024-02-01', help='bars from here (OI starts ~2024-04)')
    p.add_argument('--end', default=None, help='last day, default yesterday (UTC)')
    args = p.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else date.today() - timedelta(days=1)
    for coin in [c.strip().upper() for c in args.coins.split(',') if c.strip()]:
        path = out / f'{coin}.json'
        if path.exists():
            continue
        data = {
            'coin': coin,
            'spot': spot_bars(coin, start, end),
            'oi': okx_oi(coin, start, end),
            'funding': funding(coin, start, end),
        }
        path.write_text(json.dumps(data))
        print(f'  {coin}: {len(data["spot"])} bars, {len(data["oi"])} OI days, '
              f'{len(data["funding"])} funding prints', file=sys.stderr)


if __name__ == '__main__':
    main()
