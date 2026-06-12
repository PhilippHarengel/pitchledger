import { describe, expect, test } from 'vitest';
import { applyResult, applyResults, expectedScore, type EloRatings } from '../src/elo.js';
import { devig } from '../src/devig.js';
import { gradeEntry, gradePick, outcomeFromGoals } from '../src/grade.js';
import type { LedgerEntry } from '../src/ledger.js';
import { ledgerStats } from '../src/ledger.js';
import { MODEL } from '../src/config.js';

const seed: EloRatings = { asOf: '2026-06-12', ratings: { Germany: 2000, Scotland: 1800 } };

describe('elo', () => {
  test('winner gains exactly what loser drops (zero-sum, K=60)', () => {
    const next = applyResult(seed, { home: 'Germany', away: 'Scotland', homeGoals: 2, awayGoals: 0 }, '2026-06-13');
    const dGer = (next.ratings['Germany'] ?? 0) - 2000;
    const dSco = (next.ratings['Scotland'] ?? 0) - 1800;
    expect(dGer).toBeCloseTo(-dSco, 10);
    expect(dGer).toBeCloseTo(MODEL.ELO_K * (1 - expectedScore(200)), 10);
  });

  test('favorite drawing loses rating', () => {
    const next = applyResult(seed, { home: 'Germany', away: 'Scotland', homeGoals: 1, awayGoals: 1 }, '2026-06-13');
    expect(next.ratings['Germany']).toBeLessThan(2000);
    expect(next.ratings['Scotland']).toBeGreaterThan(1800);
  });

  test('does not mutate the input ratings', () => {
    applyResult(seed, { home: 'Germany', away: 'Scotland', homeGoals: 0, awayGoals: 1 }, '2026-06-13');
    expect(seed.ratings['Germany']).toBe(2000);
  });

  test('unknown team throws', () => {
    expect(() =>
      applyResult(seed, { home: 'Atlantis', away: 'Scotland', homeGoals: 1, awayGoals: 0 }, 'x'),
    ).toThrow(/Unknown team/);
  });

  test('applyResults folds sequentially', () => {
    const next = applyResults(
      seed,
      [
        { home: 'Germany', away: 'Scotland', homeGoals: 1, awayGoals: 0 },
        { home: 'Scotland', away: 'Germany', homeGoals: 1, awayGoals: 0 },
      ],
      '2026-06-14',
    );
    expect(next.asOf).toBe('2026-06-14');
    // Upset in game 2 transfers more points than game 1 took.
    expect(next.ratings['Scotland']).toBeGreaterThan(1800);
  });
});

describe('devig', () => {
  test('normalizes implied probabilities to 1', () => {
    const m = devig(1.45, 4.6, 7.5);
    expect(m.home + m.draw + m.away).toBeCloseTo(1, 10);
    expect(m.home).toBeGreaterThan(m.draw);
  });

  test('rejects odds at or below 1', () => {
    expect(() => devig(1.0, 4.0, 8.0)).toThrow(/Invalid decimal odds/);
    expect(() => devig(2.0, 0.9, 8.0)).toThrow(/Invalid decimal odds/);
  });
});

const baseEntry: LedgerEntry = {
  matchId: '1', date: '2026-06-13', kickoffUtc: '2026-06-13T16:00:00Z', home: 'Germany', away: 'Scotland',
  pick: 'HOME', confidence: 0.61, probabilities: { home: 0.61, draw: 0.22, away: 0.17 },
  eloDiff: 200, marketAtPick: 0.66, lowEdge: false, grade: 'PENDING',
  result: null, pickCommit: null, ratingsAsOf: null,
};

describe('grade', () => {
  test('outcomeFromGoals covers all three outcomes', () => {
    expect(outcomeFromGoals(2, 1)).toBe('HOME');
    expect(outcomeFromGoals(0, 1)).toBe('AWAY');
    expect(outcomeFromGoals(1, 1)).toBe('DRAW');
  });

  test('WIN and LOSS on the 90-minute result', () => {
    expect(gradePick('HOME', { status: 'FINISHED', homeGoals90: 2, awayGoals90: 1 })).toBe('WIN');
    expect(gradePick('HOME', { status: 'FINISHED', homeGoals90: 1, awayGoals90: 1 })).toBe('LOSS');
  });

  test('knockout level after 90 grades as DRAW result (pick DRAW wins)', () => {
    expect(gradePick('DRAW', { status: 'FINISHED', homeGoals90: 1, awayGoals90: 1 })).toBe('WIN');
  });

  test('postponed/abandoned grade VOID regardless of pick', () => {
    expect(gradePick('HOME', { status: 'POSTPONED', homeGoals90: null, awayGoals90: null })).toBe('VOID');
    expect(gradePick(null, { status: 'ABANDONED', homeGoals90: null, awayGoals90: null })).toBe('VOID');
  });

  test('null pick on a finished match grades NO-PICK', () => {
    expect(gradePick(null, { status: 'FINISHED', homeGoals90: 1, awayGoals90: 0 })).toBe('NO-PICK');
  });

  test('unfinished match stays PENDING (or NO-PICK without pick)', () => {
    expect(gradePick('HOME', { status: 'SCHEDULED', homeGoals90: null, awayGoals90: null })).toBe('PENDING');
    expect(gradePick(null, { status: 'IN_PLAY', homeGoals90: null, awayGoals90: null })).toBe('NO-PICK');
  });

  test('FINISHED without goals is a hard error', () => {
    expect(() => gradePick('HOME', { status: 'FINISHED', homeGoals90: null, awayGoals90: null })).toThrow();
  });

  test('gradeEntry returns a new entry with result text, input untouched', () => {
    const graded = gradeEntry(baseEntry, { status: 'FINISHED', homeGoals90: 2, awayGoals90: 1 });
    expect(graded.grade).toBe('WIN');
    expect(graded.result).toBe('2–1');
    expect(baseEntry.grade).toBe('PENDING');
  });
});

describe('ledgerStats', () => {
  test('excludes VOID, NO-PICK and PENDING from the hit-rate', () => {
    const entries: LedgerEntry[] = [
      { ...baseEntry, matchId: 'a', grade: 'WIN' },
      { ...baseEntry, matchId: 'b', grade: 'LOSS' },
      { ...baseEntry, matchId: 'c', grade: 'VOID' },
      { ...baseEntry, matchId: 'd', grade: 'NO-PICK', pick: null },
      { ...baseEntry, matchId: 'e', grade: 'PENDING' },
    ];
    const stats = ledgerStats(entries);
    expect(stats.graded).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5, 10);
    expect(stats.dots).toEqual(['W', 'L']);
  });

  test('zero graded picks yields null hit-rate, no division by zero', () => {
    expect(ledgerStats([]).hitRate).toBeNull();
    expect(ledgerStats([{ ...baseEntry, grade: 'PENDING' }]).hitRate).toBeNull();
  });
});
