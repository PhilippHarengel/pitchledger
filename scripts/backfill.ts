import { PATHS, LAUNCH_DATE } from '../src/config.js';
import { readJson, readJsonOr, writeJson } from '../src/io.js';
import type { EloRatings } from '../src/elo.js';
import { foldResults } from '../src/pipeline.js';
import { fetchWcMatches } from '../src/clients/footballData.js';

/**
 * One-time launch step (eng review D14): fold all WC2026 results played
 * BEFORE the launch date into elo.json. The ledger stays empty for those
 * matches — it only testifies about matches the product could have picked.
 *
 * Usage: FOOTBALL_DATA_KEY=... npm run backfill
 */
const apiKey = process.env['FOOTBALL_DATA_KEY'];
if (!apiKey) {
  console.error('Missing FOOTBALL_DATA_KEY');
  process.exit(1);
}

const TOURNAMENT_START = '2026-06-11';
const fetched = await fetchWcMatches(apiKey, TOURNAMENT_START, LAUNCH_DATE);
for (const s of fetched.skipped) console.warn(`[backfill] skipped: ${s.reason}`);

const elo = readJson<EloRatings>(PATHS.ELO);
const foldLog = readJsonOr<string[]>(PATHS.ELO_FOLD_LOG, []);
const folded = foldResults(elo, foldLog, fetched.matches, LAUNCH_DATE);
writeJson(PATHS.ELO, folded.elo);
writeJson(PATHS.ELO_FOLD_LOG, folded.foldLog);
console.log(
  `[backfill] folded ${folded.foldLog.length - foldLog.length} pre-launch results into ${PATHS.ELO} (idempotent — safe to re-run)`,
);
