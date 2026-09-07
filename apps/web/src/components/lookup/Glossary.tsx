/**
 * What each reading means, in words, on the page.
 *
 * The explanations used to live in `title=` attributes. There is no hover
 * on a touch screen, so on the device this dashboard is actually read on
 * they were invisible — which is the same as not having written them.
 *
 * A `<details>` instead: closed by default so it does not push the numbers
 * down, open in one tap, and the text is real text rather than a tooltip
 * the browser may or may not show.
 */
export function Glossary({ title, items }: { title: string; items: Array<{ term: string; text: string }> }) {
  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wide text-slate-400 hover:text-slate-200">
        <span className="group-open:hidden">{title} ▸</span>
        <span className="hidden group-open:inline">{title} ▾</span>
      </summary>
      <dl className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="text-xs font-semibold text-slate-300">{item.term}</dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export const TECHNICAL_GLOSSARY: Array<{ term: string; text: string }> = [
  {
    term: 'RSI 14',
    text:
      'Compares the size of the last 14 bars’ gains against their losses, on a 0–100 scale. Above 70 and below 30 are the conventional markers, but they are only conventions — plenty of instruments spend weeks above 70 while still rising. The line underneath is the part that makes it usable: where this reading sits against this instrument’s own last 200 bars.',
  },
  {
    term: 'Trend (EMA20 vs EMA50)',
    text:
      'Two moving averages of the closing price, one over 20 bars and one over 50. When the faster sits above the slower, recent prices are above the older ones. The gap is shown because a 0.1% separation and a 12% separation are not the same statement; anything under 0.5% is called flat rather than a trend, so the label does not flip on noise.',
  },
  {
    term: 'Range (ATR)',
    text:
      'The average distance between a bar’s high and low over the last 14 bars, as a percentage of the current price. It is a measure of how much this thing moves in a normal bar — useful for sizing a position or a stop, and it says nothing about direction.',
  },
  {
    term: 'Nearest low / high',
    text:
      'The closest price where the chart already turned: a bar whose high beat the two bars on each side (or whose low undercut them). Shown with how far away it is, because the distance is the part a position size is built from. “cleared all” means price is above every such high in the window — the opposite of missing data.',
  },
  {
    term: 'Range position',
    text:
      'Where the current price sits between the lowest low and highest high of the window, 0 to 100. It says where price is, not where it is going: 95 can be a breakout or the top of a range, and this number cannot tell you which.',
  },
  {
    term: 'Volume vs avg',
    text:
      'The latest bar’s volume divided by the average of the 20 bars before it. 1× is an ordinary bar. The latest bar is deliberately excluded from its own average — including it would drag the baseline toward the very thing being measured.',
  },
  {
    term: 'Window high / low',
    text:
      'The extremes of the whole window, how far the current price is from each, and how many bars ago they happened. “3 bars ago” and “188 bars ago” are very different facts about the same price.',
  },
  {
    term: 'Other timeframes',
    text:
      'The same trend read on 1h, 4h and 1d. One frame alone cannot say whether the frames agree, and when they disagree that is usually the more useful fact.',
  },
  {
    term: '“higher than X% of window”',
    text:
      'The percentile of the current reading against every bar in the same window. This is what turns a number into information: RSI 75 means one thing on an instrument that lives at 70, and another on one that has not been above 60 in months.',
  },
];

export const ONCHAIN_GLOSSARY: Array<{ term: string; text: string }> = [
  {
    term: 'Liquidity',
    text:
      'The dollar value sitting in the pool, both sides combined. It is what you are trading against: a small pool means your own order moves the price, whatever the market cap says.',
  },
  {
    term: 'FDV vs market cap',
    text:
      'FDV values every token that will ever exist; market cap values only those circulating. A large gap between them means a lot of supply has yet to arrive.',
  },
  {
    term: 'Liquidity / FDV',
    text:
      'Pool depth against valuation. A token claiming a large valuation on a thin pool is one whose price is cheap to move in either direction.',
  },
  {
    term: 'Vol / liquidity',
    text:
      'A day’s volume divided by pool depth. Very high means the pool is being churned rapidly; very low means almost nobody is trading it. Neither is good or bad on its own — both are context for how easily you could get out.',
  },
  {
    term: 'Largest holder',
    text:
      'The share of supply in the biggest single wallet the screen could see. Concentration is not proof of anything, but it does mean one address can move the price on its own.',
  },
  {
    term: 'LP locked',
    text:
      'Whether the liquidity pool tokens are locked. Unlocked means whoever holds them can withdraw the pool, and the price with it. “unknown” is a third state and does not mean no.',
  },
  {
    term: 'Mint / freeze revoked',
    text:
      'Whether the contract can still create new tokens, or block a wallet from transferring. Not revoked means the deployer retains that power. As above, “unknown” is not “no”.',
  },
];
