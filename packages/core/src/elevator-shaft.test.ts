import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createProject, generate, validateCandidate } from './pipeline.js';
import { generateLayouts } from './generator/generator.js';
import { writeDXF } from './dxf/writer.js';
import { rectInsidePolygon } from './geometry/polygon-ops.js';
import { validateElevators } from './validation/elevator.js';
import { findCoreAdjacentShaftCell } from './generator/elevator-shaft.js';
import { DEFAULT_ELEVATOR_CONFIG, elevatorCellSize, elevatorClearSize } from './model/stairs.js';
import type { ProjectInput } from './model/project.js';
import type { LayoutCandidate } from './model/candidate.js';
import type { Rect } from './geometry/rect.js';

/**
 * Task 27 — first bounded Elevator Shaft Geometry subphase.
 *
 * The shaft is a deterministic rectangular cell reserved by the placer beside
 * the vertical stair core (never carved from leftovers), stacked with the SAME
 * rect + coreId on every floor, and exposed through Floor.elevators. Its
 * dimensions are DESIGN ASSUMPTIONS — no compliance is claimed (LIFT-002 stays
 * NOT_IMPLEMENTED). hasElevator on 2+ floors yields geometry or a deterministic
 * HARD finding; 1-floor buildings ignore it; hasElevator=false is byte-identical
 * to the db0bef1 baseline.
 */

function input(w: number, l: number, floors: number, lift: boolean | undefined, name = 'elev-golden'): ProjectInput {
  return {
    name, country: 'IR', deterministic: true, seed: 42,
    site: {
      shape: 'rectangle', width: w, length: l, accessSide: 'south', streetWidth: 8,
      setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
    },
    building: {
      type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
      kitchenType: 'closed', parkingSpaces: 1, hasStair: true, floors,
      ...(lift === undefined ? {} : { hasElevator: lift }),
    },
  } as ProjectInput;
}

function best(inp: ProjectInput): LayoutCandidate {
  const out = generate(createProject(inp), {});
  if (!out.bestCandidate) throw new Error('expected a feasible candidate');
  return out.bestCandidate;
}

function siteInput(w: number, l: number, floors: number, lift: boolean | undefined, accessSide: string, sb?: Record<string, number>): ProjectInput {
  const b = input(w, l, floors, lift);
  return { ...b, site: { ...b.site, accessSide, ...(sb ?? {}) } } as ProjectInput;
}

function lInput(w: number, l: number, floors: number, lift: boolean): ProjectInput {
  return {
    ...input(w, l, floors, lift),
    site: { shape: 'l-shape', width: w, length: l, accessSide: 'south', streetWidth: 8, lShape: { width: w, length: l, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } },
  } as ProjectInput;
}

function lDiag(w: number, l: number, lift: boolean): LayoutCandidate {
  const r = generate(createProject(lInput(w, l, 2, lift)), {});
  return r.bestCandidate ?? (r.infeasible as any).diagnosticCandidates[0] as LayoutCandidate;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (inner: Rect, outer: Rect, eps = 1e-6) =>
  inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
  inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
function sharedEdge(a: Rect, b: Rect, eps = 1e-6): number {
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) return ov(a.y, a.y + a.h, b.y, b.y + b.h);
  if (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) return ov(a.x, a.x + a.w, b.x, b.x + b.w);
  return 0;
}

describe('elevator shaft — design-assumption config', () => {
  it('cabin, clear shaft and cell dimensions are explicit design assumptions', () => {
    expect(DEFAULT_ELEVATOR_CONFIG.basis).toBe('DESIGN_ASSUMPTION');
    expect(DEFAULT_ELEVATOR_CONFIG).toMatchObject({
      cabinWidth: 1.10, cabinDepth: 1.40, sideClearance: 0.25, frontClearance: 0.20, rearClearance: 0.30, enclosureAllowance: 0.175,
    });
    expect(elevatorClearSize()).toEqual({ width: 1.6, depth: 1.9 });
    expect(elevatorCellSize()).toEqual({ width: 1.95, depth: 2.25 });
  });
});

