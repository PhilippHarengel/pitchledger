import { LAUNCH_DATE, PATHS, PIPELINE_TZ } from './config.js';
import type { EloRatings, MatchResult90 } from './elo.js';
import { applyResults } from './elo.js';
import { devig, devigMultiway } from './devig.js';
import { isLowEdge, makePick } from './model.js';
import { isScoreLowEdge, makeScorePick } from './goals.js';
import type { Grade, LedgerEntry } from './ledger.js';
import { gradeEntry } from './grade.js';
import type { FinalResult } from './grade.js';
import type { WcMatch } from './clients/footballData.js';
import type { MatchOdds, ScoreOdds } from './clients/oddsApi.js';

/**
 * Pure pipeline steps (no IO) — run.ts wires them to fs/network/git.
 *
 *   DAILY JOB (sequential by construction, D9):
 *   results ──▶ gradeFinished ──▶ ledger'
 *                    │
 *                    ▼
 *               eloAfterGrading ──▶ elo.json'
 *                    │
 *                    ▼
 *   fixtures ──▶ buildTodayEntries ──▶ picks + ledger PENDING rows
 */

export function pipelineDay(now: Date): string {
  // ET day boundary (en-CA gives YYYY-MM-DD).
  return new Intl.DateTimeFormat('en-CA', { timeZone: PIPELINE_TZ }).format(now);
}

export function gradeFinished(
  ledger: readonly LedgerEntry[],
  results: ReadonlyMap<string, FinalResult>,
): readonly LedgerEntry[] {
  return ledger.map((entry) => {
    if (entry.grade !== 'PENDING' && entry.grade !== 'NO-PICK') return entry;
    const result = results.get(entry.matchId);
    if (!result || (result.status !== 'FINISHED' && result.status !== 'POSTPONED' && result.status !== 'ABANDONED')) {
      return entry;
    }
    return gradeEntry(entry, result);
  });
}

/**
 * Idempotent Elo folding. Every FINISHED match with a 90-minute result is
 * folded into the ratings exactly once, tracked by matchId in the fold log —
 * independent of ledger state, so backfill, grading, and NO-PICK paths can
 * never double-count a result.
 */
export interface FoldOutcome {
  readonly elo: EloRatings;
  readonly foldLog: readonly string[];
}

export function foldResults(
  elo: EloRatings,
  foldLog: readonly string[],
  matches: readonly WcMatch[],
  asOf: string,
): FoldOutcome {
  const folded = new Set(foldLog);
  const fresh = matches.filter(
    (m) => m.status === 'FINISHED' && m.homeGoals90 !== null && m.awayGoals90 !== null && !folded.has(m.id),
  );
  if (fresh.length === 0) return { elo, foldLog };
  const results: MatchResult90[] = fresh.map((m) => ({
    home: m.home,
    away: m.away,
    homeGoals: m.homeGoals90 as number,
    awayGoals: m.awayGoals90 as number,
  }));
  return {
    elo: applyResults(elo, results, asOf),
    foldLog: [...foldLog, ...fresh.map((m) => m.id)],
  };
}

/**
 * NO-PICK rows for matches the pipeline missed: kicked off after launch,
 * started or finished, and absent from the ledger — gaps are logged, never
 * silent. Rows are created fully graded so no later step re-processes them.
 */
export function buildMissedEntries(
  fixtures: readonly WcMatch[],
  existingIds: ReadonlySet<string>,
  launchAt: Date,
): readonly LedgerEntry[] {
  return fixtures
    .filter(
      (m) =>
        !existingIds.has(m.id) &&
        new Date(m.utcDate) >= launchAt &&
        (m.status === 'FINISHED' || m.status === 'IN_PLAY' || m.status === 'PAUSED'),
    )
    .map((m) => ({
      ...noPickEntry(m, pipelineDay(new Date(m.utcDate)), 'missed pick window'),
      result:
        m.status === 'FINISHED' && m.homeGoals90 !== null && m.awayGoals90 !== null
          ? `${m.homeGoals90}–${m.awayGoals90}`
          : null,
    }));
}

export interface OddsLookup {
  find(home: string, away: string): MatchOdds | undefined;
}

export interface ScoreOddsLookup {
  find(home: string, away: string): ScoreOdds | undefined;
}

/**
 * Team-name aliases between The Odds API and football-data.org. Both sides
 * normalize through this table; misses degrade to "no odds" — never wrong odds.
 */
const TEAM_ALIASES: Readonly<Record<string, string>> = {
  'usa': 'united states',
  'bosnia and herzegovina': 'bosnia-herzegovina',
  'czech republic': 'czechia',
  'korea republic': 'south korea',
  'dr congo': 'congo dr',
  'democratic republic of the congo': 'congo dr',
  'cape verde': 'cape verde islands',
  'türkiye': 'turkey',
  'curacao': 'curaçao',
};

