// The token radar's model: category-calibrated comparables.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// pre-token protocol below the floor that passes the same purity rule the watchlist uses: no token on
// record, no versioned name, no wrapped / staked / bridged product, no exchange storefront. Protocols
// whose token already trades are never ranked: they are the comparables the model prices from, and the
// dashboard sets them aside in their own view with the market's own values.
//
// Implied value follows only from the snapshot's own figures. For each category the model takes the
// median market-cap-to-TVL ratio of the protocols in that category whose token already trades; a
// category with fewer than three such comparables falls back to the whole snapshot's median. The
// multiple is clamped, so one outlier protocol cannot set a category's price:
//
//   multiple   = clamp(median(mcap_usd / tvl_usd over the category's trading protocols), 0.05, 3.0)
//   growth     = clamp(change_7d, -50, 100) per cent; growthMult = clamp(1 + growth / 100 x 0.35, 0.6, 1.35)
//   tenure     = 0.7 + 0.3 x sqrt(min(age_days, 1095) / 1095)      (age_days unknown: 365)
//   breadth    = 1 + 0.02 x min(chains - 1, 5)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x tenureMult x breadthMult))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// recomputes every row from the same figures so the page and the board agree.

import { farmSteps } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_min: number;
  multiple_max: number;
  min_comparables: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_min: number;
  growth_mult_max: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  multiple_min: 0.05,
  multiple_max: 3.0,
  min_comparables: 3,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  growth_mult_min: 0.6,
  growth_mult_max: 1.35,
  tenure_floor: 0.7,
  tenure_range: 0.3,
  tenure_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    tenure_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page re-derives the farm plan from the same fields. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  comparables: number;
  growth_multiplier: number;
  tenure_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** One category's comparable multiple, as the dashboard's model panel shows it. */
export interface CategoryStat {
  category: string;
  comparables: number;
  multiple: number;
  source: 'category' | 'global';
}

/** Everything the dashboard needs: the board, the live set, the comparables and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  global_comparables: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list; 0 when empty. Deterministic: a sorted copy, no input order kept. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A number held inside [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** The comparable multiples: one per category with enough trading protocols, plus the global fallback. */
export interface Comparables {
  byCategory: Map<string, { multiple: number; count: number }>;
  globalMultiple: number;
  globalCount: number;
}

/**
 * The trading protocols' market-cap-to-TVL ratios, grouped by category. A protocol counts as a
 * comparable when it records a positive market cap and a positive TVL: its token trades, so the
 * market has priced it. Categories are keyed by their exact snapshot name; a null category never
 * gets its own multiple and always falls back to the global one.
 */
export function comparableMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = ratios.get(p.category) ?? [];
      list.push(ratio);
      ratios.set(p.category, list);
    }
  }
  const globalMultiple = clamp(median(all), model.multiple_min, model.multiple_max);
  const byCategory = new Map<string, { multiple: number; count: number }>();
  for (const [category, list] of ratios) {
    if (list.length < model.min_comparables) continue;
    byCategory.set(category, { multiple: clamp(median(list), model.multiple_min, model.multiple_max), count: list.length });
  }
  return { byCategory, globalMultiple, globalCount: all.length };
}

/** The multiple one category scores with: its own median when it has enough comparables, else global. */
export function multipleFor(category: string | null, comparables: Comparables): { multiple: number; source: 'category' | 'global'; count: number } {
  if (category !== null) {
    const own = comparables.byCategory.get(category);
    if (own !== undefined) return { multiple: own.multiple, source: 'category', count: own.count };
  }
  return { multiple: comparables.globalMultiple, source: 'global', count: comparables.globalCount };
}

/** One protocol's score: the implied value and every multiplier that produced it. */
export interface Score {
  implied: number;
  multiple: number;
  multipleSource: 'category' | 'global';
  comparables: number;
  growthPct: number;
  growthMult: number;
  tenureMult: number;
  breadthMult: number;
  age: number | null;
}

export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  model: ModelConstants = MODEL,
): Score {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, source, count } = multipleFor(protocol.category, comparables);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = clamp(1 + (growthPct / 100) * model.growth_weight, model.growth_mult_min, model.growth_mult_max);
  const ageForModel = age ?? model.unknown_age_days;
  const tenureMult =
    model.tenure_floor + model.tenure_range * Math.sqrt(clamp(ageForModel, 0, model.tenure_days) / model.tenure_days);
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * tenureMult * breadthMult));
  return { implied, multiple, multipleSource: source, comparables: count, growthPct, growthMult, tenureMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule treats as wrapped, staked or bridged products, never launches. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names: a protocol whose name begins with one is an exchange's storefront, not a launch. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking anywhere in the name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's purity rule
 * without its size floor — no wrapped / staked / bridged category, no versioned name, no wrapped or
 * staked word, no exchange prefix. The rule is the snapshot's own: it names no protocol.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comparables = comparableMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever the purity rule would say about it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, not just the largest ones.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, comparables, model) }));
  scored.sort(
    (a, b) =>
      b.score.implied - a.score.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.score.age,
    implied_value_usd: s.score.implied,
    // Full precision, never rounded: the dashboard recomputes the implied value from these
    // figures, and a rounded multiple would move the recomputed number off the board's.
    model: {
      multiple: s.score.multiple,
      multiple_source: s.score.multipleSource,
      comparables: s.score.comparables,
      growth_pct: s.score.growthPct,
      growth_multiplier: s.score.growthMult,
      tenure_multiplier: s.score.tenureMult,
      breadth_multiplier: s.score.breadthMult,
      age_days: s.score.age,
    },
    farm_steps: farmSteps(s.p, s.score.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** One comparable multiple per category the board uses, for the dashboard's model panel. */
export function categoryStats(board: BoardRow[], comparables: Comparables): CategoryStat[] {
  const seen = new Map<string, CategoryStat>();
  for (const row of board) {
    const category = row.category ?? 'Uncategorized';
    if (seen.has(category)) continue;
    const { multiple, source, count } = multipleFor(row.category, comparables);
    seen.set(category, { category, comparables: count, multiple: round4(multiple), source });
  }
  return [...seen.values()].sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/** A board row's compact form for data.js, with the farm plan re-derived in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    tenure_multiplier: row.model.tenure_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    on_watchlist: onWatchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comparables = comparableMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(comparables.globalMultiple),
    global_comparables: comparables.globalCount,
    categories: categoryStats(board, comparables),
    rows: board.map((row) => radarRow(row, snapshot.watchlist.includes(row.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
