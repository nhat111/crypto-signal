/**
 * Tells a tokenized real-world security apart from a token.
 *
 * Robinhood Chain mints wrappers for hundreds of listed equities and ETFs,
 * and they pass every market gate this scanner has: a gold ETF sits inside
 * the liquidity band, trades real volume, and its pool is genuinely two
 * weeks old. What the gate cannot see is that none of the scoring means
 * anything for it. `survivalScore` reads the age of the wrapper, not of
 * SPDR Gold Trust, which has existed since 2004. `momentumStructure` and
 * `buyPressure` read flow that is mostly arbitrage holding a peg. FDV is
 * the minted supply on one chain, not the market cap of the asset, so the
 * small-cap ceiling never binds. The score comes out looking like a
 * finding and carries no information.
 *
 * They also poison the control group, which is worse: the baseline is the
 * number that decides whether the scanner is worth using, and filling both
 * sides of it with assets the model cannot have edge on drags the
 * comparison toward "no difference" for a reason that has nothing to do
 * with the scanner.
 *
 * The cost of a wrong catch is a real memecoin thrown away silently, so
 * this errs toward missing some. Signals are tiered by how impossible they
 * are in a memecoin name, weak-but-plausible ones (a name merely ending in
 * "Trust" or "Fund") are deliberately NOT enough on their own, and every
 * catch records which rule fired so a bad rule is visible on /status
 * rather than inferred from an absence.
 */

export interface SecurityDetection {
  /** The rule that fired, in the words used on /status and in the scan log. */
  signal: string;
}

/**
 * Phrases that simply do not occur in a memecoin name. Each one is a legal
 * or regulatory description of a share class or a wrapper, not branding.
 */
const STRONG_PHRASES: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\bcommon (?:stock|shares)\b/, signal: 'common stock' },
  { pattern: /\bordinary shares\b/, signal: 'ordinary shares' },
  { pattern: /\b(?:american )?depositary (?:receipts?|shares?)\b/, signal: 'depositary receipt' },
  { pattern: /\btokeni[sz]ed (?:stock|share|equity|security)\b/, signal: 'tokenized stock' },
  { pattern: /\bxstock\b/, signal: 'xStock wrapper' },
  { pattern: /\betf\b/, signal: 'ETF' },
  // Inferred from the wrapper naming Robinhood Chain uses on its own
  // minted assets. A token literally named "… Robinhood Token" is a
  // wrapper by construction; nothing branded that way is trying to be a
  // memecoin.
  { pattern: /\brobinhood token\b/, signal: 'Robinhood wrapper' },
];

/**
 * Fund issuers whose name appearing at all settles it. Kept to houses
 * whose name is not also an ordinary English word or a plausible ticker
 * meme — "Vanguard", "Blackrock" and "Fidelity" are all perfectly good
 * memecoin names and are deliberately absent.
 */
const ISSUERS: string[] = ['spdr', 'ishares', 'proshares', 'wisdomtree', 'invesco', 'grayscale'];

/**
 * Corporate suffixes, matched only as the LAST word of the name. Position
 * is what makes them safe: "Corp" ending a name is a legal entity, while
 * a token called "Corp Inu" is just a token.
 */
const ENTITY_SUFFIXES: string[] = [
  'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited',
  'plc', 'holdings', 'nv', 'sa',
];

/**
 * Trailing words that describe the wrapper or the share class rather than
 * the issuer, stripped before the suffix test so it sees the real end of
 * the name. "SPDR Gold Trust Robinhood Token" has to become "spdr gold
 * trust" before anything can look at its last word.
 */
const TRAILING_NOISE = /\s+(?:robinhood token|common stock|common shares|ordinary shares|class [a-c]|xstock|adr|token|tokens|stock|shares|share)$/;

/** Lowercase, punctuation to spaces, single-spaced. "Corp." becomes "corp". */
export function normalizeTokenName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Strips wrapper and share-class words off the end, repeatedly. */
export function stripTrailingNoise(normalized: string): string {
  let s = normalized;
  // Repeated because they stack: "… Class A Common Stock" is three of them.
  while (TRAILING_NOISE.test(s)) s = s.replace(TRAILING_NOISE, '').trim();
  return s;
}

export function detectTokenizedSecurity(name: string): SecurityDetection | null {
  const normalized = normalizeTokenName(name);
  if (normalized === '') return null;

  for (const { pattern, signal } of STRONG_PHRASES) {
    if (pattern.test(normalized)) return { signal };
  }

  const words = normalized.split(' ');
  for (const issuer of ISSUERS) {
    if (words.includes(issuer)) return { signal: `fund issuer "${issuer}"` };
  }

  const stripped = stripTrailingNoise(normalized);
  const strippedWords = stripped.split(' ');
  const last = strippedWords[strippedWords.length - 1];
  // A one-word name that IS the suffix ("Limited", "Holdings") is branding,
  // not an entity — there is no issuer in front of it.
  if (last !== undefined && strippedWords.length >= 2 && ENTITY_SUFFIXES.includes(last)) {
    return { signal: `corporate suffix "${last}"` };
  }

  return null;
}
