import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMissedEntries, foldResults, gradeFinished } from '../src/pipeline.js';
import { gradeEntry } from '../src/grade.js';
import { readJson, readJsonOr, writeJson, writeText } from '../src/io.js';
import { fetchWcMatches } from '../src/clients/footballData.js';
import { fetchWcOdds } from '../src/clients/oddsApi.js';
import type { EloRatings } from '../src/elo.js';
import type { LedgerEntry } from '../src/ledger.js';
import type { WcMatch } from '../src/clients/footballData.js';
import type { FinalResult } from '../src/grade.js';

const elo: EloRatings = { asOf: '2026-06-12', ratings: { Germany: 2000, Scotland: 1800 } };

const pending: LedgerEntry = {
  matchId: '1', date: '2026-06-13', kickoffUtc: '2026-06-13T16:00:00Z', home: 'Germany', away: 'Scotland',
  pick: 'HOME', confidence: 0.6, probabilities: { home: 0.6, draw: 0.22, away: 0.18 },
  eloDiff: 200, marketAtPick: null, lowEdge: false, grade: 'PENDING',
  result: null, pickCommit: null, ratingsAsOf: null,
};

const finishedMatch: WcMatch = {
  id: '1', utcDate: '2026-06-13T16:00:00Z', status: 'FINISHED',
  home: 'Germany', away: 'Scotland', homeGoals90: 2, awayGoals90: 0,
};

describe('foldResults', () => {
  test('folds a finished match once and records it in the fold log', () => {
    const out = foldResults(elo, [], [finishedMatch], '2026-06-14');
    expect(out.elo.ratings['Germany']).toBeGreaterThan(2000);
    expect(out.foldLog).toEqual(['1']);
  });

  test('REGRESSION: a match already in the fold log is never folded twice', () => {
    // Live risk 2026-06-12: Canada–Bosnia was backfilled into Elo AND was
    // gradeable via the ledger — transition-based folding double-counts.
    const once = foldResults(elo, [], [finishedMatch], '2026-06-14');
    const twice = foldResults(once.elo, once.foldLog, [finishedMatch], '2026-06-15');
    expect(twice.elo).toBe(once.elo);
    expect(twice.foldLog).toBe(once.foldLog);
  });

  test('unfinished and postponed matches do not move ratings', () => {
    const timed = { ...finishedMatch, status: 'TIMED' as const, homeGoals90: null, awayGoals90: null };
    const out = foldResults(elo, [], [timed], '2026-06-14');
    expect(out.elo).toBe(elo);
  });
});

describe('buildMissedEntries', () => {
  const launchAt = new Date('2026-06-12T21:30:00Z');

  test('finished post-launch match without a ledger row gets a graded NO-PICK row', () => {
    const missed = { ...finishedMatch, utcDate: '2026-06-13T16:00:00Z' };
    const rows = buildMissedEntries([missed], new Set(), launchAt);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.grade).toBe('NO-PICK');
    expect(rows[0]?.result).toBe('2–0');
  });

  test('pre-launch kickoffs stay out of the ledger (backfill territory, D14)', () => {
    const preLaunch = { ...finishedMatch, utcDate: '2026-06-12T19:00:00Z' };
    expect(buildMissedEntries([preLaunch], new Set(), launchAt)).toHaveLength(0);
  });

  test('matches already in the ledger are not duplicated', () => {
    const missed = { ...finishedMatch, utcDate: '2026-06-13T16:00:00Z' };
    expect(buildMissedEntries([missed], new Set(['1']), launchAt)).toHaveLength(0);
  });

  test('future scheduled matches produce no rows', () => {
    const future = { ...finishedMatch, status: 'TIMED' as const, utcDate: '2026-06-14T16:00:00Z', homeGoals90: null, awayGoals90: null };
    expect(buildMissedEntries([future], new Set(), launchAt)).toHaveLength(0);
  });
});

describe('gradeEntry result text', () => {
  test('VOID entries carry the status as result text', () => {
    const voided = gradeEntry(pending, { status: 'POSTPONED', homeGoals90: null, awayGoals90: null });
    expect(voided.grade).toBe('VOID');
    expect(voided.result).toBe('POSTPONED');
  });

  test('unfinished entries keep null result text', () => {
    const still = gradeEntry(pending, { status: 'SCHEDULED', homeGoals90: null, awayGoals90: null });
    expect(still.result).toBeNull();
  });
});

describe('io', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pl-'));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('writeJson/readJson roundtrip, creates nested dirs', () => {
    const path = join(dir, 'nested/deep/file.json');
    writeJson(path, { a: 1 });
    expect(readJson<{ a: number }>(path)).toEqual({ a: 1 });
  });

  test('readJsonOr falls back when file is missing', () => {
    expect(readJsonOr(join(dir, 'missing.json'), [])).toEqual([]);
  });

  test('writeText writes literal content into nested dirs', () => {
    const path = join(dir, 'page/index.html');
    writeText(path, '<html></html>');
    expect(readFileSync(path, 'utf8')).toBe('<html></html>');
  });
});

describe('client fetch wrappers (mocked network)', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('fetchWcMatches: ok response parses, auth header sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ matches: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWcMatches('key123', '2026-06-12', '2026-06-13');
    expect(r.matches).toEqual([]);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Auth-Token']).toBe('key123');
  });

  test('fetchWcMatches: non-ok response throws with status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    await expect(fetchWcMatches('k', 'a', 'b')).rejects.toThrow(/429/);
  });

  test('fetchWcOdds: ok response parses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    const r = await fetchWcOdds('k');
    expect(r.odds).toEqual([]);
  });

  test('fetchWcOdds: non-ok response throws with status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota', { status: 401 })));
    await expect(fetchWcOdds('k')).rejects.toThrow(/401/);
  });
});
