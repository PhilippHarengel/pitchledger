import { MODEL } from './config.js';

/**
 * Elo update, World Football Elo style, K = 60 (World Cup), no goal-diff
 * multiplier in v1 and no home advantage (WC2026 host teams excepted is a
 * v1.1 question). Updates consume the 90-minute result — the same result
 * the grading uses (review decision: one result convention everywhere).
 */
export interface EloRatings {
  /** ISO date of the last result folded in (staleness display, D3). */
  readonly asOf: string;
  readonly ratings: Readonly<Record<string, number>>;
}

export interface MatchResult90 {
  readonly home: string;
  readonly away: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
}

export function expectedScore(eloDiff: number): number {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

function actualScore(homeGoals: number, awayGoals: number): number {
  if (homeGoals > awayGoals) return 1;
  if (homeGoals < awayGoals) return 0;
  return 0.5;
}

/** Returns a new ratings object — never mutates the input. */
export function applyResult(elo: EloRatings, result: MatchResult90, asOf: string): EloRatings {
  const home = elo.ratings[result.home];
  const away = elo.ratings[result.away];
  if (home === undefined || away === undefined) {
    throw new Error(`Unknown team in result: ${result.home} vs ${result.away}`);
  }
  const we = expectedScore(home - away);
  const w = actualScore(result.homeGoals, result.awayGoals);
  const delta = MODEL.ELO_K * (w - we);
  return {
    asOf,
    ratings: {
      ...elo.ratings,
      [result.home]: home + delta,
      [result.away]: away - delta,
    },
  };
}

export function applyResults(elo: EloRatings, results: readonly MatchResult90[], asOf: string): EloRatings {
  return results.reduce((acc, r) => applyResult(acc, r, asOf), elo);
}
