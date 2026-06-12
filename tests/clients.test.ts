import { describe, expect, test } from 'vitest';
import { parseMatchesResponse } from '../src/clients/footballData.js';
import { parseOddsResponse } from '../src/clients/oddsApi.js';

const validMatch = {
  id: 101,
  utcDate: '2026-06-13T16:00:00Z',
  status: 'TIMED',
  homeTeam: { name: 'Germany' },
  awayTeam: { name: 'Scotland' },
  score: { fullTime: { home: null, away: null } },
};

describe('football-data parsing', () => {
  test('valid match parses', () => {
    const r = parseMatchesResponse({ matches: [validMatch] });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]?.home).toBe('Germany');
    expect(r.skipped).toHaveLength(0);
  });

  test('one malformed match degrades that match only (D7 isolation)', () => {
    const malformed = { ...validMatch, id: 'not-a-number' };
    const r = parseMatchesResponse({ matches: [validMatch, malformed] });
    expect(r.matches).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/id/);
  });

  test('placeholder fixture (null team name) is skipped, not crashed', () => {
    const placeholder = { ...validMatch, id: 102, homeTeam: { name: null } };
    const r = parseMatchesResponse({ matches: [placeholder] });
    expect(r.matches).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/placeholder/);
  });

  test('regularTime carries the 90-minute score when extra time was played', () => {
    const etMatch = {
      ...validMatch,
      id: 103,
      status: 'FINISHED',
      score: {
        fullTime: { home: 2, away: 1 }, // includes ET
        regularTime: { home: 1, away: 1 }, // the 90' result grading uses
        extraTime: { home: 1, away: 0 },
      },
    };
    const r = parseMatchesResponse({ matches: [etMatch] });
    expect(r.matches[0]?.homeGoals90).toBe(1);
    expect(r.matches[0]?.awayGoals90).toBe(1);
  });

  test('unexpected envelope shape throws (whole-response failure is loud)', () => {
    expect(() => parseMatchesResponse({ nope: true })).toThrow(/shape unexpected/);
  });
});

const validEvent = {
  home_team: 'Germany',
  away_team: 'Scotland',
  commence_time: '2026-06-13T16:00:00Z',
  bookmakers: [
    {
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Germany', price: 1.45 },
            { name: 'Scotland', price: 7.5 },
            { name: 'Draw', price: 4.6 },
          ],
        },
      ],
    },
  ],
};

describe('odds API parsing', () => {
  test('valid event parses to 1X2 odds', () => {
    const r = parseOddsResponse([validEvent]);
    expect(r.odds[0]).toEqual({
      home: 'Germany', away: 'Scotland', homeOdds: 1.45, drawOdds: 4.6, awayOdds: 7.5,
    });
  });

  test('event without h2h market is skipped, others survive', () => {
    const noMarket = { ...validEvent, home_team: 'Spain', bookmakers: [{ markets: [] }] };
    const r = parseOddsResponse([validEvent, noMarket]);
    expect(r.odds).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/no h2h market/);
  });

  test('incomplete outcomes are skipped', () => {
    const incomplete = {
      ...validEvent,
      bookmakers: [{ markets: [{ key: 'h2h', outcomes: [{ name: 'Germany', price: 1.45 }] }] }],
    };
    const r = parseOddsResponse([incomplete]);
    expect(r.odds).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/incomplete/);
  });

  test('non-array body throws loudly', () => {
    expect(() => parseOddsResponse({ data: [] })).toThrow(/shape unexpected/);
  });
});