describe('elevator shaft — placement & stacking (18×25, 2–4 floors)', () => {
  for (const floors of [2, 3, 4]) {
    it(`${floors} floors: one shaft per floor, identical rect + coreId, rect == elevator-hall space`, () => {
      const c = best(input(18, 25, floors, true));
      expect(c.floors).toHaveLength(floors);
      const ref = c.floors[0].elevators[0];
      expect(ref).toBeDefined();
      for (const fl of c.floors) {
        expect(fl.elevators).toHaveLength(1);
        const e = fl.elevators[0];
        expect(e.rect).toEqual(ref.rect); // exact, not tolerance-equal
        expect(e.coreId).toBe('core-lift');
        expect(e.basis).toBe('DESIGN_ASSUMPTION');
        const hall = fl.spaces.find(s => s.id === e.hallSpaceId)!;
        expect(hall.type).toBe('elevator-hall');
        expect(hall.rect).toEqual(e.rect);
        expect(fl.spaces.filter(s => s.type === 'elevator-hall')).toHaveLength(1);
        // explicit cabin ⊂ clear ⊂ cell, with the assumed sizes
        const along = e.doorSide === 'north' || e.doorSide === 'south';
        expect(along ? [e.rect.w, e.rect.h] : [e.rect.h, e.rect.w]).toEqual([1.95, 2.25]);
        expect(along ? [e.clearRect.w, e.clearRect.h] : [e.clearRect.h, e.clearRect.w]).toEqual([1.6, 1.9]);
        expect(inside(e.clearRect, e.rect)).toBe(true);
        expect(inside(e.cabinRect, e.clearRect)).toBe(true);
      }
    });
  }

  it('is deterministic (two runs → identical shafts, spaces and DXF)', () => {
    const a = best(input(18, 25, 3, true)), b = best(input(18, 25, 3, true));
    expect(JSON.stringify(a.floors.map(f => [f.elevators, f.spaces, f.openings]))).toBe(
      JSON.stringify(b.floors.map(f => [f.elevators, f.spaces, f.openings])));
    expect(sha(writeDXF(a))).toBe(sha(writeDXF(b)));
  });

  it('shaft is inside the buildable polygon and overlaps no room, furniture, parking or stair', () => {
    const c = best(input(18, 25, 3, true));
    for (const fl of c.floors) {
      const e = fl.elevators[0];
      expect(rectInsidePolygon(e.rect, fl.buildableBoundary!, 1e-3)).toBe(true);
      for (const s of fl.spaces) if (s.id !== e.hallSpaceId) expect(overlapArea(e.rect, s.rect)).toBeLessThan(1e-6);
      for (const fu of fl.furniture) expect(overlapArea(e.rect, fu.rect)).toBeLessThan(1e-6);
      for (const p of fl.parkingStalls) expect(overlapArea(e.rect, (p as any).rect)).toBeLessThan(1e-6);
      for (const st of fl.stairs) expect(overlapArea(e.rect, st.footprint)).toBeLessThan(1e-6);
    }
  });

  it('shaft lands on circulation: exact shared edge + its only door opens to the corridor', () => {
    const c = best(input(18, 25, 3, true));
    for (const fl of c.floors) {
      const e = fl.elevators[0];
      const landing = fl.spaces.filter(s => ['corridor', 'foyer', 'entrance'].includes(s.type))
        .map(s => sharedEdge(e.rect, s.rect)).reduce((m, v) => Math.max(m, v), 0);
      expect(landing).toBeGreaterThanOrEqual(0.8);
      const doors = fl.openings.filter(o => o.spaceA === e.hallSpaceId || o.spaceB === e.hallSpaceId);
      expect(doors).toHaveLength(1);
      const other = doors[0].spaceA === e.hallSpaceId ? doors[0].spaceB : doors[0].spaceA;
      expect(['corridor', 'foyer', 'entrance']).toContain(fl.spaces.find(s => s.id === other)?.type);
    }
  });

  it('valid shaft plan raises no ELEV_* finding and no HARD at all on the canonical site', () => {
    for (const floors of [2, 3, 4]) {
      const v = validateCandidate(best(input(18, 25, floors, true)));
      expect(v.findings.filter(f => f.code.startsWith('ELEV_'))).toEqual([]);
      expect(v.hard).toEqual([]);
    }
  });

  // The shaft cell is reserved in the private band, so the band's rooms shift by
  // the cell width and the existing served-extent trim can leave an upper-floor
  // corridor longer. Stair geometry and the corridor spine line (x, y,
  // thickness) must be exactly the no-lift ones — no stair/corridor redesign.
  it('does not move the stair or the corridor spine relative to the same strategy without a lift', () => {
    const S = ['area-efficiency', 'functional-circulation', 'alternative-zoning'] as const;
    const A = generateLayouts(input(18, 25, 3, false), [...S]), L = generateLayouts(input(18, 25, 3, true), [...S]);
    for (const st of S) {
      const a = A.find(c => c.id.includes(st))!, b = L.find(c => c.id.includes(st))!;
      expect(JSON.stringify(b.floors.map(f => f.stairs))).toBe(JSON.stringify(a.floors.map(f => f.stairs)));
      const corr = (c: LayoutCandidate) => JSON.stringify(c.floors.map(f => f.spaces.filter(s => s.type === 'corridor').map(s => [s.rect.x, s.rect.y, s.rect.h])));
      expect(corr(b)).toBe(corr(a));
    }
  });
});

