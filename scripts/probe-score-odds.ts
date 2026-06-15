/**
 * Phase-0 feasibility probe (issue #2). Does The Odds API serve a correct-score
 * market for soccer_fifa_world_cup on the current plan, and in what shape?
 *
 * Run by a human with a live key and at least one in-window event:
 *   ODDS_API_KEY=... npm run probe:score-odds
 *
 * It prints, for each call: HTTP status, whether a `correct_score` market came
 * back, the exact outcome `name` format (e.g. "2 - 1" vs "2-1"), and the
 * x-requests-remaining / x-requests-used quota cost. Record the decision in the
 * issue BEFORE building further:
 *   - market present → full edge layer (already wired, no-ops without odds)
 *   - market absent  → ship model-only; the score-edge column stays "—"
 *
 * This script is intentionally NOT run by CI or the spec build — it spends live
 * API quota and needs a real event id.
 */
const BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'soccer_fifa_world_cup';

const apiKey = process.env['ODDS_API_KEY'];
if (!apiKey) {
  console.error('Missing ODDS_API_KEY — this probe needs a live key.');
  process.exit(1);
}

interface OutcomeShape {
  readonly name?: unknown;
  readonly price?: unknown;
}
interface MarketShape {
  readonly key?: unknown;
  readonly outcomes?: readonly OutcomeShape[];
}
interface BookmakerShape {
  readonly markets?: readonly MarketShape[];
}
interface EventShape {
  readonly id?: unknown;
  readonly home_team?: unknown;
  readonly away_team?: unknown;
  readonly bookmakers?: readonly BookmakerShape[];
}

function quota(res: Response): string {
  const remaining = res.headers.get('x-requests-remaining') ?? '?';
  const used = res.headers.get('x-requests-used') ?? '?';
  return `quota: remaining=${remaining} used=${used}`;
}

function reportCorrectScore(label: string, events: readonly EventShape[]): void {
  let found = false;
  const sampleNames: string[] = [];
  for (const ev of events) {
    for (const bk of ev.bookmakers ?? []) {
      for (const mk of bk.markets ?? []) {
        if (mk.key !== 'correct_score') continue;
        found = true;
        for (const o of mk.outcomes ?? []) {
          if (typeof o.name === 'string' && sampleNames.length < 12) sampleNames.push(o.name);
        }
      }
    }
  }
  console.log(`[${label}] correct_score market present: ${found}`);
  if (found) console.log(`[${label}] sample outcome names: ${JSON.stringify(sampleNames)}`);
}

// 1) Bulk endpoint.
const bulkUrl = `${BASE}/sports/${SPORT_KEY}/odds?regions=eu&markets=correct_score&apiKey=${apiKey}`;
const bulkRes = await fetch(bulkUrl);
console.log(`[bulk] GET .../odds?markets=correct_score → HTTP ${bulkRes.status} · ${quota(bulkRes)}`);
let firstEventId: string | null = null;
if (bulkRes.ok) {
  const events = (await bulkRes.json()) as EventShape[];
  console.log(`[bulk] events returned: ${events.length}`);
  reportCorrectScore('bulk', events);
  const withId = events.find((e) => typeof e.id === 'string');
  firstEventId = withId && typeof withId.id === 'string' ? withId.id : null;
} else {
  console.log(`[bulk] body: ${await bulkRes.text()}`);
}

// 2) Per-event endpoint (correct_score is often an "additional market" only
//    available per event). Needs an event id — reuse one from the bulk call,
//    or fetch the events list if the bulk markets call returned none.
if (!firstEventId) {
  const eventsRes = await fetch(`${BASE}/sports/${SPORT_KEY}/events?apiKey=${apiKey}`);
  console.log(`[events] GET .../events → HTTP ${eventsRes.status} · ${quota(eventsRes)}`);
  if (eventsRes.ok) {
    const list = (await eventsRes.json()) as EventShape[];
    const withId = list.find((e) => typeof e.id === 'string');
    firstEventId = withId && typeof withId.id === 'string' ? withId.id : null;
  }
}

if (!firstEventId) {
  console.log('[per-event] no live event id available — skipping per-event probe.');
} else {
  const evUrl = `${BASE}/sports/${SPORT_KEY}/events/${firstEventId}/odds?regions=eu&markets=correct_score&apiKey=${apiKey}`;
  const evRes = await fetch(evUrl);
  console.log(`[per-event] GET .../events/${firstEventId}/odds?markets=correct_score → HTTP ${evRes.status} · ${quota(evRes)}`);
  if (evRes.ok) {
    const event = (await evRes.json()) as EventShape;
    reportCorrectScore('per-event', [event]);
  } else {
    console.log(`[per-event] body: ${await evRes.text()}`);
  }
}

console.log('\nDecision gate: record "odds available" (build full market) or "odds absent" (model-only) in issue #2.');
