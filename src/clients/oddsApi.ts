import { z } from 'zod';

/**
 * The Odds API client — WC2026 h2h (1X2) market, free tier (500 req/mo).
 * Missing odds for a match are a degraded state, not an error: the market
 * column shows "—" and the low-edge label is suppressed (doc rule).
 */
const BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'soccer_fifa_world_cup';

const outcomeSchema = z.object({ name: z.string(), price: z.number() });
const eventSchema = z.object({
  home_team: z.string(),
  away_team: z.string(),
  commence_time: z.string(),
  bookmakers: z.array(
    z.object({
      markets: z.array(
        z.object({ key: z.string(), outcomes: z.array(outcomeSchema) }),
      ),
    }),
  ),
});

export interface MatchOdds {
  readonly home: string;
  readonly away: string;
  readonly homeOdds: number;
  readonly drawOdds: number;
  readonly awayOdds: number;
}

export interface OddsFetchResult {
  readonly odds: readonly MatchOdds[];
  readonly skipped: readonly { raw: unknown; reason: string }[];
}

function toMatchOdds(raw: unknown): MatchOdds | { error: string } {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  const e = parsed.data;
  const market = e.bookmakers[0]?.markets.find((m) => m.key === 'h2h');
  if (!market) return { error: `no h2h market for ${e.home_team} vs ${e.away_team}` };
  const price = (name: string) => market.outcomes.find((o) => o.name === name)?.price;
  const homeOdds = price(e.home_team);
  const awayOdds = price(e.away_team);
  const drawOdds = price('Draw');
  if (homeOdds === undefined || awayOdds === undefined || drawOdds === undefined) {
    return { error: `incomplete h2h outcomes for ${e.home_team} vs ${e.away_team}` };
  }
  return { home: e.home_team, away: e.away_team, homeOdds, drawOdds, awayOdds };
}

export function parseOddsResponse(body: unknown): OddsFetchResult {
  const envelope = z.array(z.unknown()).safeParse(body);
  if (!envelope.success) {
    throw new Error(`odds API response shape unexpected: ${envelope.error.message}`);
  }
  const odds: MatchOdds[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];
  for (const raw of envelope.data) {
    const result = toMatchOdds(raw);
    if ('error' in result) skipped.push({ raw, reason: result.error });
    else odds.push(result);
  }
  return { odds, skipped };
}

export async function fetchWcOdds(apiKey: string): Promise<OddsFetchResult> {
  const url = `${BASE}/sports/${SPORT_KEY}/odds?regions=eu&markets=h2h&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`The Odds API ${res.status}: ${await res.text()}`);
  }
  return parseOddsResponse(await res.json());
}