describe('elevator shaft — access orientation', () => {
  // The band zoning works in an access-normalised frame, so east/west access
  // yields a ROTATED cell (door on an east/west wall). It must stay a valid,
  // stacked shaft — not trip the generic world-axis minLength gate.
  for (const side of ['north', 'east', 'west'] as const) {
    it(`18×25 access=${side}: feasible, stacked shaft, correct orientation, no HARD`, () => {
      const inp = input(18, 25, 2, true);
      (inp.site as any).accessSide = side;
      const c = best(inp);
      const [e0, e1] = c.floors.map(f => f.elevators[0]);
      expect(e1.rect).toEqual(e0.rect);
      const along = e0.doorSide === 'north' || e0.doorSide === 'south';
      expect(along ? [e0.rect.w, e0.rect.h] : [e0.rect.h, e0.rect.w]).toEqual([1.95, 2.25]);
      if (side === 'east' || side === 'west') expect(along).toBe(false);
      expect(validateCandidate(c).hard).toEqual([]);
    });
  }
});

describe('elevator shaft — no silent drop / infeasibility', () => {
  it('1-floor building ignores hasElevator: no shaft, no elevator-hall, no ELEV finding', () => {
    const c = best({ ...input(18, 25, 1, true), building: { ...input(18, 25, 1, true).building, hasStair: false } } as ProjectInput);
    expect(c.floors[0].elevators).toEqual([]);
    expect(c.floors[0].spaces.some(s => s.type === 'elevator-hall')).toBe(false);
    expect(validateCandidate(c).findings.some(f => f.code.startsWith('ELEV_'))).toBe(false);
  });

  it('a spine with no shaft reservation yields a deterministic ELEV_SHAFT_MISSING HARD (never silent)', () => {
    // 14×22 west access, daylight spine: the private band cannot host its rooms
    // once the shaft is carved, so no shaft is reserved (task 28 gate).
    const run = () => generateLayouts(siteInput(14, 22, 2, true, 'west'), ['daylight-orientation'])[0];
    const a = run(), b = run();
    expect(a.floors.every(f => f.elevators.length === 0)).toBe(true);
    const miss = (c: LayoutCandidate) => validateCandidate(c).hard.filter(f => f.code === 'ELEV_SHAFT_MISSING');
    expect(miss(a)).toHaveLength(2); // one per floor
    expect(JSON.stringify(miss(a))).toBe(JSON.stringify(miss(b)));
  });

  it('every generated 2+ floor lift candidate has shafts on all floors or an ELEV_* HARD', () => {
    for (const [w, l, fl] of [[18, 25, 2], [14, 22, 2], [14, 22, 3], [16, 24, 3], [15, 20, 2]] as const) {
      for (const c of generateLayouts(input(w, l, fl, true), ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'])) {
        const allPlaced = c.floors.every(f => f.elevators.length === 1);
        const elevHard = validateCandidate(c).hard.some(f => f.code.startsWith('ELEV_'));
        expect(allPlaced || elevHard).toBe(true);
      }
    }
  });

  it('L-shape (multi-rect) with no valid core-adjacent cell reports ELEV_SHAFT_MISSING instead of placing it generically', () => {
    // L20×24 (notch 4×6 NE): the F1 bridge corridor occupies the only
    // core-adjacent slot; circulation is never relocated for the shaft.
    const withLift = lDiag(20, 24, true), noLift = lDiag(20, 24, false);
    const codes = (c: LayoutCandidate) => [...new Set(validateCandidate(c).hard.map(f => f.code))].filter(x => x !== 'HARD_RULE_VIOLATION').sort();
    // exactly the no-lift HARD set plus the honest missing-shaft finding
    expect(codes(withLift)).toEqual([...codes(noLift), 'ELEV_SHAFT_MISSING'].sort());
    // Complete-configuration invariant: the failed lift request is never accepted,
    // and no candidate (any strategy, and the pipeline's diagnostics) carries a
    // complete stacked shaft (one per required floor, identical rect + coreId). A real
    // ground-floor shaft found before the upper floor fails to stack is allowed, but
    // it is never presented as a complete elevator solution.
    const complete = (c: LayoutCandidate) => {
      const e0 = c.floors[0]?.elevators[0];
      return !!e0 && c.floors.every(f => f.elevators.length === 1 &&
        JSON.stringify(f.elevators[0].rect) === JSON.stringify(e0.rect) && f.elevators[0].coreId === e0.coreId);
    };
    const run = () => generate(createProject(lInput(20, 24, 2, true)), {});
    const p1 = run(), p2 = run();
    expect(p1.bestCandidate).toBeFalsy();
    const all = (r: typeof p1) => [
      ...((r.infeasible as any)?.diagnosticCandidates ?? []) as LayoutCandidate[],
      ...generateLayouts(lInput(20, 24, 2, true), ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning']),
    ];
    const cands = all(p1);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(complete(c)).toBe(false);
      expect(validateCandidate(c).hard.some(f => f.code.startsWith('ELEV_'))).toBe(true);
    }
    // ELEV_SHAFT_MISSING is deterministic across runs
    const miss = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => validateCandidate(c).hard.filter(f => f.code === 'ELEV_SHAFT_MISSING')));
    expect(miss(all(p1))).toBe(miss(all(p2)));
    expect(validateCandidate(withLift).hard.some(f => f.code === 'ELEV_SHAFT_MISSING')).toBe(true);
    // stair and corridors untouched by the lift request
    const circ = (c: LayoutCandidate) => JSON.stringify(c.floors.map(f => [
      f.stairs.map(st => st.footprint),
      f.spaces.filter(sp => sp.type === 'corridor' || sp.type === 'stair-hall').map(sp => [sp.type, sp.rect]),
    ]));
    expect(circ(withLift)).toBe(circ(noLift));
  });

  it('pipeline: an impossible lift site is infeasible with ELEV_SHAFT_MISSING, deterministically', () => {
    const r1 = generate(createProject(lInput(20, 24, 2, true)), {});
    const r2 = generate(createProject(lInput(20, 24, 2, true)), {});
    expect(generate(createProject(lInput(20, 24, 2, false)), {}).bestCandidate).toBeTruthy(); // feasible without the lift
    expect(r1.bestCandidate).toBeFalsy();
    const diag = (r: typeof r1) => (r.infeasible as any).diagnosticCandidates[0] as LayoutCandidate;
    const codes = validateCandidate(diag(r1)).hard.map(f => f.code);
    expect(codes).toContain('ELEV_SHAFT_MISSING');
    expect(JSON.stringify(validateCandidate(diag(r1)).hard)).toBe(JSON.stringify(validateCandidate(diag(r2)).hard));
  });

  it('validateElevators flags misalignment between floors (HARD)', () => {
    const c = best(input(18, 25, 2, true));
    const floors = structuredClone(c.floors);
    const e1 = floors[1].elevators[0];
    e1.rect = { ...e1.rect, x: e1.rect.x + 0.3 };
    const f = validateElevators(floors);
    expect(f.some(x => x.code === 'ELEV_SHAFT_MISALIGNED' && x.severity === 'hard')).toBe(true);
  });
});

