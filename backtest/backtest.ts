import { existsSync } from 'node:fs';
import { readJson, writeJson } from '../src/io.js';
import { makePick, outcomeProbabilities } from '../src/model.js';
import { makeScorePick, scoreString, type ScoreParams } from '../src/goals.js';
import { outcomeFromGoals } from '../src/grade.js';
import { HONESTY, MODEL, SCORE, SCORE_HONESTY } from '../src/config.js';

/**
 * Calibration backtest against the 2022 World Cup (eng review D10).
 *
 * Requires backtest/data-2022.json:
 *   {
 *     "ratings": { "<team>": <elo on 2022-11-20>, ... },
 *     "matches": [ { "home": "...", "away": "...", "homeGoals90": n, "awayGoals90": n }, ... ]
 *   }
 *
 * Populate ratings from a licensed Elo source (T1: verify eloratings.net
 * terms first) and matches via football-data.org /competitions/WC/matches?season=2022.
 *
 * Reports two markets:
 *   1X2   — accuracy, draw-pick rate, skip-label rate (sanity: draw-pick rate
 *           10-30%, skip rate < 50%, accuracy beats always-pick-favorite).
 *   SCORE — grid-searches the four Dixon-Coles params for max exact-score
 *           accuracy, then reports that accuracy vs two naive baselines
 *           (always 1-1, always 1-0) and a score-edge skip-rate. Sanity gate:
 *           exact-score accuracy beats BOTH baselines.
 *
 * The recommended SCORE / SCORE_HONESTY block printed at the end is what gets
 * pasted (by hand, after review) into src/config.ts — the placeholders there
 * are never the final values.
 */
interface BacktestData {
  readonly ratings: Readonly<Record<string, number>>;
  readonly matches: readonly {
    readonly home: string;
    readonly away: string;
    readonly homeGoals90: number;
    readonly awayGoals90: number;
  }[];
}

const DATA_PATH = 'backtest/data-2022.json';
if (!existsSync(DATA_PATH)) {
  console.error(
    `Missing ${DATA_PATH} — populate it first (see file header). ` +
      'This backtest gates launch: thresholds in src/config.ts are not validated without it.',
  );
  process.exit(1);
}

const data = readJson<BacktestData>(DATA_PATH);

// Matches that actually carry ratings on both sides — shared by both markets.
const rated = data.matches.filter(
  (m) => data.ratings[m.home] !== undefined && data.ratings[m.away] !== undefined,
);
for (const m of data.matches) {
  if (data.ratings[m.home] === undefined || data.ratings[m.away] === undefined) {
    console.warn(`[backtest] missing rating: ${m.home} / ${m.away} — skipped`);
  }
}

// ── 1X2 market ───────────────────────────────────────────────────────────
let wins = 0;
let drawPicks = 0;
let skips = 0;
let actualDraws = 0;
for (const m of rated) {
  const pick = makePick(data.ratings[m.home] as number, data.ratings[m.away] as number);
  const actual = outcomeFromGoals(m.homeGoals90, m.awayGoals90);
  if (actual === 'DRAW') actualDraws += 1;
  if (pick.outcome === 'DRAW') drawPicks += 1;
  if (pick.confidence < HONESTY.CONFIDENCE_FLOOR) skips += 1;
  if (pick.outcome === actual) wins += 1;
}
const evaluated = rated.length;

// ── Correct-score market: grid search the Dixon-Coles params ───────────────
const GOALS_BASELINE_GRID = [1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2];
const HOME_GOAL_ADV_GRID = [0.0, 0.1, 0.2, 0.3];
// Dixon-Coles rho is only well-behaved for small magnitudes; capping at -0.15
// keeps the low-score correction valid (beyond ~-0.2 it overfits / can go
// negative on a 64-match sample).
const RHO_GRID = [-0.15, -0.12, -0.1, -0.08, -0.05, -0.03, 0.0];
const SUPREMACY_GRID = [0.0005, 0.001, 0.0015, 0.002, 0.0025, 0.003, 0.0035, 0.004, 0.005];

function scoreAccuracy(params: ScoreParams): { accuracy: number; meanModalProb: number } {
  let hits = 0;
  let probSum = 0;
  for (const m of rated) {
    const pick = makeScorePick(data.ratings[m.home] as number, data.ratings[m.away] as number, params);
    probSum += pick.probability;
    if (pick.score === scoreString(m.homeGoals90, m.awayGoals90)) hits += 1;
  }
  return { accuracy: evaluated ? hits / evaluated : 0, meanModalProb: evaluated ? probSum / evaluated : 0 };
}

