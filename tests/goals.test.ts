import { describe, expect, test } from 'vitest';
import {
  lambdasFromElo,
  makeScorePick,
  scoreGrid,
  scoreString,
  type ScoreCell,
  type ScoreParams,
} from '../src/goals.js';

const sum = (cells: readonly ScoreCell[]): number => cells.reduce((s, c) => s + c.prob, 0);
const drawMass = (cells: readonly ScoreCell[]): number =>
  cells.filter((c) => c.home === c.away && c.home <= 6).reduce((s, c) => s + c.prob, 0);

describe('scoreGrid', () => {
  test('sums to 1.0 for equal ratings', () => {
    expect(sum(scoreGrid(1900, 1900))).toBeCloseTo(1, 9);
  });

  test('sums to 1.0 for a +400 Elo gap', () => {
    expect(sum(scoreGrid(2300, 1900))).toBeCloseTo(1, 9);
    expect(sum(scoreGrid(1900, 2300))).toBeCloseTo(1, 9);
  });

  test('Dixon-Coles lifts draw mass above independent Poisson (same λ)', () => {
    // Same λ from Elo, correction on vs off (ρ = 0 is pure independent Poisson).
    const withDc = scoreGrid(1900, 1900); // default ρ = -0.05
    const independent = scoreGrid(1900, 1900, {
      goalsBaseline: 2.6,
      homeGoalAdv: 0,
      dixonColesRho: 0,
      supremacyPerElo: 0,
    });
    expect(drawMass(withDc)).toBeGreaterThan(drawMass(independent));
  });
});

describe('makeScorePick', () => {
  test('returns the grid argmax cell (modal scoreline)', () => {
    const grid = scoreGrid(1900, 1900);
    const maxProb = Math.max(...grid.map((c) => c.prob));
    const pick = makeScorePick(1900, 1900);
    expect(pick.probability).toBeCloseTo(maxProb, 12);
    expect(pick.score).toBe('1-1'); // even match → modal 1-1
  });

  test('tie-break is deterministic: lower total goals wins', () => {
    // With λ = 1 each, pois(0) = pois(1), so (0-0) and (1-1) tie at the top.
    // The tie-break prefers the lower total → 0-0.
    const tieParams: ScoreParams = {
      goalsBaseline: 2.0,
      homeGoalAdv: 0,
      dixonColesRho: -0.05,
      supremacyPerElo: 0,
    };
    expect(makeScorePick(1900, 1900, tieParams).score).toBe('0-0');
    expect(makeScorePick(1900, 1900, tieParams).score).toBe(makeScorePick(1900, 1900, tieParams).score);
  });
});

describe('lambdasFromElo', () => {
  test('equal ratings → equal rates summing to the baseline', () => {
    const { lambdaHome, lambdaAway } = lambdasFromElo(1900, 1900);
    expect(lambdaHome).toBeCloseTo(lambdaAway, 12);
    expect(lambdaHome + lambdaAway).toBeCloseTo(2.6, 12);
  });

  test('supremacy shifts rate toward the favourite', () => {
    const params: ScoreParams = {
      goalsBaseline: 2.6,
      homeGoalAdv: 0,
      dixonColesRho: -0.05,
      supremacyPerElo: 0.001,
    };
    const { lambdaHome, lambdaAway } = lambdasFromElo(2300, 1900, params);
    expect(lambdaHome).toBeGreaterThan(lambdaAway);
    expect(lambdaHome + lambdaAway).toBeCloseTo(2.6, 12);
  });
});

describe('scoreString', () => {
  test('collapses 7+ on either side to the Other bucket', () => {
    expect(scoreString(2, 1)).toBe('2-1');
    expect(scoreString(7, 0)).toBe('7+/other');
    expect(scoreString(0, 9)).toBe('7+/other');
  });
});
