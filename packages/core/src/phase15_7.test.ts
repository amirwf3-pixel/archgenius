/**
 * Phase 15 M7 — Professional vertical circulation engine tests.
 *
 * Covers: automatic flight splitting (9/12/13/18/19/24/25-riser families),
 * straight/U/L geometry incl. rotation and narrow/asymmetric halls, honest
 * failure classes (no fake single-flight stair is EVER painted), cross-floor
 * core coherence, stair structural validation codes, DXF stair entities with
 * level annotation, determinism, and the headroom NOT_IMPLEMENTED advisory.
 *
 * The Phase 3 critical regression (18 risers in ONE flight) is pinned here at
 * the strongest possible level: NO stair object anywhere — including
 * diagnostic candidates of rejected strategies — may contain a flight with
 * more than the configured maximum risers.
 */
import { describe, it, expect } from 'vitest';
import { solveStair } from './generator/stair-solver.js';
import {
  solveStairOrientations, makeCoreAnchor, inspectAnchorPlacement, sameRect, sharedEdgeLength,
} from './generator/vertical-core.js';
import { distributeRisers } from './generator/stair-solver.js';
import { DEFAULT_STAIR_CONFIG, type StairConfig } from './model/stairs.js';
import { validateStairs } from './validation/stair.js';
import { createProject, generate } from './pipeline.js';
import type { ProjectInput } from './model/project.js';
import { writeDXF } from './dxf/writer.js';
import { rectInsidePolygon } from './site/buildable.js';

const cfgFor = (floorHeight: number, over: Partial<StairConfig> = {}): StairConfig =>
  ({ ...DEFAULT_STAIR_CONFIG, floorHeight, ...over });

const BIG = { x: 0, y: 0, w: 20, h: 20 };

describe('M7 flight splitting (automatic, never hardcoded 9+9)', () => {
  it.each([
    // [floorHeight, expectedTotalRisers, expectedMaxPerFlight]
    [1.56, 9, 12],   // 9 risers fit ONE flight (≤ 12)
    [2.10, 12, 12],  // exactly at the flight maximum
    [2.28, 13, 12],  // 13 → must split 7+6
    [3.20, 18, 12],  // default floor: 18 → 9+9 balanced
    [3.40, 19, 12],  // 19 → 10+9 balanced
    [4.20, 24, 12],  // 24 → 12+12
  ])('floorHeight %m → %i risers solved with real multi-flight geometry', (h, total, maxPer) => {
    const cfg = cfgFor(h);
    const risers = Math.max(3, Math.ceil(h / cfg.maxRiserHeight));
    expect(risers).toBe(total);
    // A hall that can host any type:
    const sol = solveStair({ x: 0, y: 0, w: 5.0, h: 6.0 }, cfg, 'south', 'core-t', 0);
    expect(sol.ok).toBe(true);
    const st = sol.stair!;
    expect(st.totalRisers).toBe(risers);
    expect(st.flights.length).toBeGreaterThanOrEqual(risers > maxPer ? 2 : 1);
    for (const fl of st.flights) {
      expect(fl.riserCount).toBeLessThanOrEqual(cfg.maxRisersPerFlight);
      expect(fl.treadCount).toBe(fl.riserCount - 1);            // the documented convention
      expect(Math.abs(fl.runLength - fl.treadCount * fl.treadDepth)).toBeLessThan(0.021);
    }
    expect(Math.abs(st.totalRise - st.totalRisers * st.riserHeight)).toBeLessThan(0.0051);
    if (st.flights.length >= 2) expect(st.landings.length).toBe(st.flights.length - 1);
  });

  it('distributeRisers balances: 18→9+9, 19→10+9, 24→12+12, 25→9+8+8', () => {
    expect(distributeRisers(18, 12)).toEqual([9, 9]);
    expect(distributeRisers(19, 12)).toEqual([10, 9]);
    expect(distributeRisers(24, 12)).toEqual([12, 12]);
    expect(distributeRisers(25, 12)).toEqual([9, 8, 8]);
  });

  it('18 risers can NEVER appear as one flight through the engine', () => {
    // Every orientation in every hall: no returned stair may break the cap.
    for (const w of [2.4, 2.9, 3.6, 5.0]) {
      for (const h of [3.5, 4.2, 5.8, 7.5]) {
        const r = solveStairOrientations({ x: 0, y: 0, w, h }, cfgFor(3.2), [], 'c', 0);
        for (const a of r.attempts) {
          for (const fl of a.stair?.flights ?? []) expect(fl.riserCount).toBeLessThanOrEqual(12);
        }
      }
    }
  });
});

