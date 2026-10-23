'use client';

import { useState } from 'react';
import { cx } from '@/lib/format';

/**
 * Copies `text`. A function is called at click time, so a setup copied
 * minutes after the page loaded still says how old it is now; a server
 * component can only pass a string (functions do not cross to the client).
 */
export function CopyButton({ text, label, className }: { text: string | (() => string); label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(typeof text === 'string' ? text : text());
      setState('copied');
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions).
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cx(
        'inline-flex min-h-[36px] items-center text-xs font-medium',
        state === 'copied' ? 'text-emerald-400' : state === 'failed' ? 'text-rose-400' : 'text-slate-400 hover:text-slate-200',
        className,
      )}
    >
      {state === 'copied' ? 'Đã chép' : state === 'failed' ? 'Không chép được' : label}
    </button>
  );
}
