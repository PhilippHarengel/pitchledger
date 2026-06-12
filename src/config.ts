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
