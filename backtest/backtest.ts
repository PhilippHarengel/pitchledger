import { existsSync } from 'node:fs';
import { readJson, writeJson } from '../src/io.js';
import { makePick, outcomeProbabilities } from '../src/model.js';
import { outcomeFromGoals } from '../src/grade.js';
import { HONESTY, MODEL } from '../src/config.js';

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
 * Reports: accuracy, draw-pick rate, skip-label rate — sanity targets:
 * draw-pick rate 10-30%, skip rate < 50%, accuracy beating always-pick-favorite baseline.
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
let wins = 0;
let drawPicks = 0;
let skips = 0;
let evaluated = 0;
let actualDraws = 0;

for (const m of data.matches) {
  const eloHome = data.ratings[m.home];
  const eloAway = data.ratings[m.away];
  if (eloHome === undefined || eloAway === undefined) {
    console.warn(`[backtest] missing rating: ${m.home} / ${m.away} — skipped`);
    continue;
  }
  evaluated += 1;
  const pick = makePick(eloHome, eloAway);
  const actual = outcomeFromGoals(m.homeGoals90, m.awayGoals90);
  if (actual === 'DRAW') actualDraws += 1;
  if (pick.outcome === 'DRAW') drawPicks += 1;
  if (pick.confidence < HONESTY.CONFIDENCE_FLOOR) skips += 1;
  if (pick.outcome === actual) wins += 1;
}

const report = {
  config: { nu: MODEL.DRAW_NU, drawPickThreshold: MODEL.DRAW_PICK_THRESHOLD, confidenceFloor: HONESTY.CONFIDENCE_FLOOR },
  evaluated,
  accuracy: evaluated ? wins / evaluated : null,
  drawPickRate: evaluated ? drawPicks / evaluated : null,
  actualDrawRate: evaluated ? actualDraws / evaluated : null,
  skipLabelRate: evaluated ? skips / evaluated : null,
  exampleEvenMatch: outcomeProbabilities(1900, 1900),
};

writeJson('backtest/results-2022.json', report);
console.log(JSON.stringify(report, null, 2));
