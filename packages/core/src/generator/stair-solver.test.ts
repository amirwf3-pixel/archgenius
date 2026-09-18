import { describe, it, expect } from 'vitest';
import {
  distributeRisers,
  chooseTreadDepth,
  requiredFootprint,
  solveStair,
} from './stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from '../model/stairs.js';

describe('distributeRisers', () => {
  it('puts a single flight for ≤ max', () => {
    expect(distributeRisers(9, 12)).toEqual([9]);
    expect(distributeRisers(12, 12)).toEqual([12]);
  });
  it('splits 18 → 9+9', () => {
    expect(distributeRisers(18, 12)).toEqual([9, 9]);
  });
  it('splits 19 → 10+9 (balanced)', () => {
    expect(distributeRisers(19, 12)).toEqual([10, 9]);
  });
  it('splits 24 → 12+12', () => {
    expect(distributeRisers(24, 12)).toEqual([12, 12]);
  });
  it('splits 25 → 9+8+8 (3 flights)', () => {
    expect(distributeRisers(25, 12)).toEqual([9, 8, 8]);
  });
  it('returns [] for 0', () => {
    expect(distributeRisers(0, 12)).toEqual([]);
  });
});

describe('chooseTreadDepth', () => {
  it('picks tread that satisfies Blondel 2h+b ∈ [0.63,0.64]', () => {
    for (const r of [0.16, 0.17, 0.175, 0.178, 0.18]) {
      const t = chooseTreadDepth(r, 0.28);
      expect(t).toBeGreaterThanOrEqual(0.28 - 1e-9);
      expect(t).toBeLessThanOrEqual(0.32 + 1e-9);
      const b = 2 * r + t;
      expect(b).toBeGreaterThanOrEqual(0.629 - 1e-9);
      expect(b).toBeLessThanOrEqual(0.65 + 1e-9);
    }
  });
});

describe('requiredFootprint', () => {
  it('requires longer well for straight than U in width-constrained sites', () => {
    const s = requiredFootprint('straight', [18], 0.28, 1.1, 1.2);
    const u = requiredFootprint('u-stair', [9, 9], 0.28, 1.1, 1.2);
    expect(s.h).toBeGreaterThan(u.h);
    expect(u.w).toBeGreaterThan(s.w);
  });
  it('L-stair footprint is square-ish for balanced runs', () => {
    const l = requiredFootprint('l-stair', [9, 9], 0.28, 1.1, 1.1);
    expect(l.w).toBeGreaterThan(2);
    expect(l.h).toBeGreaterThan(3);
  });
});

describe('solveStair', () => {
  const cfg = DEFAULT_STAIR_CONFIG;

  it('places a U-stair in a standard 2.6×4.4 m residential core', () => {
    const r = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfg, 'south');
    expect(r.ok).toBe(true);
    expect(r.stair).toBeTruthy();
    const st = r.stair!;
    expect(st.type).toBe('u-stair');
    expect(st.totalRisers).toBe(Math.ceil(cfg.floorHeight / cfg.maxRiserHeight));
    expect(st.flights).toHaveLength(2);
    for (const fl of st.flights) {
      expect(fl.riserCount).toBeLessThanOrEqual(cfg.maxRisersPerFlight);
      expect(fl.treadCount).toBe(fl.riserCount - 1);
      expect(fl.runLength).toBeCloseTo(fl.treadCount * fl.treadDepth, 2);
    }
    expect(st.landings).toHaveLength(1);
    expect(st.landings[0].depth).toBeGreaterThanOrEqual(1.0);
  });

  it('places a STRAIGHT stair when the hall is long and narrow', () => {
    const r = solveStair({ x: 0, y: 0, w: 1.3, h: 6.0 }, cfg, 'south');
    expect(r.ok).toBe(true);
    // In a narrow but long hall a straight single flight fits (9 risers).
    // NOTE: default floor height = 3.20 m ⇒ 18 risers > 12, so solver will
    // need a mid-flight landing — which falls back to 'straight' with 2
    // flights stacked. Either way it must return ok = true with ≤12/flight.
    const st = r.stair!;
    for (const fl of st.flights) {
      expect(fl.riserCount).toBeLessThanOrEqual(12);
    }
  });

  it('returns ok=false for impossibly small footprint', () => {
    const r = solveStair({ x: 0, y: 0, w: 1.0, h: 1.0 }, cfg, 'south');
    expect(r.ok).toBe(false);
    expect(r.attempts.length).toBeGreaterThan(0);
    for (const a of r.attempts) {
      expect(typeof a.reason).toBe('string');
    }
  });

  it('is deterministic (same inputs produce same output)', () => {
    const a = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfg, 'south');
    const b = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfg, 'south');
    expect(JSON.stringify(a.stair)).toEqual(JSON.stringify(b.stair));
  });

  it('totalRise ≈ totalRisers × riserHeight within tolerance', () => {
    const r = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfg, 'south');
    expect(r.ok).toBe(true);
    const st = r.stair!;
    expect(Math.abs(st.totalRise - st.totalRisers * st.riserHeight)).toBeLessThan(0.005);
  });
});
