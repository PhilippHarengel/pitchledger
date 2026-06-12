import type { Outcome } from './model.js';
import type { Grade, LedgerEntry } from './ledger.js';

/**
 * Grading convention (stated on the page): picks grade on the result after
 * 90 minutes plus injury time. Knockout matches decided in extra time or
 * penalties grade as DRAW when level after 90. Postponed/abandoned → VOID.
 */
export type MatchStatus = 'FINISHED' | 'POSTPONED' | 'ABANDONED' | 'SCHEDULED' | 'IN_PLAY';

export interface FinalResult {
  readonly status: MatchStatus;
  /** 90-minute goals; null when match did not finish. */
  readonly homeGoals90: number | null;
  readonly awayGoals90: number | null;
}

export function outcomeFromGoals(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return 'HOME';
  if (homeGoals < awayGoals) return 'AWAY';
  return 'DRAW';
}

export function gradePick(pick: Outcome | null, result: FinalResult): Grade {
  if (result.status === 'POSTPONED' || result.status === 'ABANDONED') return 'VOID';
  if (result.status !== 'FINISHED') return pick === null ? 'NO-PICK' : 'PENDING';
  if (pick === null) return 'NO-PICK';
  if (result.homeGoals90 === null || result.awayGoals90 === null) {
    throw new Error('FINISHED match without 90-minute goals');
  }
  return outcomeFromGoals(result.homeGoals90, result.awayGoals90) === pick ? 'WIN' : 'LOSS';
}

/** Returns a new entry — never mutates (graded entries are immutable history). */
export function gradeEntry(entry: LedgerEntry, result: FinalResult): LedgerEntry {
  const grade = gradePick(entry.pick, result);
  const resultText =
    result.status === 'FINISHED' && result.homeGoals90 !== null && result.awayGoals90 !== null
      ? `${result.homeGoals90}–${result.awayGoals90}`
      : result.status === 'POSTPONED' || result.status === 'ABANDONED'
        ? result.status
        : null;
  return { ...entry, grade, result: resultText };
}
