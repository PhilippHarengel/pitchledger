import { describe, expect, test } from 'vitest';
import { renderPage, type PageData, type TodayCard } from '../src/build.js';
import type { LedgerEntry } from '../src/ledger.js';

const entry: LedgerEntry = {
  matchId: '1', date: '2026-06-13', kickoffUtc: '2026-06-13T16:00:00Z', home: 'Germany', away: 'Scotland',
  pick: 'HOME', confidence: 0.61, probabilities: { home: 0.61, draw: 0.22, away: 0.17 },
  eloDiff: 212, marketAtPick: 0.66, lowEdge: false, grade: 'PENDING',
  scorePick: '2-1', scoreConfidence: 0.12, scoreMarketAtPick: 0.08, scoreLowEdge: false, scoreGrade: 'PENDING',
  result: null, pickCommit: 'abc1234def', ratingsAsOf: null,
};

const card: TodayCard = { entry, kickoffLocal: '2026-06-13 · 18:00 CEST', marketNow: null };

const base: PageData = {
  todayLabel: '2026-06-13',
  cards: [card],
  ledger: [
    { ...entry, matchId: 'w', grade: 'WIN', result: '2–1' },
    { ...entry, matchId: 'l', grade: 'LOSS', result: '0–0' },
    { ...entry, matchId: 'v', grade: 'VOID', result: 'POSTPONED' },
    { ...entry, matchId: 'n', grade: 'NO-PICK', pick: null, confidence: null },
  ],
  repoUrl: 'https://github.com/x/pitchledger',
  commitSha: 'abc1234def5678',
  generatedAt: '2026-06-13T08:00:00Z',
  ratingsAsOf: '2026-06-13',
};

describe('renderPage', () => {
  const html = renderPage(base);

  test('record strip counts only graded picks (1 win of 2 graded = 50%)', () => {
    expect(html).toContain('2 graded · 1 hits · 50%');
  });

  test('pick card shows matchup, pick, confidence and 3-way chips', () => {
    expect(html).toContain('Germany <span class="vs">vs</span> Scotland');
    expect(html).toContain('PICK: Germany win');
    expect(html).toContain('61%<small> model confidence</small>');
    expect(html).toContain('1 <b>61%</b> · X <b>22%</b> · 2 <b>17%</b>');
    expect(html).toContain('Elo gap <b>+212</b>');
  });

  test('ledger renders all grade states and commit proof links', () => {
    for (const grade of ['WIN', 'LOSS', 'VOID', 'NO-PICK']) expect(html).toContain(`>${grade}<`);
    expect(html).toContain('/commit/abc1234def');
  });

  test('grading convention and 18+ footer are present', () => {
    expect(html).toContain('90 minutes + injury time');
    expect(html).toContain('18+ only');
    expect(html).toContain('takes no bets');
  });

  test('commit SHA embedded for the freshness check', () => {
    expect(html).toContain('data-commit="abc1234def5678"');
  });

  test('low-edge label renders only when frozen flag is true', () => {
    expect(html).not.toContain('low edge — consider skip');
    const flagged = renderPage({ ...base, cards: [{ ...card, entry: { ...entry, lowEdge: true } }] });
    expect(flagged).toContain('low edge — consider skip');
  });

  test('missing market shows a dash chip, never a fake number', () => {
    const noMarket = renderPage({ ...base, cards: [{ ...card, entry: { ...entry, marketAtPick: null } }] });
    expect(noMarket).toContain('market —');
  });

  test('market-now chip appears with timestamp after snapshot', () => {
    const withNow = renderPage({
      ...base,
      cards: [{ ...card, marketNow: { probability: 0.64, asOf: '11:00' } }],
    });
    expect(withNow).toContain('market now <b>64%</b>');
    expect(withNow).toContain('as of 11:00');
  });

  test('rest day shows next-matches note instead of cards', () => {
    const rest = renderPage({ ...base, cards: [], todayLabel: '2026-06-15' });
    expect(rest).toContain('No matches today. Next picks: 2026-06-15');
  });

  test('empty ledger shows "no graded picks yet" (pre-launch state, no div0)', () => {
    const empty = renderPage({ ...base, ledger: [] });
    expect(empty).toContain('no graded picks yet');
  });

  test('stale ratings note renders when grading lagged (D3)', () => {
    const stale = renderPage({
      ...base,
      cards: [{ ...card, entry: { ...entry, ratingsAsOf: '2026-06-12' } }],
    });
    expect(stale).toContain('ratings as of 2026-06-12');
  });

  test('team names are HTML-escaped', () => {
    const xss = renderPage({
      ...base,
      cards: [{ ...card, entry: { ...entry, home: '<script>alert(1)</script>' } }],
    });
    expect(xss).not.toContain('<script>alert(1)');
    expect(xss).toContain('&lt;script&gt;');
  });

  test('renders the score pick on the card, score chip, and ledger Score columns', () => {
    expect(html).toContain('Score: <b>2-1</b>');
    expect(html).toContain('score market <b>8%</b> at pick');
    expect(html).toContain('<th>Score</th>');
    expect(html).toContain('<th>Score grade</th>');
  });

  test('second track-record line reflects scoreLedgerStats', () => {
    const withScores = renderPage({
      ...base,
      ledger: [
        { ...entry, matchId: 's1', scoreGrade: 'WIN' },
        { ...entry, matchId: 's2', scoreGrade: 'LOSS' },
        { ...entry, matchId: 's3', scoreGrade: 'WIN' },
        { ...entry, matchId: 's4', scoreGrade: 'PENDING' },
      ],
    });
    expect(withScores).toContain('Correct score: 3 graded · 2 hits · 67%');
  });

  test('missing score odds shows a dash chip, never a fake number', () => {
    const noScoreMarket = renderPage({
      ...base,
      cards: [{ ...card, entry: { ...entry, scoreMarketAtPick: null } }],
    });
    expect(noScoreMarket).toContain('score market —');
  });
});
