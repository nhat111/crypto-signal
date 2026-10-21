'use client';

import { useState, type FormEvent } from 'react';
import { addFarmAction, deleteFarm, startFarm, updateFarm } from '@/lib/api';
import { FARM_QUIET_DAYS, formatFarmUsd, parseCostInput } from '@/lib/airdrop';
import { decimalEcho } from '@/lib/parseDecimal';
import { cx, formatDateTime } from '@/lib/format';
import type { Farm } from '@/lib/types';

const inputClass =
  'min-h-[36px] rounded-md border border-slate-800 bg-slate-950 px-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none';
const buttonClass = 'min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-50';

/**
 * The person's own log: what they farm, every interaction and what it
 * cost. Totals are read against what was received, because an airdrop
 * that paid less than the gas spent on it was a loss, however it felt.
 */
export function FarmPanel({ farms, onChanged }: { farms: Farm[]; onChanged: () => void }) {
  const active = farms.filter((f) => f.status === 'active');
  const finished = farms.filter((f) => f.status !== 'active');
  const spent = farms.reduce((s, f) => s + f.activity.totalCostUsd, 0);
  const received = farms.reduce((s, f) => s + (f.rewardUsd ?? 0), 0);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-200">Farm của bạn</h2>
        <p className="text-xs tabular-nums text-slate-400">
          Đã tốn <span className="text-slate-200">{formatFarmUsd(spent)}</span> · đã nhận <span className="text-slate-200">{formatFarmUsd(received)}</span> · ròng{' '}
          <span className={received - spent >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{formatFarmUsd(received - spent)}</span>
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Ghi mỗi lần tương tác và chi phí (gas, phí, chênh lệch bridge). Trên bot: <code className="rounded bg-slate-950 px-1">/farm Tên 0,5 ghi chú</code>.
      </p>

      <AddFarmForm onAdded={onChanged} />

      {active.length === 0 && finished.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">Chưa theo dõi dự án nào. Bấm “Theo dõi farm” trên một dự án bên dưới, hoặc thêm tay ở trên.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {active.map((f) => (
            <FarmItem key={f.id} farm={f} onChanged={onChanged} />
          ))}
          {finished.length > 0 && (
            <details className="rounded-lg border border-slate-800/70 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-400">Đã xong ({finished.length})</summary>
              <div className="mt-3 space-y-3">
                {finished.map((f) => (
                  <FarmItem key={f.id} farm={f} onChanged={onChanged} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function AddFarmForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await startFarm({ name: name.trim(), wallet: wallet.trim() || null });
      setName('');
      setWallet('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
      <input
        className={cx(inputClass, 'min-w-0 flex-1 basis-40')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Dự án (kể cả testnet, points ngoài danh sách)"
        maxLength={80}
        aria-label="Tên dự án"
      />
      <input
        className={cx(inputClass, 'w-32')}
        value={wallet}
        onChange={(e) => setWallet(e.target.value)}
        placeholder="Nhãn ví (vd ví 2)"
        maxLength={80}
        aria-label="Nhãn ví"
      />
      <button type="submit" disabled={busy || name.trim() === ''} className={cx(buttonClass, 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/25')}>
        Thêm
      </button>
      {error && <p className="w-full text-xs text-rose-300">{error}</p>}
    </form>
  );
}

function FarmItem({ farm, onChanged }: { farm: Farm; onChanged: () => void }) {
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [reward, setReward] = useState('');
  const [claiming, setClaiming] = useState(false);
  // Collapsed by default: on a phone, five open forms push the research
  // list below the fold. The stats line is what is read at a glance.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = farm.activity;
  const costValue = parseCostInput(cost);
  const rewardValue = parseCostInput(reward);
  const quiet = farm.status === 'active' && a.daysSinceLast !== null && a.daysSinceLast >= FARM_QUIET_DAYS;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const log = async (e: FormEvent) => {
    e.preventDefault();
    if (costValue === null) return;
    if (await run(() => addFarmAction(farm.id, costValue, note.trim() || null))) {
      setCost('');
      setNote('');
    }
  };

  const claim = async (e: FormEvent) => {
    e.preventDefault();
    if (rewardValue === null) return;
    if (await run(() => updateFarm(farm.id, { status: 'claimed', rewardUsd: rewardValue }))) setClaiming(false);
  };

  const last =
    a.lastActionAt === null ? 'chưa có tương tác' : a.daysSinceLast === 0 ? 'hôm nay' : `${a.daysSinceLast} ngày trước`;

  return (
    <div className={cx('rounded-lg border p-3', quiet ? 'border-amber-500/30' : 'border-slate-800')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
      >
        <span className="block text-sm font-semibold text-slate-100">
          <span className="mr-1.5 inline-block w-3 text-slate-500">{open ? '▾' : '▸'}</span>
          {farm.name}
          {farm.wallet && <span className="ml-2 text-xs font-normal text-slate-500">{farm.wallet}</span>}
          {farm.status !== 'active' && (
            <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-normal text-slate-400">
              {farm.status === 'claimed' ? 'đã claim' : 'đã bỏ'}
            </span>
          )}
        </span>
        <span className="block text-xs tabular-nums text-slate-400">
          {a.actionCount} lần · {a.activeWeeks} tuần · {a.activeMonths} tháng · tốn {formatFarmUsd(a.totalCostUsd)}
          {farm.netUsd !== null && (
            <span className={cx('ml-1', farm.netUsd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              · ròng {farm.netUsd > 0 ? '+' : ''}
              {formatFarmUsd(farm.netUsd)}
            </span>
          )}
        </span>
      </button>
      <p className={cx('mt-0.5 text-xs', quiet ? 'text-amber-300' : 'text-slate-500')}>
        Lần cuối: {last}
        {quiet && ' · lâu rồi chưa tương tác; đa số đợt airdrop đếm số tuần có hoạt động'}
      </p>

      {open && (
        <>
          {farm.status === 'active' && (
            <form onSubmit={log} className="mt-2 flex flex-wrap gap-2">
              <input
                className={cx(inputClass, 'w-24')}
                type="text"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Phí $"
                aria-label="Chi phí (USD)"
              />
              <input
                className={cx(inputClass, 'min-w-0 flex-1 basis-32')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Đã làm gì (swap, bridge, deposit…)"
                maxLength={500}
                aria-label="Ghi chú"
              />
              <button type="submit" disabled={busy || costValue === null} className={cx(buttonClass, 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25')}>
                Ghi
              </button>
              {costValue === null && <p className="w-full text-xs text-rose-300">Chi phí phải là số ≥ 0 (để trống = 0).</p>}
              {costValue !== null && decimalEcho(cost) && <p className="w-full text-xs text-slate-500">Sẽ lưu ${decimalEcho(cost)}</p>}
            </form>
          )}

          {farm.recentActions.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">Lịch sử ({farm.recentActions.length} gần nhất)</summary>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                {farm.recentActions.map((act) => (
                  <li key={act.id} className="tabular-nums">
                    {formatDateTime(act.at)} · {formatFarmUsd(act.costUsd)}
                    {act.note && ` · ${act.note}`}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {farm.status === 'active' ? (
          <>
                {claiming ? (
                  <form onSubmit={claim} className="flex flex-wrap gap-2">
                    <input
                      className={cx(inputClass, 'w-32')}
                      type="text"
                      inputMode="decimal"
                      value={reward}
                      onChange={(e) => setReward(e.target.value)}
                      placeholder="Nhận được $"
                      aria-label="Giá trị airdrop nhận được (USD)"
                      autoFocus
                    />
                    <button type="submit" disabled={busy || rewardValue === null} className={cx(buttonClass, 'bg-emerald-500/15 text-emerald-200')}>
                      Lưu
                    </button>
                    <button type="button" onClick={() => setClaiming(false)} className={cx(buttonClass, 'text-slate-400')}>
                      Huỷ
                    </button>
                  </form>
                ) : (
                  <button type="button" onClick={() => setClaiming(true)} className={cx(buttonClass, 'border border-slate-800 text-slate-300')}>
                    Đã nhận airdrop
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => updateFarm(farm.id, { status: 'dropped' }))}
                  className={cx(buttonClass, 'border border-slate-800 text-slate-400')}
                >
                  Bỏ dự án
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateFarm(farm.id, { status: 'active' }))}
                className={cx(buttonClass, 'border border-slate-800 text-slate-300')}
              >
                Mở lại
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Xoá ${farm.name} và toàn bộ lịch sử?`)) void run(() => deleteFarm(farm.id));
              }}
              className={cx(buttonClass, 'ml-auto text-rose-300/80 hover:text-rose-300')}
            >
              Xoá
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