describe('elevator shaft — hasElevator=false is byte-identical to the db0bef1 baseline', () => {
  // Golden hashes computed from a clean build of commit db0bef1 (pre-elevator).
  const GOLDEN: Array<[number, number, number, boolean | undefined, string, string]> = [
    [18, 25, 2, false, '9c90187af46a372b6ff3239f58d4b2b5d53f2c1c0a9ac00814f99838e0b27a41', '5e4f494ecead038ef9834e240c21b5238612e962c3b366152291b9df75bad7be'],
    [18, 25, 3, undefined, 'fc62a39e960684995878e7904e35b7deeaaf5ecdb4fe4794a005ad280ab210f2', '64597596139891b6b7f632683cafebe2078d976e8fbd2b40181e8d34fd37f593'],
    [14, 22, 2, false, '0bcd4d457f58397d3def8906107e0f90c83fefefde2ac55e6d504639ba2ce8bc', 'a68a8f487fa8958195d513cb47e3523435ddaf24765622d0d7af44f8f8dec573'],
  ];
  for (const [w, l, fl, lift, geo, dxf] of GOLDEN) {
    it(`${w}×${l} F${fl} hasElevator=${lift}: geometry + DXF hashes unchanged`, () => {
      const c = best(input(w, l, fl, lift));
      expect(sha(JSON.stringify({ id: c.id, floors: c.floors, findings: c.findings }))).toBe(geo);
      const text = writeDXF(c);
      expect(sha(text)).toBe(dxf);
      expect(text).toContain('9\r\n$ACADVER\r\n1\r\nAC1009');
    });
  }
});

