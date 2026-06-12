import { z } from 'zod';

/**
 * football-data.org v4 client — World Cup (competition code WC), free tier.
 * Per-match isolation (D7): each match object is validated independently;
 * a malformed match is logged and skipped — it degrades that match only,
 * never the run.
 */
const BASE = 'https://api.football-data.org/v4';

const scoreSchema = z.object({
  home: z.number().int().nullable(),
  away: z.number().int().nullable(),
});

const matchSchema = z.object({
  id: z.number(),
  utcDate: z.string(),
  status: z.enum([
    'SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED',
    'SUSPENDED', 'POSTPONED', 'CANCELLED', 'AWARDED',
  ]),
  homeTeam: z.object({ name: z.string().nullable() }),
  awayTeam: z.object({ name: z.string().nullable() }),
  score: z.object({
    fullTime: scoreSchema,
    // regularTime present for matches that went to extra time; this is the
    // 90-minute result the grading convention uses.
    regularTime: scoreSchema.optional().nullable(),
    extraTime: scoreSchema.optional().nullable(),
  }),
});

export interface WcMatch {
  readonly id: string;
  readonly utcDate: string;
  readonly status: z.infer<typeof matchSchema>['status'];
  readonly home: string;
  readonly away: string;
  readonly homeGoals90: number | null;
  readonly awayGoals90: number | null;
}

export interface MatchFetchResult {
  readonly matches: readonly WcMatch[];
  readonly skipped: readonly { raw: unknown; reason: string }[];
}

function toWcMatch(raw: unknown): WcMatch | { error: string } {
  const parsed = matchSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  const m = parsed.data;
  if (m.homeTeam.name === null || m.awayTeam.name === null) {
    return { error: 'team name missing (placeholder fixture)' };
  }
  // 90-minute result: when extra time was played, fullTime includes ET —
  // regularTime carries the 90' score. Otherwise fullTime IS the 90' score.
  const ninety = m.score.regularTime ?? m.score.fullTime;
  return {
    id: String(m.id),
    utcDate: m.utcDate,
    status: m.status,
    home: m.homeTeam.name,
    away: m.awayTeam.name,
    homeGoals90: ninety.home,
    awayGoals90: ninety.away,
  };
}

export function parseMatchesResponse(body: unknown): MatchFetchResult {
  const envelope = z.object({ matches: z.array(z.unknown()) }).safeParse(body);
  if (!envelope.success) {
    throw new Error(`football-data response shape unexpected: ${envelope.error.message}`);
  }
  const matches: WcMatch[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];
  for (const raw of envelope.data.matches) {
    const result = toWcMatch(raw);
    if ('error' in result) skipped.push({ raw, reason: result.error });
    else matches.push(result);
  }
  return { matches, skipped };
}

export async function fetchWcMatches(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
): Promise<MatchFetchResult> {
  const url = `${BASE}/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });
  if (!res.ok) {
    throw new Error(`football-data.org ${res.status}: ${await res.text()}`);
  }
  return parseMatchesResponse(await res.json());
}
