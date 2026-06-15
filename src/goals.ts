import { SCORE, SCORE_HONESTY } from './config.js';

/**
 * Dixon-Coles scoreline model, seeded from Elo.
 *
 * Elo difference → goal supremacy → two attacking rates λ_home, λ_away:
 *
 *   supremacy = SUPREMACY_PER_ELO · (eloHome − eloAway) + HOME_GOAL_ADV
 *   λ_home    = (GOALS_BASELINE + supremacy) / 2
 *   λ_away    = (GOALS_BASELINE − supremacy) / 2
 *
 * The score grid is independent Poisson, P(x;λ_home)·P(y;λ_away), with the
 * Dixon-Coles low-score correction τ(x,y; λ,μ,ρ) applied to the 0-0, 1-0,
 * 0-1 and 1-1 cells. ρ < 0 lifts draw/low-score mass that independent Poisson
 * under-prices; the correction nets to zero over the full grid, so it shifts
 * mass without changing the total (D-C preserves normalization).
 *
 * Cells 0..GRID_MAX per side are explicit (49 for GRID_MAX = 6); a single
 * "7+/other" cell absorbs the truncation tail so the grid sums to exactly 1.
 *
 * All five parameters live in config.SCORE and are calibrated by the backtest.
 */
export interface ScoreCell {
  readonly home: number;
  readonly away: number;
  readonly prob: number;
}

export interface ScoreModelPick {
  readonly score: string; // "2-1", or "7+/other"
  readonly probability: number; // model prob of that exact score
  readonly grid: readonly ScoreCell[];
}

export interface Lambdas {
  readonly lambdaHome: number;
  readonly lambdaAway: number;
}

/**
 * The four continuous Dixon-Coles parameters. GRID_MAX is structural (49+1
 * cells) and stays fixed. The public API reads DEFAULT_SCORE_PARAMS from
 * config; the backtest passes candidate sets to calibrate them.
 */
export interface ScoreParams {
  readonly goalsBaseline: number;
  readonly homeGoalAdv: number;
  readonly dixonColesRho: number;
  readonly supremacyPerElo: number;
}

export const DEFAULT_SCORE_PARAMS: ScoreParams = {
  goalsBaseline: SCORE.GOALS_BASELINE,
  homeGoalAdv: SCORE.HOME_GOAL_ADV,
  dixonColesRho: SCORE.DIXON_COLES_RHO,
  supremacyPerElo: SCORE.SUPREMACY_PER_ELO,
};

/** Aggregate cell for any scoreline with 7+ goals on either side. */
export const OTHER_SCORE = '7+/other';

/** Canonical score string; collapses out-of-grid scores to OTHER_SCORE. */
export function scoreString(home: number, away: number): string {
  if (home > SCORE.GRID_MAX || away > SCORE.GRID_MAX) return OTHER_SCORE;
  return `${home}-${away}`;
}

/** Smallest attacking rate we allow — guards against pathological calibration. */
const LAMBDA_FLOOR = 0.01;

export function lambdasFromElo(
  eloHome: number,
  eloAway: number,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): Lambdas {
  const supremacy = params.supremacyPerElo * (eloHome - eloAway) + params.homeGoalAdv;
  const lambdaHome = Math.max(LAMBDA_FLOOR, (params.goalsBaseline + supremacy) / 2);
  const lambdaAway = Math.max(LAMBDA_FLOOR, (params.goalsBaseline - supremacy) / 2);
  return { lambdaHome, lambdaAway };
}

function factorial(n: number): number {
  let acc = 1;
  for (let i = 2; i <= n; i += 1) acc *= i;
  return acc;
}

function poisson(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/**
 * Dixon-Coles τ correction. λ = home rate, μ = away rate, ρ = dependence.
 * Returns 1 outside the four low-score cells (no effect there).
 */
function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function scoreGrid(
  eloHome: number,
  eloAway: number,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): readonly ScoreCell[] {
  const { lambdaHome, lambdaAway } = lambdasFromElo(eloHome, eloAway, params);
  const rho = params.dixonColesRho;
  const cells: ScoreCell[] = [];
  let explicit = 0;
  for (let home = 0; home <= SCORE.GRID_MAX; home += 1) {
    for (let away = 0; away <= SCORE.GRID_MAX; away += 1) {
      const prob = tau(home, away, lambdaHome, lambdaAway, rho) * poisson(home, lambdaHome) * poisson(away, lambdaAway);
      cells.push({ home, away, prob });
      explicit += prob;
    }
  }
  // 7+/Other absorbs the truncation residual so the grid sums to exactly 1.
  // D-C nets to zero over the full grid, so this residual equals the
  // independent-Poisson tail mass and is non-negative.
  cells.push({ home: SCORE.GRID_MAX + 1, away: SCORE.GRID_MAX + 1, prob: Math.max(0, 1 - explicit) });

  const total = cells.reduce((sum, c) => sum + c.prob, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`scoreGrid did not normalize: sum=${total}`);
  }
  return cells;
}

/**
 * The preferred of two cells under the pick rule: higher probability, then the
 * deterministic tie-break — lower total goals, then more home-favoured. Pulled
 * out so the tie-break is unit-testable in isolation.
 */
export function betterCell(a: ScoreCell, b: ScoreCell): ScoreCell {
  if (a.prob !== b.prob) return a.prob > b.prob ? a : b;
  const totalA = a.home + a.away;
  const totalB = b.home + b.away;
  if (totalA !== totalB) return totalA < totalB ? a : b;
  return a.home - a.away >= b.home - b.away ? a : b;
}

/**
 * Modal scoreline (argmax of the grid) — mirrors the 1X2 "publish the model's
 * opinion" stance, not a value-maximising max-edge selection. Ties break
 * deterministically via betterCell.
 */
export function makeScorePick(
  eloHome: number,
  eloAway: number,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): ScoreModelPick {
  const grid = scoreGrid(eloHome, eloAway, params);
  const best = grid.reduce((acc, cell) => betterCell(acc, cell), grid[0] as ScoreCell);
  return { score: scoreString(best.home, best.away), probability: best.prob, grid };
}

/**
 * "Low edge" rule for the score pick, mirroring isLowEdge. Frozen at pick time
 * (D13). marketProbability is the de-vigged market prob of the picked score,
 * or null when no score odds were available (caller suppresses the label).
 */
export function isScoreLowEdge(pick: ScoreModelPick, marketProbability: number | null): boolean {
  if (pick.probability < SCORE_HONESTY.CONFIDENCE_FLOOR) return true;
  if (marketProbability === null) return false;
  const gapPp = Math.abs(pick.probability - marketProbability) * 100;
  return gapPp < SCORE_HONESTY.MARKET_GAP_MIN_PP;
}
