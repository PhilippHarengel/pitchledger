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
