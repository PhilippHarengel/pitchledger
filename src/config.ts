/**
 * Model + product thresholds.
 *
 * DRAW_NU and DRAW_PICK_THRESHOLD are calibrated by backtest/backtest.ts
 * against 2022 World Cup results (see backtest/README.md). Do not tune by
 * hand without re-running the backtest.
 */
export const MODEL = {
  /** Davidson draw parameter ν. ν/(2+ν) = draw prob between equals (~26%). */
  DRAW_NU: 0.7,
  /** Elo K-factor for World Cup matches (World Football Elo convention). */
  ELO_K: 60,
  /** Pick the draw when neither side's probability reaches this floor. */
  DRAW_PICK_THRESHOLD: 0.42,
} as const;

export const HONESTY = {
  /** "Low edge — consider skip" below this confidence... */
  CONFIDENCE_FLOOR: 0.45,
  /** ...or when |model − market| is under this gap (percentage points). */
  MARKET_GAP_MIN_PP: 3,
} as const;

/**
 * Correct-score (Dixon-Coles) model parameters. All five are calibrated by
 * backtest/backtest.ts against 2022 scorelines — never hand-tuned (same rule
 * as DRAW_NU). The placeholders below let the model run; they are not final.
 */
export const SCORE = {
  /** Explicit grid cells 0..6 per side, then a single 7+/Other cell. */
  GRID_MAX: 6,
  /** Expected total goals in an even match. */
  GOALS_BASELINE: 2.6, // CALIBRATED
  /** Neutral-venue home goal advantage (likely ~0 for WC). */
  HOME_GOAL_ADV: 0.0, // CALIBRATED
  /** Dixon-Coles low-score dependence ρ (negative lifts draw/low-score mass). */
  DIXON_COLES_RHO: -0.05, // CALIBRATED
  /** Elo difference → goal-supremacy slope (goals per Elo point). */
  SUPREMACY_PER_ELO: 0.0, // CALIBRATED
} as const;

/**
 * Correct-score honesty thresholds. Frozen into each pick at pick time, same
 * as HONESTY for 1X2. Calibrated by the backtest; placeholders below make the
 * label a no-op until calibration fills them in.
 */
export const SCORE_HONESTY = {
  /** Score-pick model prob below this → low edge. */
  CONFIDENCE_FLOOR: 0.0, // CALIBRATED
  /** |model − market| below this gap (percentage points) → low edge. */
  MARKET_GAP_MIN_PP: 0.0, // CALIBRATED
} as const;

export const PATHS = {
  ELO: 'data/elo.json',
  ELO_FOLD_LOG: 'data/elo-fold-log.json',
  LEDGER: 'data/ledger.json',
  PICKS_DIR: 'data/picks',
  SNAPSHOT: 'data/market-snapshot.json',
  FIXTURES_FALLBACK: 'data/fixtures.json',
  // Pages deploy-from-branch serves only / or /docs — site lives in docs/.
  SITE: 'docs/index.html',
} as const;

/** Ledger rows exist only from this date onward (launch cutoff, D14). */
export const LAUNCH_DATE = '2026-06-12';

/**
 * Exact launch instant. Matches that kicked off before this moment are
 * backfill territory (Elo only, no ledger row); matches kicking off after
 * it that somehow go unpicked get an explicit NO-PICK row.
 */
export const LAUNCH_AT = '2026-06-12T21:30:00Z';

/** Pipeline day boundary timezone (matches are in North America). */
export const PIPELINE_TZ = 'America/New_York';
