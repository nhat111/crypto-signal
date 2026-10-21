import type { Pool } from 'pg';
import type { AirdropCandidate } from '@crypto-signal/indicators';

/** One screened protocol for one UTC day, as stored and served by /api/airdrops. */
export interface AirdropCandidateRow extends AirdropCandidate {
  day: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Kept long enough for the 30-day change with room to spare, and no longer. */
export const AIRDROP_CANDIDATE_RETENTION_DAYS = 120;

/**
 * Replaces one day's list. A rerun the same day must also drop protocols
 * that launched a token since the morning, which an upsert alone would
 * leave behind.
 */
export async function replaceAirdropCandidates(pool: Pool, day: string, candidates: AirdropCandidate[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM airdrop_candidates WHERE day = $1::date', [day]);
    for (const c of candidates) {
      await client.query(
        `INSERT INTO airdrop_candidates
           (day, slug, name, category, chains, tvl_usd, change_1d_pct, change_7d_pct, change_30d_pct,
            url, twitter, logo, listed_at, audits, parent_slug, reasons, unknowns)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 CASE WHEN $13::double precision IS NULL THEN NULL ELSE to_timestamp($13::double precision / 1000) END,
                 $14, $15, $16::jsonb, $17::jsonb)`,
        [
          day,
          c.slug,
          c.name,
          c.category,
          c.chains,
          c.tvlUsd,
          c.change1dPct,
          c.change7dPct,
          c.change30dPct,
          c.url,
          c.twitter,
          c.logo,
          c.listedAtMs,
          c.audits,
          c.parentSlug,
          JSON.stringify(c.reasons),
          JSON.stringify(c.unknowns),
        ],
      );
    }
    await client.query(
      `DELETE FROM airdrop_candidates WHERE day < $1::date - $2::int`,
      [day, AIRDROP_CANDIDATE_RETENTION_DAYS],
    );
    await client.query('COMMIT');
    return candidates.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * TVL about 30 days before `day`, per slug: the newest stored row between
 * 30 and 37 days back. A protocol with no row in that window gets no
 * entry, so its 30-day change stays null rather than measured over some
 * other span.
 */
export async function getAirdropTvl30dAgo(pool: Pool, day: string): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (slug) slug, tvl_usd
     FROM airdrop_candidates
     WHERE day <= $1::date - 30 AND day >= $1::date - 37
     ORDER BY slug, day DESC`,
    [day],
  );
  return new Map(rows.map((r) => [r.slug as string, Number(r.tvl_usd)]));
}

/** The most recent stored day, largest TVL first. */
export async function getLatestAirdropCandidates(pool: Pool, limit = 200): Promise<{ day: string | null; candidates: AirdropCandidateRow[] }> {
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day_text, slug, name, category, chains, tvl_usd,
            change_1d_pct, change_7d_pct, change_30d_pct, url, twitter, logo,
            extract(epoch from listed_at) * 1000 AS listed_ms, audits, parent_slug, reasons, unknowns
     FROM airdrop_candidates
     WHERE day = (SELECT max(day) FROM airdrop_candidates)
     ORDER BY tvl_usd DESC
     LIMIT $1`,
    [limit],
  );
  return {
    day: rows.length > 0 ? (rows[0].day_text as string) : null,
    candidates: rows.map((r) => ({
      day: r.day_text as string,
      slug: r.slug as string,
      name: r.name as string,
      category: (r.category as string | null) ?? null,
      chains: (r.chains as string[] | null) ?? [],
      tvlUsd: Number(r.tvl_usd),
      change1dPct: num(r.change_1d_pct),
      change7dPct: num(r.change_7d_pct),
      change30dPct: num(r.change_30d_pct),
      url: (r.url as string | null) ?? null,
      twitter: (r.twitter as string | null) ?? null,
      logo: (r.logo as string | null) ?? null,
      listedAtMs: r.listed_ms === null ? null : Math.round(Number(r.listed_ms)),
      audits: num(r.audits),
      parentSlug: (r.parent_slug as string | null) ?? null,
      reasons: (r.reasons as string[]) ?? [],
      unknowns: (r.unknowns as string[]) ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Farm tracker: what a person did on a project and what it cost them.

export type FarmStatus = 'active' | 'claimed' | 'dropped';
export const FARM_STATUSES: readonly FarmStatus[] = ['active', 'claimed', 'dropped'];
export const FARM_NAME_MAX = 80;
export const FARM_TEXT_MAX = 500;

export function isFarmStatus(value: unknown): value is FarmStatus {
  return typeof value === 'string' && (FARM_STATUSES as readonly string[]).includes(value);
}

/** "  Polymarket   International " and "polymarket international" are one project. */
export function farmProjectKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface FarmActionPoint {
  atMs: number;
  costUsd: number;
}

export interface FarmActivity {
  actionCount: number;
  totalCostUsd: number;
  /** Distinct Monday-based UTC weeks with at least one action. */
  activeWeeks: number;
  /** Distinct UTC calendar months with at least one action. */
  activeMonths: number;
  firstActionAt: number | null;
  lastActionAt: number | null;
  /** Whole days since the last action; null with no actions. */
  daysSinceLast: number | null;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Activity spread over time rather than in one burst is what most
 * airdrop criteria have rewarded (active weeks/months), and what sybil
 * filters look for the absence of, so it is counted the same way.
 */
export function summarizeFarmActivity(actions: readonly FarmActionPoint[], nowMs: number): FarmActivity {
  if (actions.length === 0) {
    return { actionCount: 0, totalCostUsd: 0, activeWeeks: 0, activeMonths: 0, firstActionAt: null, lastActionAt: null, daysSinceLast: null };
  }
  const weeks = new Set<number>();
  const months = new Set<string>();
  let total = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const a of actions) {
    total += a.costUsd;
    first = Math.min(first, a.atMs);
    last = Math.max(last, a.atMs);
    // The epoch was a Thursday; shifting by three days puts week edges on Monday.
    weeks.add(Math.floor((a.atMs + 3 * DAY_MS) / WEEK_MS));
    months.add(new Date(a.atMs).toISOString().slice(0, 7));
  }
  return {
    actionCount: actions.length,
    totalCostUsd: total,
    activeWeeks: weeks.size,
    activeMonths: months.size,
    firstActionAt: first,
    lastActionAt: last,
    daysSinceLast: Math.max(0, Math.floor((nowMs - last) / DAY_MS)),
  };
}

export interface FarmAction {
  id: string;
  at: number;
  costUsd: number;
  note: string | null;
}

export interface FarmRow {
  id: string;
  chatId: string;
  projectKey: string;
  name: string;
  slug: string | null;
  status: FarmStatus;
  wallet: string | null;
  note: string | null;
  rewardUsd: number | null;
  createdAt: number;
  closedAt: number | null;
  activity: FarmActivity;
  /** Reward minus everything spent; null until a reward is recorded. */
  netUsd: number | null;
  /** Newest first, at most the last 20. */
  recentActions: FarmAction[];
}

const FARM_COLUMNS = `id, chat_id, project_key, name, slug, status, wallet, note, reward_usd,
  extract(epoch from created_at) * 1000 AS created_ms, extract(epoch from closed_at) * 1000 AS closed_ms`;

async function withActions(pool: Pool, farms: Record<string, unknown>[], nowMs: number): Promise<FarmRow[]> {
  if (farms.length === 0) return [];
  const ids = farms.map((f) => String(f['id']));
  const { rows } = await pool.query(
    `SELECT id, farm_id, extract(epoch from at) * 1000 AS at_ms, cost_usd, note
     FROM airdrop_farm_actions WHERE farm_id = ANY($1::bigint[]) ORDER BY at DESC, id DESC`,
    [ids],
  );
  const byFarm = new Map<string, FarmAction[]>();
  for (const r of rows) {
    const list = byFarm.get(String(r.farm_id)) ?? [];
    list.push({ id: String(r.id), at: Math.round(Number(r.at_ms)), costUsd: Number(r.cost_usd), note: (r.note as string | null) ?? null });
    byFarm.set(String(r.farm_id), list);
  }
  return farms.map((f) => {
    const actions = byFarm.get(String(f['id'])) ?? [];
    const activity = summarizeFarmActivity(actions.map((a) => ({ atMs: a.at, costUsd: a.costUsd })), nowMs);
    const rewardUsd = num(f['reward_usd']);
    return {
      id: String(f['id']),
      chatId: f['chat_id'] as string,
      projectKey: f['project_key'] as string,
      name: f['name'] as string,
      slug: (f['slug'] as string | null) ?? null,
      status: f['status'] as FarmStatus,
      wallet: (f['wallet'] as string | null) ?? null,
      note: (f['note'] as string | null) ?? null,
      rewardUsd,
      createdAt: Math.round(Number(f['created_ms'])),
      closedAt: f['closed_ms'] === null ? null : Math.round(Number(f['closed_ms'])),
      activity,
      netUsd: rewardUsd === null ? null : rewardUsd - activity.totalCostUsd,
      recentActions: actions.slice(0, 20),
    };
  });
}

/** Active farms first, then the most recently created. */
export async function getFarms(pool: Pool, chatId?: string, nowMs = Date.now()): Promise<FarmRow[]> {
  const { rows } = await pool.query(
    `SELECT ${FARM_COLUMNS} FROM airdrop_farms
     WHERE ($1::text IS NULL OR chat_id = $1)
     ORDER BY (status = 'active') DESC, created_at DESC
     LIMIT 200`,
    [chatId ?? null],
  );
  return withActions(pool, rows, nowMs);
}

export async function getFarmById(pool: Pool, id: string, nowMs = Date.now()): Promise<FarmRow | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const { rows } = await pool.query(`SELECT ${FARM_COLUMNS} FROM airdrop_farms WHERE id = $1`, [id]);
  return (await withActions(pool, rows, nowMs))[0];
}

export interface StartFarmInput {
  chatId: string;
  name: string;
  slug?: string | null;
  wallet?: string | null;
  note?: string | null;
}

/** Starts a farm, or returns the one already active for this project and chat. */
export async function startFarm(pool: Pool, input: StartFarmInput): Promise<FarmRow> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const key = farmProjectKey(name);
  await pool.query(
    `INSERT INTO airdrop_farms (chat_id, project_key, name, slug, wallet, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (chat_id, project_key) WHERE status = 'active' DO NOTHING`,
    [input.chatId, key, name, input.slug ?? null, input.wallet ?? null, input.note ?? null],
  );
  const { rows } = await pool.query(
    `SELECT id FROM airdrop_farms WHERE chat_id = $1 AND project_key = $2 AND status = 'active'`,
    [input.chatId, key],
  );
  const farm = await getFarmById(pool, String(rows[0].id));
  if (!farm) throw new Error('farm vanished right after insert');
  return farm;
}

export async function addFarmAction(pool: Pool, farmId: string, costUsd: number, note: string | null): Promise<FarmRow | undefined> {
  if (!/^\d+$/.test(farmId)) return undefined;
  const { rowCount } = await pool.query(
    `INSERT INTO airdrop_farm_actions (farm_id, cost_usd, note)
     SELECT id, $2, $3 FROM airdrop_farms WHERE id = $1`,
    [farmId, costUsd, note],
  );
  if (!rowCount) return undefined;
  return getFarmById(pool, farmId);
}

/** The bot's path: one message names the project, and the farm is started on first use. */
export async function logFarmAction(
  pool: Pool,
  input: { chatId: string; name: string; costUsd: number; note: string | null },
): Promise<FarmRow> {
  const farm = await startFarm(pool, { chatId: input.chatId, name: input.name });
  const updated = await addFarmAction(pool, farm.id, input.costUsd, input.note);
  if (!updated) throw new Error('farm vanished while logging an action');
  return updated;
}

export interface UpdateFarmInput {
  status?: FarmStatus;
  rewardUsd?: number | null;
  wallet?: string | null;
  note?: string | null;
}

export type UpdateFarmResult = { kind: 'ok'; farm: FarmRow } | { kind: 'not_found' } | { kind: 'conflict' };

export async function updateFarm(pool: Pool, id: string, patch: UpdateFarmInput): Promise<UpdateFarmResult> {
  if (!/^\d+$/.test(id)) return { kind: 'not_found' };
  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (sql: string, value: unknown) => {
    values.push(value);
    sets.push(sql.replace('?', `$${values.length}`));
  };
  if (patch.status !== undefined) {
    set('status = ?', patch.status);
    sets.push(patch.status === 'active' ? 'closed_at = NULL' : 'closed_at = COALESCE(closed_at, now())');
  }
  if (patch.rewardUsd !== undefined) set('reward_usd = ?', patch.rewardUsd);
  if (patch.wallet !== undefined) set('wallet = ?', patch.wallet);
  if (patch.note !== undefined) set('note = ?', patch.note);
  if (sets.length > 0) {
    try {
      const { rowCount } = await pool.query(`UPDATE airdrop_farms SET ${sets.join(', ')} WHERE id = $1`, values);
      if (!rowCount) return { kind: 'not_found' };
    } catch (err) {
      // Reopening a finished farm while another farm on the same project is active.
      if ((err as { code?: string }).code === '23505') return { kind: 'conflict' };
      throw err;
    }
  }
  const farm = await getFarmById(pool, id);
  return farm ? { kind: 'ok', farm } : { kind: 'not_found' };
}

export async function deleteFarm(pool: Pool, id: string): Promise<boolean> {
  if (!/^\d+$/.test(id)) return false;
  const { rowCount } = await pool.query('DELETE FROM airdrop_farms WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
