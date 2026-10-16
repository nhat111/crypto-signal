'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { cx, formatPct, formatTokenPrice } from '@/lib/format';
import { changeSinceClose, FLOW_META, shortDay, type FlowTone } from '@/lib/coinFlow';
import type { CoinFlow, CoinScanRow, CoinsLiveResponse } from '@/lib/types';

const TONE_CLASS: Record<FlowTone, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  mixed: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  warn: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  bad: 'border-red-500/30 bg-red-500/10 text-red-300',
  neutral: 'border-slate-700 bg-slate-800/60 text-slate-300',
};

export function FlowBadge({ flow }: { flow: CoinFlow }) {
  const meta = FLOW_META[flow] ?? { label: flow, tone: 'neutral' as const, meaning: '' };
  return (
    <span className={cx('inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium', TONE_CLASS[meta.tone])}>
      {meta.label}
    </span>
  );
}

function Signed({ value, digits = 1 }: { value: number | null; digits?: number }) {
  return (
    <span className={cx('tabular-nums', value === null ? 'text-slate-600' : value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-slate-300')}>
      {formatPct(value, digits)}
    </span>
  );
}

function FundamentalsCell({ f }: { f: CoinScanRow['fundamentals'] }) {
  if (!f) return <span className="text-slate-600">—</span>;
  if (f.bull.length === 0 && f.bear.length === 0) {
    return <span className="text-slate-500">{f.chain || f.protocol ? 'Không đổi rõ' : 'Không khớp'}</span>;
  }
  return (
    <span className="whitespace-nowrap tabular-nums">
      {f.bull.length > 0 && <span className="text-emerald-300">▲{f.bull.length}</span>}
      {f.bull.length > 0 && f.bear.length > 0 && ' '}
      {f.bear.length > 0 && <span className="text-red-300">▼{f.bear.length}</span>}
    </span>
  );
}

/** The fundamentals behind the arrows: which chain/protocol matched, and each driver. */
function FundamentalsDetail({ f }: { f: CoinScanRow['fundamentals'] }) {
  if (!f) return null;
  const matched = [f.chain && `chain ${f.chain.name}`, f.protocol && `protocol ${f.protocol.name}`].filter(Boolean).join(' · ');
  return (
    <div className="space-y-0.5">
      <p className="text-slate-400">
        <span className="font-medium text-slate-300">Cơ bản (DefiLlama)</span>
        {matched ? `: ${matched}` : ''}
      </p>
      {f.bull.map((b) => (
        <p key={b} className="text-emerald-300">▲ {b}</p>
      ))}
      {f.bear.map((b) => (
        <p key={b} className="text-red-300">▼ {b}</p>
      ))}
      {matched && f.bull.length === 0 && f.bear.length === 0 && <p className="text-slate-500">Phí, TVL, stablecoin không đổi đủ lớn để tính.</p>}
      {f.unknowns.length > 0 && <p className="text-slate-500">{f.unknowns.join(' ')}</p>}
    </div>
  );
}

/** The price now and its move since the scan's close, kept visually lighter than the scan's own columns. */
function LiveCell({ close, price }: { close: number; price: number | undefined }) {
  if (price === undefined) return <td className="px-3 py-2 text-right text-slate-600">—</td>;
  return (
    <td className="px-3 py-2 text-right">
      <div className="tabular-nums text-slate-400">{formatTokenPrice(price)}</div>
      <div className="text-[10px]"><Signed value={changeSinceClose(close, price)} /></div>
    </td>
  );
}

/** Taker skew as "buy share minus sell share", in percentage points of volume. */
const skewPct = (skew: number | null): number | null => (skew === null ? null : skew * 100);

/**
 * The scan as one table. Wide by nature, so it scrolls inside its own box
 * with the coin column pinned — the page itself never scrolls sideways.
 * A row opens to the reasons behind its label and what could not be read.
 */
export function CoinTable({
  rows,
  trackedSymbols,
  watchlist = [],
  closeDay = null,
  live = null,
}: {
  rows: CoinScanRow[];
  trackedSymbols: string[];
  watchlist?: string[];
  /** The scan day (`YYYY-MM-DD`): every column but the live one is computed up to that day's close. */
  closeDay?: string | null;
  /** Prices now, or null while loading / when OKX could not be read. */
  live?: CoinsLiveResponse | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const day = shortDay(closeDay);
  const liveAt = live ? new Date(live.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full min-w-[840px] text-left text-xs">
        <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-900 px-3 py-2 font-medium">Coin</th>
            <th className="px-3 py-2 text-right font-medium" title="Lãi/lỗ hơn BTC trong cùng 30 ngày">vs BTC 30N</th>
            <th className="px-3 py-2 text-right font-medium" title="Lãi/lỗ hơn BTC trong cùng 7 ngày">vs BTC 7N</th>
            <th className="px-3 py-2 font-medium">Dòng tiền 7N</th>
            <th className="px-3 py-2 font-medium" title="Phí, TVL, stablecoin từ DefiLlama: số yếu tố tăng ▲ / giảm ▼">Cơ bản</th>
            <th className="px-3 py-2 text-right font-medium">Giá 7N</th>
            <th className="px-3 py-2 text-right font-medium">Giá 30N</th>
            <th className="px-3 py-2 text-right font-medium" title="Mua chủ động trừ bán chủ động trên spot, % khối lượng 7 ngày">Spot lệch 7N</th>
            <th className="px-3 py-2 text-right font-medium" title="Thay đổi open interest 7 ngày, tính theo hợp đồng">OI 7N</th>
            <th className="px-3 py-2 text-right font-medium" title="Funding trung bình 7 ngày, quy về mỗi 8 giờ">Funding/8h</th>
            {/* Labelled with its day: an unlabelled "Giá" read as the price now, and on the day after a scan it is a full day old. */}
            <th
              className="px-3 py-2 text-right font-medium"
              title={`Giá đóng nến ngày${day ? ` ${day}` : ''} (UTC, tức 7h sáng hôm sau giờ VN). Mọi cột bên trái đều tính tới nến này.`}
            >
              {day ? `Đóng ${day}` : 'Giá đóng'}
            </th>
            <th
              className="px-3 py-2 text-right font-medium"
              title={`Giá OKX${liveAt ? ` lúc ${liveAt}` : ''}, làm mới mỗi phút, và % so với giá đóng. Chỉ để biết giá đang ở đâu: các cột 7N/30N và nhãn dòng tiền không đổi theo giá này.`}
            >
              Hiện tại
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = open === row.symbol;
            const base = row.symbol.replace(/USDT$/, '');
            return (
              <Fragment key={row.symbol}>
                <tr
                  onClick={() => setOpen(isOpen ? null : row.symbol)}
                  className={cx('cursor-pointer border-t border-slate-800/80 hover:bg-slate-900/60', isOpen && 'bg-slate-900/60')}
                  aria-expanded={isOpen}
                >
                  <td className={cx('sticky left-0 z-10 px-3 py-2', isOpen ? 'bg-slate-900' : 'bg-slate-950')}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-right text-[10px] tabular-nums text-slate-600">#{row.volumeRank}</span>
                      <span className="font-semibold text-slate-100">{base}</span>
                      {row.rsAboveSma20 === true && row.symbol !== 'BTCUSDT' && (
                        <span className="text-[10px] text-emerald-400" title="Tỉ giá với BTC trên trung bình 20 ngày">▲</span>
                      )}
                      {watchlist.includes(row.symbol) && (
                        <span className="text-[10px]" title="Danh sách theo dõi: setup 4H của coin này được báo trên Telegram">⭐</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right"><Signed value={row.symbol === 'BTCUSDT' ? null : row.rs30d} /></td>
                  <td className="px-3 py-2 text-right"><Signed value={row.symbol === 'BTCUSDT' ? null : row.rs7d} /></td>
                  <td className="px-3 py-2"><FlowBadge flow={row.flow} /></td>
                  <td className="px-3 py-2"><FundamentalsCell f={row.fundamentals} /></td>
                  <td className="px-3 py-2 text-right"><Signed value={row.ret7d} /></td>
                  <td className="px-3 py-2 text-right"><Signed value={row.ret30d} /></td>
                  <td className="px-3 py-2 text-right"><Signed value={skewPct(row.takerSkew7d)} /></td>
                  <td className="px-3 py-2 text-right"><Signed value={row.oiChange7dPct} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {row.fundingAvg7dPct === null ? <span className="text-slate-600">—</span> : `${row.fundingAvg7dPct.toFixed(4)}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{formatTokenPrice(row.close)}</td>
                  <LiveCell close={row.close} price={live?.prices[row.symbol]} />
                </tr>
                {isOpen && (
                  <tr className="border-t border-slate-800/40 bg-slate-900/40">
                    <td colSpan={12} className="px-3 py-3">
                      <div className="sticky left-3 max-w-[calc(100vw-4rem)] space-y-2 sm:max-w-3xl">
                        <p className="text-slate-400">{FLOW_META[row.flow]?.meaning}</p>
                        <ul className="list-disc space-y-0.5 pl-4 text-slate-300">
                          {row.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                        <FundamentalsDetail f={row.fundamentals} />
                        {row.unknowns.length > 0 && (
                          <div className="text-slate-500">
                            <span className="font-medium">Không đọc được: </span>
                            {row.unknowns.join(' ')}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3 pt-1">
                          <Link href={`/lookup?q=${encodeURIComponent(row.symbol)}`} className="text-sky-400 hover:text-sky-300">
                            Xem chart (Lookup) →
                          </Link>
                          {trackedSymbols.includes(row.symbol) && (
                            <Link href={`/symbol/${row.symbol}`} className="text-sky-400 hover:text-sky-300">
                              Chi tiết Health/Risk →
                            </Link>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
