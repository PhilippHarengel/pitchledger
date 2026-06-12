import { describe, expect, test } from 'vitest';
import { isLowEdge, makePick, outcomeProbabilities, pickFromProbabilities } from '../src/model.js';
import { MODEL, HONESTY } from '../src/config.js';

describe('outcomeProbabilities', () => {
  test('sums to 1 for any rating gap', () => {
    for (const diff of [-800, -212, 0, 38, 212, 800]) {
      const p = outcomeProbabilities(1900 + diff, 1900);
      expect(p.home + p.draw + p.away).toBeCloseTo(1, 10);
    }
  });

  test('equal ratings give symmetric sides and ~26% draw', () => {
    const p = outcomeProbabilities(1800, 1800);
    expect(p.home).toBeCloseTo(p.away, 10);
    expect(p.draw).toBeCloseTo(MODEL.DRAW_NU / (2 + MODEL.DRAW_NU), 10);
  });

  test('draw probability decays as Elo gap grows', () => {
    const even = outcomeProbabilities(1800, 1800).draw;
    const mid = outcomeProbabilities(2000, 1800).draw;
    const wide = outcomeProbabilities(2300, 1800).draw;
    expect(mid).toBeLessThan(even);
    expect(wide).toBeLessThan(mid);
  });

  test('stronger side is favored, mirror symmetry holds', () => {
    const p = outcomeProbabilities(2100, 1850);
    const q = outcomeProbabilities(1850, 2100);
    expect(p.home).toBeGreaterThan(p.away);
    expect(p.home).toBeCloseTo(q.away, 10);
    expect(p.draw).toBeCloseTo(q.draw, 10);
  });
});

describe('pickFromProbabilities', () => {
  test('picks the stronger side when it clears the draw threshold', () => {
    const pick = makePick(2100, 1850);
    expect(pick.outcome).toBe('HOME');
    expect(pick.confidence).toBeGreaterThanOrEqual(MODEL.DRAW_PICK_THRESHOLD);
  });

  test('picks the draw when neither side clears the threshold', () => {
    const pick = makePick(1900, 1900);
    // Evenly matched: sides at ~37% each, below the 0.42 threshold.
    expect(pick.outcome).toBe('DRAW');
    expect(pick.confidence).toBeCloseTo(outcomeProbabilities(1900, 1900).draw, 10);
  });

  test('away pick when away is stronger', () => {
    expect(makePick(1800, 2100).outcome).toBe('AWAY');
  });

  test('tie between sides resolves to home (deterministic)', () => {
    const p = { home: 0.45, draw: 0.1, away: 0.45 };
    expect(pickFromProbabilities(p, 0).outcome).toBe('HOME');
  });

  test('model is structurally able to pick all three outcomes', () => {
    const outcomes = new Set(
      [
        [2300, 1800],
        [1800, 2300],
        [1900, 1900],
      ].map(([h, a]) => makePick(h as number, a as number).outcome),
    );
    expect(outcomes).toEqual(new Set(['HOME', 'AWAY', 'DRAW']));
  });
});

describe('isLowEdge', () => {
  const confident = makePick(2300, 1800); // high confidence

  test('triggers on confidence below the floor', () => {
    const timid = makePick(1920, 1900);
    expect(timid.confidence).toBeLessThan(HONESTY.CONFIDENCE_FLOOR);
    expect(isLowEdge(timid, null)).toBe(true);
  });

  test('triggers on small model-vs-market gap', () => {
    expect(isLowEdge(confident, confident.confidence - 0.01)).toBe(true);
  });

  test('clear edge over market is not low edge', () => {
    expect(isLowEdge(confident, confident.confidence - 0.2)).toBe(false);
  });

  test('missing market suppresses the gap rule (not evidence of low edge)', () => {
    expect(isLowEdge(confident, null)).toBe(false);
  });
});