function normalizeTeam(name: string): string {
  const lower = name.toLowerCase().trim();
  return TEAM_ALIASES[lower] ?? lower;
}

export function buildOddsLookup(odds: readonly MatchOdds[]): OddsLookup {
  const key = (h: string, a: string) => `${normalizeTeam(h)}|${normalizeTeam(a)}`;
  const map = new Map(odds.map((o) => [key(o.home, o.away), o]));
  return { find: (h, a) => map.get(key(h, a)) };
}

export function buildScoreOddsLookup(odds: readonly ScoreOdds[]): ScoreOddsLookup {
  const key = (h: string, a: string) => `${normalizeTeam(h)}|${normalizeTeam(a)}`;
  const map = new Map(odds.map((o) => [key(o.home, o.away), o]));
  return { find: (h, a) => map.get(key(h, a)) };
}

export function buildTodayEntries(
  fixtures: readonly WcMatch[],
  elo: EloRatings,
  odds: OddsLookup,
  day: string,
  ratingsStale: boolean,
  now: Date,
  scoreOdds: ScoreOddsLookup = buildScoreOddsLookup([]),
): readonly LedgerEntry[] {
  return fixtures
    .filter((m) => m.utcDate.length > 0 && pipelineDay(new Date(m.utcDate)) === day && day >= LAUNCH_DATE)
    // Picks are published BEFORE kickoff or not at all — a started/finished
    // match must never receive a pick (pick-after-result is the one thing
    // a pick ledger can never do).
    .filter((m) => (m.status === 'TIMED' || m.status === 'SCHEDULED') && new Date(m.utcDate) > now)
    .map((m) => {
      const eloHome = elo.ratings[m.home];
      const eloAway = elo.ratings[m.away];
      if (eloHome === undefined || eloAway === undefined) {
        // Unknown team (name mismatch vs seed) → explicit NO-PICK, not a crash.
        return noPickEntry(m, day, `unknown team rating: ${m.home} / ${m.away}`);
      }
      const pick = makePick(eloHome, eloAway);
      const matchOdds = odds.find(m.home, m.away);
      const market = matchOdds ? devig(matchOdds.homeOdds, matchOdds.drawOdds, matchOdds.awayOdds) : null;
      const marketAtPick =
        market === null ? null
        : pick.outcome === 'HOME' ? market.home
        : pick.outcome === 'AWAY' ? market.away
        : market.draw;
      // Correct-score market, parallel to 1X2. The edge layer no-ops on null
      // odds (model-only path) — score market missing ⇒ chip "—", label null.
      const scorePick = makeScorePick(eloHome, eloAway);
      const matchScoreOdds = scoreOdds.find(m.home, m.away);
      const scoreMarket = matchScoreOdds ? devigMultiway(matchScoreOdds.scores) : null;
      const scoreMarketAtPick = scoreMarket ? scoreMarket.get(scorePick.score) ?? null : null;
      const scoreLowEdge = scoreMarketAtPick === null ? null : isScoreLowEdge(scorePick, scoreMarketAtPick);
      return {
        matchId: m.id,
        date: day,
        kickoffUtc: m.utcDate,
        home: m.home,
        away: m.away,
        pick: pick.outcome,
        confidence: pick.confidence,
        probabilities: pick.probabilities,
        eloDiff: pick.eloDiff,
        marketAtPick,
        lowEdge: isLowEdge(pick, marketAtPick),
        grade: 'PENDING' as Grade,
        scorePick: scorePick.score,
        scoreConfidence: scorePick.probability,
        scoreMarketAtPick,
        scoreLowEdge,
        scoreGrade: 'PENDING' as Grade,
        result: null,
        pickCommit: null,
        ratingsAsOf: ratingsStale ? elo.asOf : null,
      };
    });
}

function noPickEntry(m: WcMatch, day: string, _reason: string): LedgerEntry {
  return {
    matchId: m.id,
    date: day,
    kickoffUtc: m.utcDate,
    home: m.home,
    away: m.away,
    pick: null,
    confidence: null,
    probabilities: null,
    eloDiff: null,
    marketAtPick: null,
    lowEdge: null,
    grade: 'NO-PICK',
    scorePick: null,
    scoreConfidence: null,
    scoreMarketAtPick: null,
    scoreLowEdge: null,
    scoreGrade: 'NO-PICK',
    result: null,
    pickCommit: null,
    ratingsAsOf: null,
  };
}

/** Merge today's new entries into the ledger without touching existing rows. */
export function mergeEntries(
  ledger: readonly LedgerEntry[],
  fresh: readonly LedgerEntry[],
): readonly LedgerEntry[] {
  const existing = new Set(ledger.map((e) => e.matchId));
  return [...ledger, ...fresh.filter((e) => !existing.has(e.matchId))];
}

export { PATHS };