describe('elevator shaft — task 28 placement feasibility', () => {
  const stratOf = (c: LayoutCandidate) => c.id.replace(/^cand-/, '').replace(/-\d+$/, '');
  const stairOf = (c: LayoutCandidate) => JSON.stringify(c.floors.map(f => f.stairs.map(st => [st.type, st.footprint])));
  const stairHallOf = (c: LayoutCandidate) => JSON.stringify(c.floors.map(f => f.spaces.filter(s => s.type === 'stair-hall').map(s => s.rect)));
  const shaftOK = (c: LayoutCandidate) => {
    const e0 = c.floors[0].elevators[0];
    expect(e0).toBeTruthy();
    for (const fl of c.floors) {
      expect(fl.elevators).toHaveLength(1);
      const e = fl.elevators[0];
      expect(e.rect).toEqual(e0.rect); // exact stacking
      expect(e.coreId).toBe(e0.coreId);
      const hall = fl.spaces.find(s => s.id === e.hallSpaceId)!;
      expect(hall.rect).toEqual(e.rect);
      const xs = hall.polygon!.map(p => p.x), ys = hall.polygon!.map(p => p.y);
      expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => +v.toFixed(6)))
        .toEqual([e.rect.x, e.rect.y, e.rect.x + e.rect.w, e.rect.y + e.rect.h].map(v => +v.toFixed(6)));
      for (const sp of fl.spaces) if (sp.id !== hall.id) expect(overlapArea(sp.rect, e.rect)).toBeLessThan(1e-6);
    }
    expect(validateCandidate(c).findings.filter(f => f.code.startsWith('ELEV_'))).toEqual([]);
  };

  // Previously lost with the lift because the vertical spine reserved no shaft.
  for (const [w, l, fl, sb] of [
    [14, 22, 2, undefined],
    [15, 20, 2, { setbackNorth: 2, setbackSouth: 3 }],
    [16, 24, 3, undefined],
  ] as const) {
    it(`${w}×${l} F${fl}: feasible with a stacked vertical-spine shaft, stair identical to no-lift`, () => {
      const mk = (lift: boolean) => siteInput(w, l, fl, lift, 'south', sb as any);
      const c = best(mk(true));
      expect(validateCandidate(c).hard).toEqual([]);
      shaftOK(c);
      expect(c.floors[0].elevators[0].doorSide).toBe('west');
      const same = generateLayouts(mk(false), [stratOf(c) as any])[0];
      expect(stairOf(c)).toBe(stairOf(same));
      expect(stairHallOf(c)).toBe(stairHallOf(same));
    });
  }

  it('north access 14×22 F2: elevator-hall polygon == rect and one landing door on the shaft boundary per floor (stale-polygon regression)', () => {
    const c = best(siteInput(14, 22, 2, true, 'north'));
    expect(validateCandidate(c).hard).toEqual([]);
    shaftOK(c);
    for (const fl of c.floors) {
      const e = fl.elevators[0];
      const doors = fl.openings.filter(o => o.type === 'door' && (o.spaceA === e.hallSpaceId || o.spaceB === e.hallSpaceId));
      expect(doors).toHaveLength(1);
      const { x, y } = doors[0].center, r = e.rect, t = 1e-6;
      const onX = (Math.abs(x - r.x) < t || Math.abs(x - r.x - r.w) < t) && y > r.y - t && y < r.y + r.h + t;
      const onY = (Math.abs(y - r.y) < t || Math.abs(y - r.y - r.h) < t) && x > r.x - t && x < r.x + r.w + t;
      expect(onX || onY).toBe(true);
    }
  });

  it('validateElevators: a polygon that disagrees with the shaft rect is GEOMETRY_INCONSISTENT', () => {
    const floors = structuredClone(best(input(14, 22, 2, true)).floors);
    const hall = floors[1].spaces.find(s => s.id === floors[1].elevators[0].hallSpaceId)!;
    hall.polygon = hall.polygon!.map(p => ({ ...p, x: p.x + 0.4 }));
    expect(validateElevators(floors).some(f => f.code === 'ELEV_SHAFT_GEOMETRY_INCONSISTENT' && f.severity === 'hard')).toBe(true);
  });

  it('validateElevators: shared edge without a landing door on the shaft boundary is NO_LANDING', () => {
    const base = best(input(14, 22, 2, true)).floors;
    const hallId = base[0].elevators[0].hallSpaceId;
    const touches = (o: any) => o.type === 'door' && (o.spaceA === hallId || o.spaceB === hallId);
    const removed = structuredClone(base);
    removed[0].openings = removed[0].openings.filter(o => !touches(o));
    expect(validateElevators(removed).some(f => f.code === 'ELEV_SHAFT_NO_LANDING' && f.severity === 'hard')).toBe(true);
    const moved = structuredClone(base);
    for (const o of moved[0].openings) if (touches(o)) o.center = { ...o.center, x: o.center.x - 3 };
    expect(validateElevators(moved).some(f => f.code === 'ELEV_SHAFT_NO_LANDING')).toBe(true);
    expect(validateElevators(base)).toEqual([]);
  });

  for (const [w, x] of [[20, 14], [22, 16]] as const) {
    it(`L${w}×26 (notch 4×6 NE) F2: feasible with a core-adjacent shaft stacked at (${x}, 8.32)`, () => {
      const c = best(lInput(w, 26, 2, true));
      expect(validateCandidate(c).hard).toEqual([]);
      shaftOK(c);
      expect(c.floors[0].elevators[0].rect).toEqual({ x, y: 8.32, w: 2.25, h: 1.95 });
      const e = c.floors[0].elevators[0].rect;
      const sh = c.floors[0].spaces.find(s => s.type === 'stair-hall')!.rect;
      expect(sharedEdge(e, sh)).toBeGreaterThanOrEqual(0.8 - 1e-9);
      const same = generateLayouts(lInput(w, 26, 2, false), [stratOf(c) as any])[0];
      expect(stairOf(c)).toBe(stairOf(same));
    });
  }

  it('reservation never flips the placement variant: 14×22 east/west daylight keep the no-lift stair (M6 retile / P17-E regression)', () => {
    for (const side of ['east', 'west']) {
      const a = generateLayouts(siteInput(14, 22, 2, false, side), ['daylight-orientation'])[0];
      const b = generateLayouts(siteInput(14, 22, 2, true, side), ['daylight-orientation'])[0];
      expect(stairOf(b)).toBe(stairOf(a));
      expect(stairHallOf(b)).toBe(stairHallOf(a));
      expect(b.floors.every(f => f.elevators.length === 0 && !f.spaces.some(s => s.type === 'elevator-hall'))).toBe(true);
    }
  });

  it('findCoreAdjacentShaftCell: exact free cell sharing an edge with the stair hall and facing the landing; null when blocked', () => {
    const sp = (id: string, type: string, rect: Rect) => ({ id, type, rect } as any);
    const stairHall = { x: 0, y: 0, w: 2.6, h: 4.6 };
    const outer = { x: 0, y: 0, w: 6, h: 6.1 };
    const spaces = [
      sp('sh', 'stair-hall', stairHall),
      sp('c', 'corridor', { x: 0, y: 4.6, w: 6, h: 1.5 }),
      sp('r', 'bedroom', { x: 2.6, y: 0, w: 3.4, h: 2.0 }),
    ];
    const args = { stairHall, spaces, inside: (r: Rect) => inside(r, outer) };
    const a = findCoreAdjacentShaftCell(args), b = findCoreAdjacentShaftCell(args);
    // cell is 1.95 along the door wall × 2.25 deep; the whole 2.25 depth rides the stair-hall edge
    expect(a!.side).toBe('north');
    expect(a!.rect.x).toBe(2.6);
    expect(a!.rect.w).toBe(1.95);
    expect(a!.rect.h).toBe(2.25);
    expect(a!.rect.y + a!.rect.h).toBeCloseTo(4.6, 9); // door wall on the corridor edge
    expect(sharedEdge(a!.rect, stairHall)).toBeCloseTo(2.25, 9);
    expect(b).toEqual(a);
    expect(findCoreAdjacentShaftCell({ ...args, exclude: [{ x: 2.6, y: 2.0, w: 3.4, h: 2.6 }] })).toBeNull();
  });
});
