import { describe, expect, test } from 'vitest';
import { applyResult, applyResults, expectedScore, type EloRatings } from '../src/elo.js';
import { devig, devigMultiway } from '../src/devig.js';
import { gradeEntry, gradePick, gradeScore, outcomeFromGoals } from '../src/grade.js';
import type { LedgerEntry } from '../src/ledger.js';
import { ledgerStats, scoreLedgerStats } from '../src/ledger.js';
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

describe('devigMultiway', () => {
  test('normalizes N correct-score outcomes to sum 1', () => {
    const book = new Map<string, number>([
      ['1-0', 7.5],
      ['2-1', 8.0],
      ['1-1', 6.5],
      ['0-0', 11],
      ['7+/other', 4.2],
    ]);
    const probs = devigMultiway(book);
    const total = [...probs.values()].reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(1, 10);
    // Shorter odds (1-1 at 6.5) imply more probability than longer (0-0 at 11).
    expect(probs.get('1-1')).toBeGreaterThan(probs.get('0-0') as number);
  });

  test('throws on any odds at or below 1', () => {
    expect(() => devigMultiway(new Map([['2-1', 8], ['1-1', 1.0]]))).toThrow(/Invalid decimal odds/);
  });
});

const baseEntry: LedgerEntry = {
  matchId: '1', date: '2026-06-13', kickoffUtc: '2026-06-13T16:00:00Z', home: 'Germany', away: 'Scotland',
  pick: 'HOME', confidence: 0.61, probabilities: { home: 0.61, draw: 0.22, away: 0.17 },
  eloDiff: 200, marketAtPick: 0.66, lowEdge: false, grade: 'PENDING',
  scorePick: '2-1', scoreConfidence: 0.12, scoreMarketAtPick: null, scoreLowEdge: null, scoreGrade: 'PENDING',
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

  test('gradeEntry sets scoreGrade independently of the 1X2 grade', () => {
    // 1X2 HOME pick on a 2–1 result wins; score pick "2-1" also wins.
    const both = gradeEntry(baseEntry, { status: 'FINISHED', homeGoals90: 2, awayGoals90: 1 });
    expect(both.grade).toBe('WIN');
    expect(both.scoreGrade).toBe('WIN');
    // 1X2 HOME pick on a 3–0 result wins, but the "2-1" score pick loses.
    const split = gradeEntry(baseEntry, { status: 'FINISHED', homeGoals90: 3, awayGoals90: 0 });
    expect(split.grade).toBe('WIN');
    expect(split.scoreGrade).toBe('LOSS');
  });
});

describe('gradeScore', () => {
  test('exact 90-minute score wins, any other score loses (all 4 picks)', () => {
    const result = { status: 'FINISHED' as const, homeGoals90: 2, awayGoals90: 1 };
    expect(gradeScore('2-1', result)).toBe('WIN');
    expect(gradeScore('1-2', result)).toBe('LOSS');
    expect(gradeScore('1-1', result)).toBe('LOSS');
    expect(gradeScore('3-1', result)).toBe('LOSS');
  });

  test('7+/other wins when either side scored 7+', () => {
    expect(gradeScore('7+/other', { status: 'FINISHED', homeGoals90: 7, awayGoals90: 0 })).toBe('WIN');
    expect(gradeScore('2-1', { status: 'FINISHED', homeGoals90: 7, awayGoals90: 0 })).toBe('LOSS');
  });

  test('postponed/abandoned grade VOID regardless of pick', () => {
    expect(gradeScore('2-1', { status: 'POSTPONED', homeGoals90: null, awayGoals90: null })).toBe('VOID');
    expect(gradeScore(null, { status: 'ABANDONED', homeGoals90: null, awayGoals90: null })).toBe('VOID');
  });

  test('null score pick grades NO-PICK (finished or not)', () => {
    expect(gradeScore(null, { status: 'FINISHED', homeGoals90: 1, awayGoals90: 0 })).toBe('NO-PICK');
    expect(gradeScore(null, { status: 'IN_PLAY', homeGoals90: null, awayGoals90: null })).toBe('NO-PICK');
  });

  test('unfinished match with a pick stays PENDING', () => {
    expect(gradeScore('2-1', { status: 'SCHEDULED', homeGoals90: null, awayGoals90: null })).toBe('PENDING');
  });
});

describe('scoreLedgerStats', () => {
  test('counts only score WIN/LOSS — VOID, NO-PICK, PENDING excluded', () => {
    const entries: LedgerEntry[] = [
      { ...baseEntry, matchId: 'a', scoreGrade: 'WIN' },
      { ...baseEntry, matchId: 'b', scoreGrade: 'LOSS' },
      { ...baseEntry, matchId: 'c', scoreGrade: 'WIN' },
      { ...baseEntry, matchId: 'd', scoreGrade: 'VOID' },
      { ...baseEntry, matchId: 'e', scoreGrade: 'NO-PICK' },
      { ...baseEntry, matchId: 'f', scoreGrade: 'PENDING' },
    ];
    const stats = scoreLedgerStats(entries);
    expect(stats.graded).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 10);
    expect(stats.dots).toEqual(['W', 'L', 'W']);
  });

  test('legacy rows without a scoreGrade are excluded', () => {
    // Simulate a pre-feature row: no score fields at all.
    const legacy = { ...baseEntry } as Record<string, unknown>;
    delete legacy['scoreGrade'];
    const stats = scoreLedgerStats([legacy as unknown as LedgerEntry]);
    expect(stats.graded).toBe(0);
    expect(stats.hitRate).toBeNull();
  });

  test('1X2 ledgerStats output is unchanged by the score fields', () => {
    const oneX2 = [
      { ...baseEntry, matchId: 'a', grade: 'WIN' as const, scoreGrade: 'LOSS' as const },
      { ...baseEntry, matchId: 'b', grade: 'LOSS' as const, scoreGrade: 'WIN' as const },
    ];
    // Stripping the score fields must not change the 1X2 hit-rate.
    const stripped = oneX2.map((e) => {
      const copy = { ...e } as Record<string, unknown>;
      for (const k of ['scorePick', 'scoreConfidence', 'scoreMarketAtPick', 'scoreLowEdge', 'scoreGrade']) {
        delete copy[k];
      }
      return copy as unknown as LedgerEntry;
    });
    expect(ledgerStats(oneX2)).toEqual(ledgerStats(stripped));
    expect(ledgerStats(oneX2)).toEqual({ graded: 2, wins: 1, hitRate: 0.5, dots: ['W', 'L'] });
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
