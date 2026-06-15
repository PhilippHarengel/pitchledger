/**
 * Generate backtest/data-2022.json from the open martj42 international-results
 * dataset (https://github.com/martj42/international_results, ODbL).
 *
 *   ratings — Elo as of 2022-11-19 (day before the WC opener), computed with
 *             the project's OWN rule (src/elo.ts: K=60, /400, win/draw/loss),
 *             seeded at 1500 and folded over every international match in
 *             history before the cutoff. Self-sourced — no eloratings.net
 *             license needed, and team names stay identical to the match rows
 *             below (both come from this one file).
 *   matches — the 64 FIFA World Cup 2022 matches, { home, away, homeGoals90,
 *             awayGoals90 }.
 *
 * Caveat: martj42 scores for knockout games decided in extra time reflect the
 * end-of-ET score (penalties excluded), so ~5 of 64 matches are mildly
 * goals-inflated vs a strict 90-minute score. Documented; the SCORE grid search
 * absorbs it.
 *
 * Run: tsx scripts/build-backtest-data.ts  (reads /tmp/intl.csv)
 */
import { readFileSync } from 'node:fs';
import { writeJson } from '../src/io.js';
import { applyResult, type EloRatings } from '../src/elo.js';

const CSV = '/tmp/intl.csv';
const CUTOFF = '2022-11-20'; // fold everything strictly before the opener
const SEED = 1500;

interface Row {
  readonly date: string;
  readonly home: string;
  readonly away: string;
  readonly hs: number;
  readonly as: number;
  readonly tournament: string;
}

function parse(): readonly Row[] {
  const lines = readFileSync(CSV, 'utf8').split('\n');
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // date,home,away,home_score,away_score,tournament,city,country,neutral
    // First six fields are comma-free (team names have no commas); split is safe.
    const f = line.split(',');
    if (f.length < 6) continue;
    const hs = Number(f[3]);
    const as = Number(f[4]);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    rows.push({ date: f[0]!, home: f[1]!, away: f[2]!, hs, as, tournament: f[5]! });
  }
  return rows;
}

const rows = parse();

// 1) Compute ratings from all pre-cutoff history.
const teams = new Set<string>();
for (const r of rows) if (r.date < CUTOFF) { teams.add(r.home); teams.add(r.away); }
let elo: EloRatings = {
  asOf: CUTOFF,
  ratings: Object.fromEntries([...teams].map((t) => [t, SEED])),
};
const history = rows
  .filter((r) => r.date < CUTOFF)
  .sort((a, b) => a.date.localeCompare(b.date));
for (const r of history) {
  elo = applyResult(elo, { home: r.home, away: r.away, homeGoals: r.hs, awayGoals: r.as }, r.date);
}

// 2) The 64 WC-2022 matches.
const wc = rows.filter(
  (r) => r.tournament === 'FIFA World Cup' && (r.date.startsWith('2022-11') || r.date.startsWith('2022-12')),
);
const matches = wc.map((r) => ({ home: r.home, away: r.away, homeGoals90: r.hs, awayGoals90: r.as }));

// 3) Ratings restricted to the 32 teams that actually play (keeps the file tight).
const wcTeams = new Set<string>();
for (const m of matches) { wcTeams.add(m.home); wcTeams.add(m.away); }
const ratings: Record<string, number> = {};
for (const t of [...wcTeams].sort()) {
  const v = elo.ratings[t];
  if (v === undefined) { console.warn(`[gen] no pre-WC rating for ${t}`); continue; }
  ratings[t] = Math.round(v * 10) / 10;
}

writeJson('backtest/data-2022.json', { ratings, matches });
console.log(`[gen] history folded: ${history.length} matches`);
console.log(`[gen] WC2022 matches: ${matches.length}`);
console.log(`[gen] WC teams rated: ${Object.keys(ratings).length}`);
const sorted = Object.entries(ratings).sort((a, b) => b[1] - a[1]);
console.log('[gen] top 5:', sorted.slice(0, 5).map(([t, v]) => `${t} ${v}`).join(' · '));
console.log('[gen] bottom 3:', sorted.slice(-3).map(([t, v]) => `${t} ${v}`).join(' · '));
