import { describe, expect, test } from 'vitest';
import {
  buildMissedEntries, buildOddsLookup, buildScoreOddsLookup, buildTodayEntries, gradeFinished, mergeEntries, pipelineDay,
} from '../src/pipeline.js';
import type { EloRatings } from '../src/elo.js';
import type { LedgerEntry } from '../src/ledger.js';
import type { WcMatch } from '../src/clients/footballData.js';
import type { ScoreOdds } from '../src/clients/oddsApi.js';
import type { FinalResult } from '../src/grade.js';

const elo: EloRatings = { asOf: '2026-06-13', ratings: { Germany: 2000, Scotland: 1800 } };

const match = (over: Partial<WcMatch>): WcMatch => ({
  id: '1', utcDate: '2026-06-13T16:00:00Z', status: 'TIMED',
  home: 'Germany', away: 'Scotland', homeGoals90: null, awayGoals90: null,
  ...over,
});

const pending: LedgerEntry = {
  matchId: '1', date: '2026-06-13', kickoffUtc: '2026-06-13T16:00:00Z', home: 'Germany', away: 'Scotland',
  pick: 'HOME', confidence: 0.6, probabilities: { home: 0.6, draw: 0.22, away: 0.18 },
  eloDiff: 200, marketAtPick: null, lowEdge: false, grade: 'PENDING',
  scorePick: '2-1', scoreConfidence: 0.12, scoreMarketAtPick: null, scoreLowEdge: null, scoreGrade: 'PENDING',
  result: null, pickCommit: null, ratingsAsOf: null,
};

describe('pipelineDay', () => {
  test('uses the ET day boundary (late ET evening is still the same ET day)', () => {
    // 02:00 UTC June 14 = 22:00 ET June 13.
    expect(pipelineDay(new Date('2026-06-14T02:00:00Z'))).toBe('2026-06-13');
  });
});

describe('gradeFinished', () => {
  test('grades pending entries with final results, leaves others alone', () => {
    const results = new Map<string, FinalResult>([
      ['1', { status: 'FINISHED', homeGoals90: 2, awayGoals90: 0 }],
    ]);
    const [graded] = gradeFinished([pending], results);
    expect(graded?.grade).toBe('WIN');
  });

  test('no result yet → entry unchanged', () => {
    const [unchanged] = gradeFinished([pending], new Map());
    expect(unchanged?.grade).toBe('PENDING');
  });

  test('already-graded entries are immutable history', () => {
    const won: LedgerEntry = { ...pending, grade: 'WIN', result: '2–0' };
    const results = new Map<string, FinalResult>([
      ['1', { status: 'FINISHED', homeGoals90: 0, awayGoals90: 5 }],
    ]);
    const [kept] = gradeFinished([won], results);
    expect(kept?.grade).toBe('WIN');
    expect(kept?.result).toBe('2–0');
  });
});

