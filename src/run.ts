import { execSync } from 'node:child_process';
import { LAUNCH_AT, PATHS } from './config.js';
import type { EloRatings } from './elo.js';
import type { LedgerEntry } from './ledger.js';
import { readJson, readJsonOr, writeJson, writeText } from './io.js';
import { fetchWcMatches, type WcMatch } from './clients/footballData.js';
import { fetchWcOdds } from './clients/oddsApi.js';
import { devig } from './devig.js';
import {
  buildMissedEntries, buildOddsLookup, buildTodayEntries, foldResults, gradeFinished, mergeEntries, pipelineDay,
} from './pipeline.js';
import { renderPage, type TodayCard } from './build.js';
import type { FinalResult } from './grade.js';

/**
 * CLI: run.ts daily | snapshot | build-only
 *   daily     — grade yesterday → update Elo → pick today → rebuild site
 *   snapshot  — refresh "market now" display only
 *   build-only — rebuild site from committed data (local dev)
 */
const REPO_URL = process.env['REPO_URL'] ?? 'https://github.com/OWNER/pitchledger';

function commitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

interface Snapshot {
  readonly asOf: string;
  readonly markets: Readonly<Record<string, number>>; // matchId → market prob of picked outcome
}

function rebuild(day: string, todayLabel: string): void {
  const ledger = readJsonOr<LedgerEntry[]>(PATHS.LEDGER, []);
  const elo = readJson<EloRatings>(PATHS.ELO);
  const snapshot = readJsonOr<Snapshot | null>(PATHS.SNAPSHOT, null);
  const cetTime = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
  });
  const cards: TodayCard[] = ledger
    .filter((e) => e.date === day)
    .map((e) => ({
      entry: e,
      kickoffLocal: e.kickoffUtc
        ? `${cetTime.format(new Date(e.kickoffUtc))} CEST · ${e.date} (ET match day)`
        : e.date,
      marketNow:
        snapshot && snapshot.markets[e.matchId] !== undefined
          ? { probability: snapshot.markets[e.matchId] as number, asOf: snapshot.asOf }
          : null,
    }));
  const html = renderPage({
    todayLabel,
    cards,
    ledger: [...ledger].reverse(),
    repoUrl: REPO_URL,
    commitSha: commitSha(),
    generatedAt: new Date().toISOString(),
    ratingsAsOf: elo.asOf,
  });
  writeText(PATHS.SITE, html);
}

async function daily(): Promise<void> {
  const apiKey = requireEnv('FOOTBALL_DATA_KEY');
  const oddsKey = process.env['ODDS_API_KEY'] ?? null;
  const now = new Date();
  const day = pipelineDay(now);

  // Window: 3 days back (grading stragglers) to day+2 ahead — the API's
  // date filter is UTC, but late-ET kickoffs land on the NEXT UTC date
  // (21:00 ET = 01:00Z tomorrow), so dateTo must overshoot the ET day.
  const from = pipelineDay(new Date(now.getTime() - 3 * 86400_000));
  const to = new Date(now.getTime() + 2 * 86400_000).toISOString().slice(0, 10);
  const fetched = await fetchWcMatches(apiKey, from, to);
  for (const s of fetched.skipped) console.warn(`[daily] skipped match: ${s.reason}`);
  const matchesById = new Map(fetched.matches.map((m) => [m.id, m]));

  // 1) Grade + insert NO-PICK rows for missed post-launch matches.
  const ledgerBefore = readJsonOr<LedgerEntry[]>(PATHS.LEDGER, []);
  const results = new Map<string, FinalResult>(
    fetched.matches.map((m) => [
      m.id,
      {
        status: m.status === 'CANCELLED' ? 'ABANDONED' : m.status === 'POSTPONED' ? 'POSTPONED' : m.status === 'FINISHED' ? 'FINISHED' : 'SCHEDULED',
        homeGoals90: m.homeGoals90,
        awayGoals90: m.awayGoals90,
      } satisfies FinalResult,
    ]),
  );
  const missed = buildMissedEntries(
    fetched.matches,
    new Set(ledgerBefore.map((e) => e.matchId)),
    new Date(LAUNCH_AT),
  );
  const graded = [...gradeFinished(ledgerBefore, results), ...missed];

  // 2) Elo update — idempotent fold-log, sequential by construction (D9).
  let elo = readJson<EloRatings>(PATHS.ELO);
  let ratingsStale = false;
  try {
    const foldLog = readJsonOr<string[]>(PATHS.ELO_FOLD_LOG, []);
    const folded = foldResults(elo, foldLog, fetched.matches, day);
    elo = folded.elo;
    writeJson(PATHS.ELO, elo);
    writeJson(PATHS.ELO_FOLD_LOG, folded.foldLog);
  } catch (err) {
    // Degrade gracefully (D3): pick with previous ratings, note staleness.
    console.error(`[daily] elo update failed, picking with ratings as of ${elo.asOf}:`, err);
    ratingsStale = true;
  }

  // 3) Picks for today.
  let oddsLookup = buildOddsLookup([]);
  if (oddsKey) {
    try {
      const odds = await fetchWcOdds(oddsKey);
      for (const s of odds.skipped) console.warn(`[daily] skipped odds: ${s.reason}`);
      oddsLookup = buildOddsLookup([...odds.odds]);
    } catch (err) {
      console.error('[daily] odds fetch failed — picks publish without market column:', err);
    }
  }
  const fresh = buildTodayEntries(fetched.matches, elo, oddsLookup, day, ratingsStale, now);
  const ledgerAfter = mergeEntries(graded, fresh);
  writeJson(PATHS.LEDGER, ledgerAfter);
  writeJson(`${PATHS.PICKS_DIR}/${day}.json`, fresh);

  // 4) Site.
  rebuild(day, day);
  console.log(`[daily] ${fresh.length} picks for ${day}; ledger ${ledgerAfter.length} rows`);
}

async function snapshot(): Promise<void> {
  const oddsKey = requireEnv('ODDS_API_KEY');
  const day = pipelineDay(new Date());
  const ledger = readJsonOr<LedgerEntry[]>(PATHS.LEDGER, []);
  const todays = ledger.filter((e) => e.date === day && e.pick !== null);
  if (todays.length === 0) {
    console.log('[snapshot] no picks today, nothing to refresh');
    return;
  }
  const odds = await fetchWcOdds(oddsKey);
  const lookup = buildOddsLookup([...odds.odds]);
  const markets: Record<string, number> = {};
  for (const e of todays) {
    const o = lookup.find(e.home, e.away);
    if (!o || e.pick === null) continue;
    const m = devig(o.homeOdds, o.drawOdds, o.awayOdds);
    markets[e.matchId] = e.pick === 'HOME' ? m.home : e.pick === 'AWAY' ? m.away : m.draw;
  }
  writeJson(PATHS.SNAPSHOT, {
    asOf: new Date().toISOString().slice(11, 16),
    markets,
  } satisfies Snapshot);
  rebuild(day, day);
  console.log(`[snapshot] refreshed market-now for ${Object.keys(markets).length} matches`);
}

const command = process.argv[2];
const handlers: Record<string, () => Promise<void> | void> = {
  daily,
  snapshot,
  'build-only': () => {
    const day = pipelineDay(new Date());
    rebuild(day, day);
  },
};

const handler = command !== undefined ? handlers[command] : undefined;
if (!handler) {
  console.error('Usage: run.ts daily | snapshot | build-only');
  process.exit(1);
}
await handler();
