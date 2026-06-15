import { z } from 'zod';
import { OTHER_SCORE, scoreString } from '../goals.js';

/**
 * The Odds API client — WC2026 h2h (1X2) market, free tier (500 req/mo).
 * Missing odds for a match are a degraded state, not an error: the market
 * column shows "—" and the low-edge label is suppressed (doc rule).
 */
const BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'soccer_fifa_world_cup';

const outcomeSchema = z.object({ name: z.string(), price: z.number() });
const eventSchema = z.object({
  home_team: z.string(),
  away_team: z.string(),
  commence_time: z.string(),
  bookmakers: z.array(
    z.object({
      markets: z.array(
        z.object({ key: z.string(), outcomes: z.array(outcomeSchema) }),
      ),
    }),
  ),
});

export interface MatchOdds {
  readonly home: string;
  readonly away: string;
  readonly homeOdds: number;
  readonly drawOdds: number;
  readonly awayOdds: number;
}

export interface OddsFetchResult {
  readonly odds: readonly MatchOdds[];
  readonly skipped: readonly { raw: unknown; reason: string }[];
}

function toMatchOdds(raw: unknown): MatchOdds | { error: string } {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  const e = parsed.data;
  const market = e.bookmakers[0]?.markets.find((m) => m.key === 'h2h');
  if (!market) return { error: `no h2h market for ${e.home_team} vs ${e.away_team}` };
  const price = (name: string) => market.outcomes.find((o) => o.name === name)?.price;
  const homeOdds = price(e.home_team);
  const awayOdds = price(e.away_team);
  const drawOdds = price('Draw');
  if (homeOdds === undefined || awayOdds === undefined || drawOdds === undefined) {
    return { error: `incomplete h2h outcomes for ${e.home_team} vs ${e.away_team}` };
  }
  return { home: e.home_team, away: e.away_team, homeOdds, drawOdds, awayOdds };
}

export function parseOddsResponse(body: unknown): OddsFetchResult {
  const envelope = z.array(z.unknown()).safeParse(body);
  if (!envelope.success) {
    throw new Error(`odds API response shape unexpected: ${envelope.error.message}`);
  }
  const odds: MatchOdds[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];
  for (const raw of envelope.data) {
    const result = toMatchOdds(raw);
    if ('error' in result) skipped.push({ raw, reason: result.error });
    else odds.push(result);
  }
  return { odds, skipped };
}

export async function fetchWcOdds(apiKey: string): Promise<OddsFetchResult> {
  const url = `${BASE}/sports/${SPORT_KEY}/odds?regions=eu&markets=h2h&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`The Odds API ${res.status}: ${await res.text()}`);
  }
  return parseOddsResponse(await res.json());
}

/**
 * Correct-score market. The exact outcome-name format is confirmed by the
 * Phase-0 probe (scripts/probe-score-odds.ts); the parser normalizes the
 * common shapes ("2 - 1", "2-1", "2:1") to our "home-away" keys and folds
 * any out-of-grid or non-numeric outcome (e.g. "Any Other Score") into the
 * single OTHER_SCORE bucket. Like fetchWcOdds, a missing market degrades that
 * match to "no odds" — never an error.
 */
export interface ScoreOdds {
  readonly home: string;
  readonly away: string;
  /** Normalized score key → decimal odds (collisions folded by implied prob). */
  readonly scores: ReadonlyMap<string, number>;
}

export interface ScoreOddsFetchResult {
  readonly odds: readonly ScoreOdds[];
  readonly skipped: readonly { raw: unknown; reason: string }[];
}

const SCORE_NAME = /^(\d+)\s*[-–:]\s*(\d+)$/;

/** Map a book outcome name to our canonical score key, or OTHER_SCORE. */
function normalizeScoreName(name: string): string {
  const match = SCORE_NAME.exec(name.trim());
  if (!match) return OTHER_SCORE;
  return scoreString(Number(match[1]), Number(match[2]));
}

function toScoreOdds(raw: unknown): ScoreOdds | { error: string } {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  const e = parsed.data;
  const market = e.bookmakers[0]?.markets.find((m) => m.key === 'correct_score');
  if (!market) return { error: `no correct_score market for ${e.home_team} vs ${e.away_team}` };
  // Accumulate implied probability per normalized key so collapsed buckets
  // (multiple book outcomes → OTHER_SCORE) combine correctly, then store back
  // as decimal odds for the generic de-vig downstream.
  const impliedByKey = new Map<string, number>();
  for (const o of market.outcomes) {
    if (o.price <= 1) continue; // ignore unusable quotes (de-vig would reject them)
    const key = normalizeScoreName(o.name);
    impliedByKey.set(key, (impliedByKey.get(key) ?? 0) + 1 / o.price);
  }
  if (impliedByKey.size === 0) {
    return { error: `no usable correct_score outcomes for ${e.home_team} vs ${e.away_team}` };
  }
  const scores = new Map<string, number>();
  for (const [key, implied] of impliedByKey) scores.set(key, 1 / implied);
  return { home: e.home_team, away: e.away_team, scores };
}

export function parseScoreOddsResponse(body: unknown): ScoreOddsFetchResult {
  const envelope = z.array(z.unknown()).safeParse(body);
  if (!envelope.success) {
    throw new Error(`score odds API response shape unexpected: ${envelope.error.message}`);
  }
  const odds: ScoreOdds[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];
  for (const raw of envelope.data) {
    const result = toScoreOdds(raw);
    if ('error' in result) skipped.push({ raw, reason: result.error });
    else odds.push(result);
  }
  return { odds, skipped };
}

export async function fetchWcScoreOdds(apiKey: string): Promise<ScoreOddsFetchResult> {
  const url = `${BASE}/sports/${SPORT_KEY}/odds?regions=eu&markets=correct_score&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`The Odds API ${res.status}: ${await res.text()}`);
  }
  return parseScoreOddsResponse(await res.json());
}
