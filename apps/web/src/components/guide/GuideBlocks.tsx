import type { ReactNode } from 'react';

/**
 * Building blocks for the plain-language guide.
 *
 * Kept deliberately plain: this page is read by someone who does not know
 * the vocabulary yet, so every device here exists to make a comparison
 * legible (this vs that, jargon vs what it means) rather than to decorate.
 */

export function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-400">{eyebrow}</p>
      <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-100">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

/** An everyday comparison. The guide leans on these instead of definitions. */
export function Story({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-[3px] border-amber-400/70 bg-amber-400/[0.06] px-4 py-3.5">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-300">{title}</p>
      <div className="mt-2 space-y-2.5 text-[15px] leading-relaxed text-slate-200">{children}</div>
    </div>
  );
}

/** The one-line answer to "so what do I actually do with this". */
export function Takeaway({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Nhớ mỗi câu này</p>
      <p className="mt-1.5 text-[15px] font-medium leading-relaxed text-slate-100">{children}</p>
    </div>
  );
}

/** A common misreading, stated as the misreading first so it is recognisable. */
export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-rose-300">Dễ hiểu nhầm</p>
      <div className="mt-1.5 space-y-2 text-[15px] leading-relaxed text-slate-200">{children}</div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-900/70">
            {head.map((h) => (
              <th key={h} className="border-b border-slate-800 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td key={j} className="border-b border-slate-800/70 px-3.5 py-2.5 text-slate-300 last:border-r-0">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Numbered steps, used only where the content really is a sequence. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-xs font-bold tabular-nums text-sky-300">
            {i + 1}
          </span>
          <span className="text-slate-300">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Term({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-slate-100">{children}</span>;
}
