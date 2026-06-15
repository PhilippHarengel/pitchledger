/**
 * Proportional de-vig: bookmaker decimal odds → implied probabilities
 * normalized to sum to 1 (the bookmaker margin is removed proportionally).
 */
export interface MarketProbabilities {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
}

export function devig(homeOdds: number, drawOdds: number, awayOdds: number): MarketProbabilities {
  if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) {
    throw new Error(`Invalid decimal odds: ${homeOdds}/${drawOdds}/${awayOdds} (must be > 1)`);
  }
  const rawHome = 1 / homeOdds;
  const rawDraw = 1 / drawOdds;
  const rawAway = 1 / awayOdds;
  const total = rawHome + rawDraw + rawAway;
  return {
    home: rawHome / total,
    draw: rawDraw / total,
    away: rawAway / total,
  };
}

/**
 * Proportional de-vig over N decimal-odds outcomes (correct-score books quote
 * ~20-40 outcomes incl. "Other"). Returns implied probabilities normalized to
 * sum to 1. Throws on any odds ≤ 1, same as the 3-way devig.
 */
export function devigMultiway(outcomes: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  let total = 0;
  for (const [name, odds] of outcomes) {
    if (odds <= 1) throw new Error(`Invalid decimal odds for ${name}: ${odds} (must be > 1)`);
    total += 1 / odds;
  }
  const probs = new Map<string, number>();
  for (const [name, odds] of outcomes) {
    probs.set(name, 1 / odds / total);
  }
  return probs;
}