describe('buildTodayEntries', () => {
  const noOdds = buildOddsLookup([]);
  const beforeKickoff = new Date('2026-06-13T08:00:00Z'); // hours before 16:00Z

  test('creates a pick entry for a today fixture', () => {
    const entries = buildTodayEntries([match({})], elo, noOdds, '2026-06-13', false, beforeKickoff);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pick).toBe('HOME');
    expect(entries[0]?.marketAtPick).toBeNull();
    expect(entries[0]?.lowEdge).toBe(false); // missing market suppresses gap rule
  });

  test('filters out fixtures on other days', () => {
    const entries = buildTodayEntries(
      [match({ utcDate: '2026-06-14T16:00:00Z' })], elo, noOdds, '2026-06-13', false, beforeKickoff,
    );
    expect(entries).toHaveLength(0);
  });

  test('launch cutoff (D14): no entries before launch date', () => {
    const entries = buildTodayEntries(
      [match({ utcDate: '2026-06-11T16:00:00Z' })], elo, noOdds, '2026-06-11', false,
      new Date('2026-06-11T08:00:00Z'),
    );
    expect(entries).toHaveLength(0);
  });

  test('REGRESSION: a FINISHED match never receives a pick (pick-after-result)', () => {
    // Live bug 2026-06-12: Canada vs Bosnia finished 1–1 at 19:00Z and the
    // pipeline "picked" it afterward. Status gate must exclude it.
    const entries = buildTodayEntries(
      [match({ status: 'FINISHED', homeGoals90: 1, awayGoals90: 1 })],
      elo, noOdds, '2026-06-13', false, new Date('2026-06-13T20:00:00Z'),
    );
    expect(entries).toHaveLength(0);
  });

  test('REGRESSION: a match already kicked off never receives a pick, even if still TIMED', () => {
    const entries = buildTodayEntries(
      [match({})], elo, noOdds, '2026-06-13', false,
      new Date('2026-06-13T16:00:01Z'), // 1s after kickoff
    );
    expect(entries).toHaveLength(0);
  });

  test('IN_PLAY matches are excluded', () => {
    const entries = buildTodayEntries(
      [match({ status: 'IN_PLAY' })], elo, noOdds, '2026-06-13', false, beforeKickoff,
    );
    expect(entries).toHaveLength(0);
  });

  test('unknown team rating → explicit NO-PICK, not a crash', () => {
    const entries = buildTodayEntries(
      [match({ home: 'Atlantis' })], elo, noOdds, '2026-06-13', false, beforeKickoff,
    );
    expect(entries[0]?.grade).toBe('NO-PICK');
    expect(entries[0]?.pick).toBeNull();
  });

  test('stale ratings stamp the entry (D3 degradation note)', () => {
    const entries = buildTodayEntries([match({})], elo, noOdds, '2026-06-13', true, beforeKickoff);
    expect(entries[0]?.ratingsAsOf).toBe('2026-06-13');
  });

  test('odds attach market probability of the picked outcome', () => {
    const lookup = buildOddsLookup([
      { home: 'Germany', away: 'Scotland', homeOdds: 1.45, drawOdds: 4.6, awayOdds: 7.5 },
    ]);
    const entries = buildTodayEntries([match({})], elo, lookup, '2026-06-13', false, beforeKickoff);
    expect(entries[0]?.marketAtPick).toBeGreaterThan(0.5);
  });

  test('carries a frozen score pick alongside the 1X2 pick (model-only path)', () => {
    const entries = buildTodayEntries([match({})], elo, noOdds, '2026-06-13', false, beforeKickoff);
    const e = entries[0];
    expect(e?.scorePick).not.toBeNull();
    expect(e?.scoreConfidence).toBeGreaterThan(0);
    expect(e?.scoreGrade).toBe('PENDING');
    // No score odds → chip "—" and the low-edge label is suppressed (criterion 9).
    expect(e?.scoreMarketAtPick).toBeNull();
    expect(e?.scoreLowEdge).toBeNull();
  });

  test('score odds attach the de-vigged market prob of the picked score', () => {
    const scoreLookup = buildScoreOddsLookup([
      {
        home: 'Germany',
        away: 'Scotland',
        scores: new Map<string, number>([
          ['1-1', 6.5],
          ['1-0', 7.0],
          ['2-1', 8.0],
          ['7+/other', 4.0],
        ]),
      } satisfies ScoreOdds,
    ]);
    const entries = buildTodayEntries([match({})], elo, noOdds, '2026-06-13', false, beforeKickoff, scoreLookup);
    const e = entries[0];
    expect(e?.scorePick).toBe('1-1'); // even-ish match, placeholder supremacy 0
    expect(e?.scoreMarketAtPick).toBeGreaterThan(0);
    expect(e?.scoreLowEdge).toBe(false); // placeholder thresholds → no-op (not null: odds present)
  });

  test('unknown team rating → score fields null / NO-PICK too', () => {
    const entries = buildTodayEntries([match({ home: 'Atlantis' })], elo, noOdds, '2026-06-13', false, beforeKickoff);
    expect(entries[0]?.scorePick).toBeNull();
    expect(entries[0]?.scoreGrade).toBe('NO-PICK');
  });
});

describe('score grading + missed rows', () => {
  test('gradeFinished sets scoreGrade on a pending score pick', () => {
    const entry: LedgerEntry = { ...pending, scorePick: '2-0', scoreGrade: 'PENDING' };
    const results = new Map<string, FinalResult>([
      ['1', { status: 'FINISHED', homeGoals90: 2, awayGoals90: 0 }],
    ]);
    const [graded] = gradeFinished([entry], results);
    expect(graded?.grade).toBe('WIN');
    expect(graded?.scoreGrade).toBe('WIN');
  });

  test('buildMissedEntries sets score fields to null / NO-PICK', () => {
    const missed = { ...match({ status: 'FINISHED', homeGoals90: 1, awayGoals90: 1 }), utcDate: '2026-06-13T16:00:00Z' };
    const rows = buildMissedEntries([missed], new Set(), new Date('2026-06-12T21:30:00Z'));
    expect(rows[0]?.scorePick).toBeNull();
    expect(rows[0]?.scoreGrade).toBe('NO-PICK');
  });
});

describe('buildOddsLookup', () => {
  test('matches case-insensitively, misses return undefined (degrade, never wrong odds)', () => {
    const lookup = buildOddsLookup([
      { home: 'Germany', away: 'Scotland', homeOdds: 1.5, drawOdds: 4, awayOdds: 7 },
    ]);
    expect(lookup.find('GERMANY', 'scotland')).toBeDefined();
    expect(lookup.find('Germany', 'Wales')).toBeUndefined();
  });

  test('REGRESSION: cross-API team aliases resolve (USA ↔ United States etc.)', () => {
    // Live bug 2026-06-12: odds API "USA" never matched football-data
    // "United States" — market column dead on every card.
    const lookup = buildOddsLookup([
      { home: 'USA', away: 'Paraguay', homeOdds: 2.1, drawOdds: 3.2, awayOdds: 3.8 },
      { home: 'Bosnia and Herzegovina', away: 'Czech Republic', homeOdds: 2.5, drawOdds: 3, awayOdds: 3 },
    ]);
    expect(lookup.find('United States', 'Paraguay')).toBeDefined();
    expect(lookup.find('Bosnia-Herzegovina', 'Czechia')).toBeDefined();
  });
});

describe('mergeEntries', () => {
  test('appends only new matchIds — existing rows never replaced', () => {
    const fresh: LedgerEntry = { ...pending, matchId: '2' };
    const dupe: LedgerEntry = { ...pending, pick: 'AWAY' };
    const merged = mergeEntries([pending], [dupe, fresh]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.pick).toBe('HOME'); // original row untouched
  });
});
