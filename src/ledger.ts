import type { Outcome, Probabilities } from './model.js';

/**
 * Ledger grading states:
 *   WIN / LOSS — pick graded against the 90-minute result
 *   VOID       — match postponed or abandoned; excluded from hit-rate
 *   NO-PICK    — pipeline produced no pick before kickoff; excluded from
 *                the hit-rate denominator but shown (gaps are logged,
 *                never silent)
 *   PENDING    — pick published, match not yet graded
 */
export type Grade = 'WIN' | 'LOSS' | 'VOID' | 'NO-PICK' | 'PENDING';

export interface LedgerEntry {
  readonly matchId: string;
  readonly date: string;
  readonly kickoffUtc: string;
  readonly home: string;
  readonly away: string;
  readonly pick: Outcome | null;
  readonly confidence: number | null;
  readonly probabilities: Probabilities | null;
  readonly eloDiff: number | null;
  /** De-vigged market probability of the picked outcome at pick time; null = no odds. */
  readonly marketAtPick: number | null;
  /** Frozen at pick time (D13). Never recomputed. */
  readonly lowEdge: boolean | null;
  readonly grade: Grade;
  readonly result: string | null;
  /** Commit SHA that introduced the pick (proof link). */
  readonly pickCommit: string | null;
  /** Ratings staleness note ("ratings as of <date>") when grading lagged. */
  readonly ratingsAsOf: string | null;
}

export interface LedgerStats {
  readonly graded: number;
  readonly wins: number;
  readonly hitRate: number | null;
  readonly dots: readonly ('W' | 'L')[];
}

/** Hit-rate over WIN/LOSS only — VOID, NO-PICK, PENDING excluded (doc rule). */
export function ledgerStats(entries: readonly LedgerEntry[]): LedgerStats {
  const gradedEntries = entries.filter((e) => e.grade === 'WIN' || e.grade === 'LOSS');
  const wins = gradedEntries.filter((e) => e.grade === 'WIN').length;
  const graded = gradedEntries.length;
  return {
    graded,
    wins,
    hitRate: graded === 0 ? null : wins / graded,
    dots: gradedEntries.map((e) => (e.grade === 'WIN' ? 'W' : 'L')),
  };
}