describe('M7 stair geometry: straight / U / L / rotated / narrow / asymmetric', () => {
  it('long-narrow hall → STRAIGHT with intermediate landing for 18 risers', () => {
    const r = solveStairOrientations({ x: 0, y: 0, w: 2.6, h: 7.5 }, cfgFor(3.2), [], 'c', 0);
    expect(r.stair).not.toBeNull();
    expect(r.stair!.type).toBe('straight');
    expect(r.stair!.flights.length).toBe(2);
    expect(r.stair!.flights.map(f => f.riserCount)).toEqual([9, 9]);
    expect(r.stair!.landings.length).toBe(1);
    expect(r.stair!.entrySide).toBe('south');
    expect(r.stair!.headroom?.status).toBe('NOT_IMPLEMENTED');
    expect(r.stair!.headroom?.thresholdM).toBe(2.05);
  });

  it('standard core hall → U-stair, both flights opposite direction, one landing', () => {
    const r = solveStairOrientations({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfgFor(3.2), [], 'c', 0);
    const st = r.stair!;
    expect(st.type).toBe('u-stair');
    const [a, b] = st.flights;
    expect(['north', 'south']).toContain(a.direction);
    expect(['north', 'south']).toContain(b.direction);
    expect(a.direction).not.toBe(b.direction);
    const land = st.landings[0];
    expect(land.footprint.w).toBeGreaterThan(2.0);
    expect(land.depth).toBeGreaterThanOrEqual(st.width * 0.9 - 0.05);
    // flights and landing share edges (connected geometry, not scattered rects)
    for (const fl of [a, b]) {
      const touches = Math.abs(fl.footprint.y + fl.footprint.h - land.footprint.y) < 0.06
        || Math.abs(land.footprint.y + land.footprint.h - fl.footprint.y) < 0.06;
      expect(touches).toBe(true);
    }
  });

  it('narrow hall too tight for parallel flights → L-stair with corner landing', () => {
    // Force 2 flights at 5 max risers (9 risers for a 1.6 m rise) and a hall
    // whose width cannot host two parallel flights + gap (2×1.1+0.2=2.4),
    // whose depth cannot host a stacked straight run (≈3.36), but CAN host
    // the L footprint (u 2.14 × v 2.42): the engine must land on L.
    const cfg = cfgFor(1.6, { maxRisersPerFlight: 5 });
    const r = solveStairOrientations({ x: 0, y: 0, w: 2.3, h: 2.5 }, cfg, [], 'c', 0);
    expect(r.stair).not.toBeNull();
    expect(r.stair!.type).toBe('l-stair');
    expect(r.stair!.flights.map(f => f.riserCount)).toEqual([5, 4]);
    const dirs = r.stair!.flights.map(f => f.direction);
    const horiz = dirs.some(d => d === 'east' || d === 'west');
    const vert = dirs.some(d => d === 'north' || d === 'south');
    expect(horiz && vert).toBe(true); // perpendicular
    // connecting landing touches BOTH flights
    const land = r.stair!.landings[0];
    for (const fl of r.stair!.flights) {
      const t = rOverlap(fl.footprint, land.footprint) || touchEdge(fl.footprint, land.footprint);
      expect(t).toBe(true);
    }
  });

  it('rotated fits keep every element inside the hall', () => {
    const r = solveStairOrientations({ x: 0, y: 0, w: 4.4, h: 2.6 }, cfgFor(3.2), [], 'c', 0);
    expect(r.stair).not.toBeNull();
    const st = r.stair!;
    for (const el of [...st.flights.map(f => f.footprint), ...st.landings.map(l => l.footprint), st.footprint]) {
      expect(el.x).toBeGreaterThanOrEqual(-0.011);
      expect(el.y).toBeGreaterThanOrEqual(-0.011);
      expect(el.x + el.w).toBeLessThanOrEqual(4.4 + 0.011);
      expect(el.y + el.h).toBeLessThanOrEqual(2.6 + 0.011);
    }
  });

  it('asymmetric halls are deterministic and geometrically valid', () => {
    const cfg = cfgFor(3.2);
    for (const [w, h] of [[3.13, 5.57], [2.71, 6.42], [4.87, 3.02]] as const) {
      const a = solveStairOrientations({ x: 1.2, y: 0.8, w, h }, cfg, [], 'c', 0);
      const b = solveStairOrientations({ x: 1.2, y: 0.8, w, h }, cfg, [], 'c', 0);
      if (a.stair && b.stair) {
        expect(a.stair.type).toBe(b.stair.type);
        expect(a.stair.flights.map(f => f.riserCount)).toEqual(b.stair.flights.map(f => f.riserCount));
        expect(JSON.stringify(a.stair.footprint)).toBe(JSON.stringify(b.stair.footprint));
      }
      if (a.stair) {
        const hall = { x: 1.2, y: 0.8, w, h };
        for (const fl of a.stair.flights) {
          expect(fl.footprint.x + fl.footprint.w).toBeLessThanOrEqual(hall.x + hall.w + 0.011);
        }
      }
    }
  });
});

describe('M7 honest failure classes (no fake stair, deterministic infeasible)', () => {
  it('insufficient space → no stair, per-side attempts carry the reason', () => {
    const r = solveStairOrientations({ x: 0, y: 0, w: 1.5, h: 1.5 }, cfgFor(3.2), [], 'c', 0);
    expect(r.stair).toBeNull();
    expect(r.attempts.length).toBe(4);
    expect(r.attempts.every(a => !a.ok)).toBe(true);
    expect(r.explanation.join(' ')).toContain('NO_FEASIBLE_STAIR_CONFIGURATION');
  });

  it('excessive risers (no flight count can honour the cap in this hall) → nothing painted', () => {
    // 6 m floor height = 34 risers; only 4-flight straights could split them and
    // the hall is far too short — the engine must fail, not stretch treads.
    const r = solveStairOrientations({ x: 0, y: 0, w: 3.0, h: 3.0 }, cfgFor(6.0), [], 'c', 0);
    expect(r.stair).toBeNull();
  });

  it('rise impossible under the configured max riser height → deterministic hard fail', () => {
    const sol = solveStair({ x: 0, y: 0, w: 5, h: 8 }, cfgFor(3.2, { maxRiserHeight: 0.10 }), 'south', 'c', 0);
    expect(sol.ok).toBe(false);
    expect(sol.attempts).toEqual([]);
  });

  it('overlapping flights are flagged STAIR_FLIGHT_COLLISION', () => {
    const sol = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfgFor(3.2), 'south', 'c', 0);
    const st = JSON.parse(JSON.stringify(sol.stair));
    st.flights[1].footprint = { ...st.flights[0].footprint }; // force plan overlap
    const floor: any = fakeFloorWith(st);
    const f = validateStairs(floor).filter(x => x.severity === 'hard').map(x => x.code);
    expect(f).toContain('STAIR_FLIGHT_COLLISION');
  });

  it('stair entry nosing outside its hall → STAIR_INVALID_ENTRANCE', () => {
    const sol = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfgFor(3.2), 'south', 'c', 0);
    const st = JSON.parse(JSON.stringify(sol.stair));
    st.flights[0].startPoint = { x: 9.5, y: 9.5 };
    const f = validateStairs(fakeFloorWith(st)).map(x => x.code);
    expect(f).toContain('STAIR_INVALID_ENTRANCE');
  });

  it('stair-hall without any stair geometry → STAIR_MISSING (phantom core rejected)', () => {
    const floor: any = {
      level: 0, floorHeight: 3.2, footprint: { x: 0, y: 0, w: 12, h: 18 },
      spaces: [{ id: 'sh1', type: 'stair-hall', rect: { x: 1, y: 1, w: 2.6, h: 4.4 } }],
      stairs: [], furniture: [], openings: [], walls: [],
    };
    const f = validateStairs(floor);
    expect(f.some(x => x.code === 'STAIR_MISSING' && x.severity === 'hard')).toBe(true);
  });
});

