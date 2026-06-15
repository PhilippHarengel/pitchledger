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
 * Correct-score (Dixon-Coles) model parameters, calibrated by
 * backtest/backtest.ts (grid search) against the 2022 World Cup (64 matches;
 * ratings + scorelines self-sourced via scripts/build-backtest-data.ts).
 *
 * EXPERIMENTAL: at the calibrated values exact-score accuracy is 17.2% (11/64)
 * vs a 10.9% always-1-0 baseline — it clears the sanity gate but on a single
 * 64-match tournament, so treat the score market as not yet edge-validated. rho
 * is capped at -0.15 (beyond that the search overfits / the correction breaks).
 * Re-run the backtest and update these when more scoreline history is available.
 */
export const SCORE = {
  /** Explicit grid cells 0..6 per side, then a single 7+/Other cell. */
  GRID_MAX: 6,
  /** Expected total goals in an even match. */
  GOALS_BASELINE: 2.4,
  /** Neutral-venue home goal advantage. */
  HOME_GOAL_ADV: 0.1,
  /** Dixon-Coles low-score dependence ρ (negative lifts draw/low-score mass). */
  DIXON_COLES_RHO: -0.15,
  /** Elo difference → goal-supremacy slope (goals per Elo point). */
  SUPREMACY_PER_ELO: 0.005,
} as const;

/**
 * Correct-score honesty thresholds. Frozen into each pick at pick time, same
 * as HONESTY for 1X2. CONFIDENCE_FLOOR is the backtest's recommended floor (~40th
 * percentile of modal probs). MARKET_GAP_MIN_PP stays 0: The Odds API does not
 * serve a correct_score market for this sport (Phase-0 probe, issue #2), so there
 * is no market probability to gap against — recalibrate if a score odds feed is added.
 */
export const SCORE_HONESTY = {
  /** Score-pick model prob below this → low edge. */
  CONFIDENCE_FLOOR: 0.143,
  /** |model − market| below this gap (percentage points) → low edge. */
  MARKET_GAP_MIN_PP: 0.0,
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