let best: { params: ScoreParams; accuracy: number; meanModalProb: number } | null = null;
for (const goalsBaseline of GOALS_BASELINE_GRID) {
  for (const homeGoalAdv of HOME_GOAL_ADV_GRID) {
    for (const dixonColesRho of RHO_GRID) {
      for (const supremacyPerElo of SUPREMACY_GRID) {
        const params: ScoreParams = { goalsBaseline, homeGoalAdv, dixonColesRho, supremacyPerElo };
        const { accuracy, meanModalProb } = scoreAccuracy(params);
        if (!best || accuracy > best.accuracy) best = { params, accuracy, meanModalProb };
      }
    }
  }
}

// Naive baselines: a fixed scoreline every match.
const baselineHit = (label: string): number => {
  let hits = 0;
  for (const m of rated) if (scoreString(m.homeGoals90, m.awayGoals90) === label) hits += 1;
  return evaluated ? hits / evaluated : 0;
};
const alwaysOneOne = baselineHit('1-1');
const alwaysOneZero = baselineHit('1-0');

// Score-edge skip-rate at the calibrated confidence floor (recommend the modal
// floor at ~the 40th percentile of modal probs, a starting point for review).
const calibrated = best ?? {
  params: {
    goalsBaseline: SCORE.GOALS_BASELINE,
    homeGoalAdv: SCORE.HOME_GOAL_ADV,
    dixonColesRho: SCORE.DIXON_COLES_RHO,
    supremacyPerElo: SCORE.SUPREMACY_PER_ELO,
  },
  accuracy: 0,
  meanModalProb: 0,
};
const modalProbs = rated
  .map((m) => makeScorePick(data.ratings[m.home] as number, data.ratings[m.away] as number, calibrated.params).probability)
  .sort((a, b) => a - b);
const recommendedFloor = modalProbs.length ? (modalProbs[Math.floor(modalProbs.length * 0.4)] as number) : 0;
const scoreSkips = modalProbs.filter((p) => p < recommendedFloor).length;

const beatsBaselines = calibrated.accuracy > alwaysOneOne && calibrated.accuracy > alwaysOneZero;

const report = {
  oneX2: {
    config: { nu: MODEL.DRAW_NU, drawPickThreshold: MODEL.DRAW_PICK_THRESHOLD, confidenceFloor: HONESTY.CONFIDENCE_FLOOR },
    evaluated,
    accuracy: evaluated ? wins / evaluated : null,
    drawPickRate: evaluated ? drawPicks / evaluated : null,
    actualDrawRate: evaluated ? actualDraws / evaluated : null,
    skipLabelRate: evaluated ? skips / evaluated : null,
    exampleEvenMatch: outcomeProbabilities(1900, 1900),
  },
  score: {
    evaluated,
    calibratedParams: calibrated.params,
    exactScoreAccuracy: calibrated.accuracy,
    baselineAlways11: alwaysOneOne,
    baselineAlways10: alwaysOneZero,
    beatsBothBaselines: beatsBaselines,
    meanModalProb: calibrated.meanModalProb,
    recommendedConfidenceFloor: recommendedFloor,
    scoreSkipRate: evaluated ? scoreSkips / evaluated : null,
    // MARKET_GAP_MIN_PP needs live correct-score odds (absent from 2022 data) —
    // calibrate it from a snapshot once Phase 0 confirms the market exists.
    recommendedConfig: {
      SCORE: {
        GRID_MAX: SCORE.GRID_MAX,
        GOALS_BASELINE: calibrated.params.goalsBaseline,
        HOME_GOAL_ADV: calibrated.params.homeGoalAdv,
        DIXON_COLES_RHO: calibrated.params.dixonColesRho,
        SUPREMACY_PER_ELO: calibrated.params.supremacyPerElo,
      },
      SCORE_HONESTY: {
        CONFIDENCE_FLOOR: recommendedFloor,
        MARKET_GAP_MIN_PP: SCORE_HONESTY.MARKET_GAP_MIN_PP, // needs live odds
      },
    },
  },
};

writeJson('backtest/results-2022.json', report);
console.log(JSON.stringify(report, null, 2));

if (!beatsBaselines) {
  console.error(
    '[backtest] SANITY FAIL: exact-score accuracy does not beat both naive baselines ' +
      `(${calibrated.accuracy} vs 1-1 ${alwaysOneOne}, 1-0 ${alwaysOneZero}). Do not trust SCORE params.`,
  );
  process.exit(1);
}