describe('M7 orientation search uses real circulation adjacency', () => {
  it('sharedEdgeLength measures only true flush adjacency', () => {
    const hall = { x: 2, y: 2, w: 3, h: 2 };
    const corridor = { x: 2, y: 0, w: 3, h: 2 };  // touches hall's south edge
    expect(sharedEdgeLength(hall, 'south', corridor)).toBeCloseTo(3, 6);
    expect(sharedEdgeLength(hall, 'north', corridor)).toBe(0);
    const far = { x: 20, y: 20, w: 2, h: 2 };
    expect(sharedEdgeLength(hall, 'south', far)).toBe(0);
  });

  it('a hall takes the orientation whose edge truly faces circulation', () => {
    const hall = { x: 0, y: 2.6, w: 4.0, h: 2.6 };
    const spaces: any = [
      { id: 'c1', type: 'corridor', rect: { x: 0, y: 0, w: 4.0, h: 2.6 } },
      { id: 'h', type: 'stair-hall', rect: hall },
    ];
    const r = solveStairOrientations(hall, cfgFor(3.2), spaces, 'c', 0);
    expect(r.stair).not.toBeNull();
    expect(r.attempts.find(a => a.ok && a.circulationAdjacency)?.side).toBe('south');
    // the well is flush to the corridor side (travel goes away from circulation)
    expect(r.stair!.footprint.y + r.stair!.footprint.h).toBeLessThanOrEqual(hall.y + hall.h + 0.011);
  });
});

