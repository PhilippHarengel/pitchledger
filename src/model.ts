import { MODEL, HONESTY } from './config.js';

/**
 * Davidson 3-way outcome model on Elo ratings.
 *
 *   r = 10^(eloDiff / 800)            (eloDiff = home − away)
 *   denom = r + 1/r + ν
 *   P(home) = r / denom
 *   P(away) = (1/r) / denom
 *   P(draw) = ν / denom
 *
 * With equal ratings P(draw) = ν/(2+ν) ≈ 26% for ν = 0.7, decaying as the
 * gap grows. Davidson argmax alone can never return the draw (ν < r + 1/r
 * always), so the pick rule adds a threshold: when neither side clears
 * DRAW_PICK_THRESHOLD, the draw IS the pick (review decision D10).
 */
export interface Probabilities {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
}

export type Outcome = 'HOME' | 'DRAW' | 'AWAY';

export interface ModelPick {
  readonly outcome: Outcome;
  readonly confidence: number;
  readonly probabilities: Probabilities;
  readonly eloDiff: number;
}

export function outcomeProbabilities(eloHome: number, eloAway: number): Probabilities {
  const eloDiff = eloHome - eloAway;
  const r = Math.pow(10, eloDiff / 800);
  const denom = r + 1 / r + MODEL.DRAW_NU;
  return {
    home: r / denom,
    draw: MODEL.DRAW_NU / denom,
    away: 1 / r / denom,
  };
}

export function pickFromProbabilities(p: Probabilities, eloDiff: number): ModelPick {
  const sideMax = Math.max(p.home, p.away);
  if (sideMax < MODEL.DRAW_PICK_THRESHOLD) {
    return { outcome: 'DRAW', confidence: p.draw, probabilities: p, eloDiff };
  }
  const outcome: Outcome = p.home >= p.away ? 'HOME' : 'AWAY';
  return { outcome, confidence: sideMax, probabilities: p, eloDiff };
}

export function makePick(eloHome: number, eloAway: number): ModelPick {
  return pickFromProbabilities(outcomeProbabilities(eloHome, eloAway), eloHome - eloAway);
}

/**
 * "Low edge — consider skip" rule. Frozen at pick time (D13) — never
 * recomputed after publication. marketProbability is the de-vigged market
 * probability of the picked outcome, or null when no odds were available
 * (label suppressed: a missing market is not evidence of low edge).
 */
export function isLowEdge(pick: ModelPick, marketProbability: number | null): boolean {
  if (pick.confidence < HONESTY.CONFIDENCE_FLOOR) return true;
  if (marketProbability === null) return false;
  const gapPp = Math.abs(pick.confidence - marketProbability) * 100;
  return gapPp < HONESTY.MARKET_GAP_MIN_PP;
}
