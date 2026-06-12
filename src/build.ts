import type { LedgerEntry } from './ledger.js';
import { ledgerStats } from './ledger.js';

/**
 * Static page renderer. One self-contained HTML file, zero runtime JS.
 * Visual direction: sports-data editorial — paper surface, ink text, one
 * pitch-green accent, numbers as heroes (tabular numerals, big confidence).
 *
 * Page order IS the product thesis: track record before any pick.
 */
export interface TodayCard {
  readonly entry: LedgerEntry;
  readonly kickoffLocal: string;
  /** "market now" refresh from snapshot run; null until snapshot ran. */
  readonly marketNow: { readonly probability: number; readonly asOf: string } | null;
}

export interface PageData {
  readonly todayLabel: string;
  readonly cards: readonly TodayCard[];
  readonly ledger: readonly LedgerEntry[];
  readonly repoUrl: string;
  readonly commitSha: string;
  readonly generatedAt: string;
  readonly ratingsAsOf: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pct = (p: number): string => `${Math.round(p * 100)}%`;

function pickLabel(e: LedgerEntry): string {
  if (e.pick === 'HOME') return `${e.home} win`;
  if (e.pick === 'AWAY') return `${e.away} win`;
  if (e.pick === 'DRAW') return 'Draw';
  return '—';
}

function chips(card: TodayCard): string {
  const e = card.entry;
  if (!e.probabilities) return '';
  const p = e.probabilities;
  const market =
    e.marketAtPick !== null
      ? `<span class="chip">market <b>${pct(e.marketAtPick)}</b> at pick</span>`
      : `<span class="chip chip-muted">market —</span>`;
  const marketNow =
    card.marketNow !== null
      ? `<span class="chip chip-moved">market now <b>${pct(card.marketNow.probability)}</b> <small>as of ${esc(card.marketNow.asOf)}</small></span>`
      : '';
  return `
    <div class="factors">
      <span class="chip">1 <b>${pct(p.home)}</b> · X <b>${pct(p.draw)}</b> · 2 <b>${pct(p.away)}</b></span>
      <span class="chip">Elo gap <b>${e.eloDiff === null ? '—' : (e.eloDiff >= 0 ? '+' : '') + Math.round(e.eloDiff)}</b></span>
      ${market}
      ${marketNow}
    </div>`;
}

function card(c: TodayCard): string {
  const e = c.entry;
  const lowEdge = e.lowEdge === true ? `<div class="low-edge">low edge — consider skip</div>` : '';
  const stale =
    e.ratingsAsOf !== null ? `<div class="stale-note">ratings as of ${esc(e.ratingsAsOf)}</div>` : '';
  return `
  <article class="pick-card">
    <div>
      <h3 class="matchup">${esc(e.home)} <span class="vs">vs</span> ${esc(e.away)}</h3>
      <div class="kickoff">${esc(c.kickoffLocal)}</div>
    </div>
    <div class="reco">
      <div class="outcome">PICK: ${esc(pickLabel(e))}</div>
      <div class="conf">${e.confidence === null ? '—' : pct(e.confidence)}<small> model confidence</small></div>
      ${lowEdge}
    </div>
    ${chips(c)}
    ${stale}
  </article>`;
}

function ledgerRow(e: LedgerEntry, repoUrl: string): string {
  const proof =
    e.pickCommit !== null
      ? `<a href="${esc(repoUrl)}/commit/${esc(e.pickCommit)}">${esc(e.pickCommit.slice(0, 7))}</a>`
      : '—';
  return `
    <tr>
      <td>${esc(e.date)}</td>
      <td>${esc(e.home)} – ${esc(e.away)}</td>
      <td>${esc(pickLabel(e))}</td>
      <td class="num">${e.confidence === null ? '—' : pct(e.confidence)}</td>
      <td class="num">${e.result === null ? '—' : esc(e.result)}</td>
      <td class="grade grade-${e.grade.toLowerCase().replace(/[^a-z]/g, '')}">${e.grade}</td>
      <td class="proof">${proof}</td>
    </tr>`;
}

export function renderPage(data: PageData): string {
  const stats = ledgerStats(data.ledger);
  const record =
    stats.hitRate === null
      ? 'no graded picks yet'
      : `${stats.graded} graded · ${stats.wins} hits · ${pct(stats.hitRate)}`;
  const dots = stats.dots
    .map((d) => `<span class="dot ${d === 'W' ? 'dot-w' : 'dot-l'}"></span>`)
    .join('');
  const cards =
    data.cards.length > 0
      ? data.cards.map(card).join('\n')
      : `<p class="rest-day">No matches today. Next picks: ${esc(data.todayLabel)}.</p>`;
  const rows = data.ledger.map((e) => ledgerRow(e, data.repoUrl)).join('\n');

  return `<!DOCTYPE html>
<html lang="en" data-commit="${esc(data.commitSha)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PitchLedger — WC26 model picks, publicly graded</title>
<meta property="og:title" content="PitchLedger — WC26 picks, publicly graded">
<meta property="og:description" content="Track record: ${esc(record)}. Every pick committed before kickoff, graded after.">
<style>
  :root {
    --paper: oklch(98% 0.005 95);
    --ink: oklch(22% 0.01 95);
    --muted: oklch(50% 0.01 95);
    --line: oklch(88% 0.005 95);
    --accent: oklch(55% 0.15 150);
    --loss: oklch(50% 0.19 25);
    --text-base: clamp(1rem, 0.95rem + 0.3vw, 1.1rem);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; max-width: 960px; padding: 0 20px 56px;
    background: var(--paper); color: var(--ink);
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: var(--text-base); line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }
  header {
    display: flex; flex-wrap: wrap; gap: 12px;
    justify-content: space-between; align-items: baseline;
    border-bottom: 3px solid var(--ink); padding: 28px 0 14px;
  }
  .wordmark { font-weight: 800; font-size: 1.45rem; letter-spacing: -0.5px; }
  .wordmark em { font-style: normal; color: var(--accent); }
  .tagline { color: var(--muted); font-size: 0.85rem; }
  .record { text-align: right; font-size: 0.9rem; color: var(--muted); }
  .record b { color: var(--ink); font-size: 1.05rem; }
  .dots { margin-top: 4px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 3px; }
  .dot-w { background: var(--accent); }
  .dot-l { background: transparent; border: 2px solid var(--loss); width: 6px; height: 6px; }
  h2 {
    font-size: 0.8rem; text-transform: uppercase; letter-spacing: 2px;
    color: var(--muted); margin: 44px 0 14px;
  }
  .pick-card {
    border: 1px solid var(--line); border-left: 4px solid var(--accent);
    background: #fff; padding: 18px 22px; margin-bottom: 14px;
    display: grid; grid-template-columns: 1fr auto; gap: 6px 24px;
  }
  .matchup { font-size: 1.25rem; font-weight: 700; margin: 0; }
  .vs { color: var(--muted); font-weight: 400; font-size: 0.95rem; }
  .kickoff { font-size: 0.8rem; color: var(--muted); }
  .reco { text-align: right; }
  .outcome { font-weight: 600; font-size: 0.95rem; }
  .conf { font-size: 2.1rem; font-weight: 800; line-height: 1.05; }
  .conf small { font-size: 0.7rem; font-weight: 400; color: var(--muted); }
  .low-edge {
    display: inline-block; margin-top: 4px; padding: 2px 8px;
    border: 1px solid var(--loss); color: var(--loss);
    font-size: 0.72rem; border-radius: 3px;
  }
  .factors { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
  .chip {
    border: 1px solid var(--line); border-radius: 999px;
    font-size: 0.74rem; padding: 3px 11px; color: var(--muted); background: var(--paper);
  }
  .chip b { color: var(--ink); }
  .chip-muted { opacity: 0.6; }
  .chip-moved { border-style: dashed; }
  .stale-note { grid-column: 1 / -1; font-size: 0.72rem; color: var(--muted); }
  .rest-day { color: var(--muted); border: 1px dashed var(--line); padding: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; background: #fff; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); }
  th { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
  td.num { font-variant-numeric: tabular-nums; }
  .grade { font-weight: 700; }
  .grade-win { color: var(--accent); }
  .grade-loss { color: var(--loss); }
  .grade-void, .grade-nopick { color: var(--muted); }
  .proof a { color: var(--muted); }
  .convention { font-size: 0.75rem; color: var(--muted); margin-top: 10px; }
  footer {
    margin-top: 56px; border-top: 1px solid var(--line); padding-top: 16px;
    font-size: 0.72rem; color: var(--muted);
  }
</style>
</head>
<body>
<header>
  <div>
    <div class="wordmark">PITCH<em>LEDGER</em> WC26</div>
    <div class="tagline">Model picks. Publicly graded. Every match.</div>
  </div>
  <div class="record">
    Track record: <b>${esc(record)}</b>
    <div class="dots">${dots}</div>
  </div>
</header>

<main>
<section aria-labelledby="picks-heading">
  <h2 id="picks-heading">Today's Picks — ${esc(data.todayLabel)}</h2>
  ${cards}
</section>

<section aria-labelledby="ledger-heading">
  <h2 id="ledger-heading">Pick Ledger — every match, graded</h2>
  <table>
    <thead>
      <tr><th>Date</th><th>Match</th><th>Pick</th><th>Conf.</th><th>Result</th><th>Grade</th><th>Proof</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="convention">Grading: 90 minutes + injury time (knockout ties level after 90 grade as draw).
  VOID (postponed/abandoned) and NO-PICK rows are shown but excluded from the hit-rate.
  Picks and "low edge" labels are frozen at pick time and never edited — each row links to the
  git commit that published it. Model: Elo + Davidson draw model; methodology in the repo.</p>
</section>
</main>

<footer>
  18+ only. Statistical model outputs, not financial advice. Gambling can be addictive — play
  responsibly: <a href="https://www.bzga.de">bzga.de</a> · <a href="https://www.begambleaware.org">begambleaware.org</a>.
  This site takes no bets and handles no money.
  <br>Ratings as of ${esc(data.ratingsAsOf)} · generated ${esc(data.generatedAt)} · commit ${esc(data.commitSha.slice(0, 7))}
</footer>
</body>
</html>`;
}