describe('M7 anchor coherence', () => {
  it('sameRect + inspectAnchorPlacement classify aligned / slide / blocked', () => {
    const anchor: any = {
      hallType: 'stair-hall', rect: { x: 4, y: 8, w: 2.6, h: 4.4 },
      corridorSide: 'south', stairType: 'u-stair', originLevel: 0,
    };
    const hall: any = { id: 'h', type: 'stair-hall', rect: { ...anchor.rect } };
    expect(inspectAnchorPlacement(anchor, hall, []).aligned).toBe(true);
    const drift: any = { id: 'h', type: 'stair-hall', rect: { x: 9, y: 1, w: 2.6, h: 4.4 } };
    const insp = inspectAnchorPlacement(anchor, drift, []);
    expect(insp.aligned).toBe(false);
    expect(insp.blockers.length).toBe(0);
    expect(insp.explanation.join(' ')).toContain('sliding back');
    const blocker: any = { id: 'b', type: 'bedroom', rect: { x: 4, y: 8, w: 2.6, h: 4.4 } };
    const insp2 = inspectAnchorPlacement(anchor, drift, [blocker]);
    expect(insp2.blockers.map(b => b.id)).toEqual(['b']);
    const many = [1, 2, 3].map(i => ({ id: `x${i}`, type: 'bedroom', rect: { x: 4 + i * 0.8, y: 8, w: 2.6, h: 4.4 } }));
    const insp3 = inspectAnchorPlacement(anchor, drift, many as any);
    expect(insp3.aligned).toBe(false);
    expect(insp3.explanation.join(' ')).toContain('NOT faked');
  });

  it('makeCoreAnchor records the solved configuration for re-use', () => {
    const sol = solveStair({ x: 0, y: 0, w: 2.6, h: 4.4 }, cfgFor(3.2), 'south', 'core-main', 0);
    const a = makeCoreAnchor('stair-hall', { x: 0, y: 0, w: 2.6, h: 4.4 }, 'south', sol.stair!, 0);
    expect(a.stairType).toBe('u-stair');
    expect(a.flightCounts).toEqual([9, 9]);
    expect(a.wellFootprint).toBeDefined();
    expect(sameRect(a.rect, { x: 0, y: 0, w: 2.6, h: 4.4 })).toBe(true);
  });
});

describe('M7 integration: real stairs in real buildings, floors align', () => {
  const sites: Array<[string, any, number]> = [
    ['12x18 2F', { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8 }, 2],
    ['14x20 2F', { shape: 'rectangle', width: 14, length: 20, accessSide: 'south', streetWidth: 8 }, 2],
    ['15.5x22 2F', { shape: 'rectangle', width: 15.5, length: 22, accessSide: 'south', streetWidth: 8 }, 2],
    ['18x25 2F', { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 }, 2],
    ['18x25 3F', { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 }, 3],
    ['narrow-deep 10x30 2F', { shape: 'rectangle', width: 10, length: 30, accessSide: 'south', streetWidth: 8 }, 2],
    ['L-shape multi', { shape: 'l-shape', width: 16, length: 20, lShape: { width: 16, length: 20, notchWidth: 6, notchLength: 8, notchCorner: 'ne' }, accessSide: 'south', streetWidth: 8 } as any, 2],
    ['decimal multi', { shape: 'rectangle', width: 13.4, length: 18.7, accessSide: 'west', streetWidth: 8 }, 2],
  ];
  for (const [name, site, floors] of sites) {
    it(`${name}: every candidate stair is real geometry, floors share one core`, () => {
      const input: ProjectInput = {
        name: `m7-${name}`, site, deterministic: true, seed: 42,
        building: {
          type: 'villa', floors, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
          kitchenType: 'closed', parkingSpaces: 0, hasStair: true, hasStorage: true,
        },
      } as any;
      const prj = createProject(input);
      const res = generate(prj, { allStrategies: true });
      // PHASE 3 REGRESSION GATE — across ALL candidates incl. diagnostics:
      // no stair may contain a single >12-riser flight, empty landings on
      // multi-flight stairs, or the legacy fake-stair shape.
      const all = [...(res.candidates ?? []), ...(res.bestCandidate ? [res.bestCandidate] : []),
        ...(res.infeasible?.diagnosticCandidates ?? [])];
      expect(all.length).toBeGreaterThan(0);
      for (const cand of all) {
        for (const fl of cand.floors) {
          for (const st of fl.stairs) {
            expect(st.flights.length).toBeGreaterThanOrEqual(1);
            for (const f of st.flights) {
              expect(f.riserCount).toBeLessThanOrEqual(DEFAULT_STAIR_CONFIG.maxRisersPerFlight);
              expect(f.treadCount).toBe(f.riserCount - 1);
            }
            if (st.flights.length >= 2) expect(st.landings.length).toBeGreaterThanOrEqual(1);
            expect(st.headroom?.status).toBe('NOT_IMPLEMENTED');
          }
        }
      }
      if (res.bestCandidate) {
        // usable candidate → zero hard findings by M2 gate; and cores are coherent
        const wells = res.bestCandidate.floors.map(f => f.stairs[0]?.footprint).filter(Boolean);
        for (let i = 0; i + 1 < wells.length; i++) expect(sameRect(wells[i], wells[i + 1], 0.02)).toBe(true);
        // DXF carries real stair entities with level info
        const dxf = writeDXF(res.bestCandidate);
        expect(dxf).toContain('A-STAIR');
        expect(dxf).toContain('F0');
        expect(dxf).toContain('u-stair');
      } else {
        expect(res.infeasible).toBeTruthy();
        expect(res.infeasible!.code).toBeTruthy(); // deterministic explained NC, never a fake stair
      }
    });
  }

  it('DXF output is byte-deterministic across runs (multi-floor, stair-rich)', () => {
    const input: ProjectInput = {
      name: 'm7-det', site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 3, bedrooms: 5, masterBedrooms: 2, bathrooms: 3, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true, hasStorage: true },
      deterministic: true, seed: 42,
    } as any;
    const a = writeDXF(generate(createProject(input)).bestCandidate!);
    const b = writeDXF(generate(createProject(input)).bestCandidate!);
    expect(a).toBe(b);
  });
});

// ---------- helpers ----------
function rOverlap(a: any, b: any) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.005 && oy > 0.005;
}
function touchEdge(a: any, b: any) {
  const eps = 0.06;
  const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.05;
  const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.05;
  return (yOv && (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps))
    || (xOv && (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps));
}
function fakeFloorWith(st: any): any {
  return {
    level: 0, floorHeight: 3.2, footprint: { x: -1, y: -1, w: 6, h: 7 },
    spaces: [
      { id: 'sh1', type: 'stair-hall', rect: { ...st.footprint } },
      { id: 'cor1', type: 'corridor', rect: { x: 0, y: -0.8, w: 2.6, h: 0.8 } },
    ],
    stairs: [st], furniture: [], openings: [], walls: [],
  };
}
