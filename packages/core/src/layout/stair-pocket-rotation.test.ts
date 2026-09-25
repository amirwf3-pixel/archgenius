/**
 * Phase 5.5B — opt-in `rotateShallowStairPocket` (horizontal / L-spur zoning).
 *
 * When the private band is 2.6 m ≤ depth < 4.2 m (the legacy 2.6–2.9 × 4.2–4.6 m stair
 * pocket would be clipped to a hall no U-stair fits) and the band keeps > 1.2 m beside a
 * 4.4 m pocket, the pocket is carved 4.4 m along the corridor × the full band depth.
 * Stair solver / validation unchanged; the generator adopts the variant only through
 * adoptStairPocketVariant. OFF must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { placeSpaces, stairPocketRotationApplies, STAIR_POCKET_ROTATED_LENGTH, type PlacedSpec } from './placer.js';
import { generateLayouts, adoptStairPocketVariant } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { solveStair } from '../generator/stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from '../model/stairs.js';
import type { Space, SpaceType, Zone } from '../model/space.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

type Out = { spaces: Space[]; corridors: Space[]; explanation: string[] };
const MARK = 'Phase 5.5B stair pocket rotated';
const ADOPTED = 'Phase 5.5B: rotated stair-pocket variant adopted';

const mkSpace = (type: SpaceType, r: Rect, label: string, id: string, zone: Zone): Space => ({
  id, type, label, zone, privacy: zone === 'circulation' ? 'service' : zone,
  polygon: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  rect: { ...r }, area: r.w * r.h, targetArea: r.w * r.h, minArea: 0,
  wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
}) as unknown as Space;
function spec(type: SpaceType, minArea: number, targetArea: number, minWidth: number, privacy: 'public' | 'service' | 'private'): PlacedSpec {
  return { type, minArea, targetArea, minWidth, privacy, priority: 5, placedId: `${type}-x`, placedLabel: type } as PlacedSpec;
}
/** Generic two-storey ground floor (programme minimums from TYPICAL_AREAS). */
const SPECS: PlacedSpec[] = [
  spec('entrance', 2, 3, 1.2, 'public'), spec('foyer', 3, 4, 1.4, 'public'), spec('living', 12, 18, 3, 'public'),
  spec('kitchen', 6, 10, 2, 'service'), spec('stair-hall', 4.5, 6, 1.2, 'service'),
  spec('bedroom', 9, 12, 2.5, 'private'), spec('bathroom', 2.4, 3.6, 1.3, 'private'),
];
const place = (fp: Rect, strategy: string, on?: boolean): Out => on === undefined
  ? placeSpaces(fp, SPECS, strategy as never, 'south', mkSpace)
  : placeSpaces(fp, SPECS, strategy as never, 'south', mkSpace, { rotateShallowStairPocket: on });
const hall = (o: Out) => o.spaces.find(s => s.type === 'stair-hall')!.rect;
const CFG = { ...DEFAULT_STAIR_CONFIG, floorHeight: 3.2 };
const noOverlap = (rs: Rect[]) => rs.every((p, i) => rs.every((q, j) => j <= i ||
  !(Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1e-6 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1e-6)));
const solvable = (r: Rect) => (['south', 'north', 'east', 'west'] as const).some(s => solveStair({ x: 0, y: 0, w: r.w, h: r.h }, CFG, s, 'c', 0).ok);

describe('Phase 5.5B — stairPocketRotationApplies (boundaries)', () => {
  it('applies only for 2.6 ≤ depth < 4.2 with > 1.2 m left beside the 4.4 m pocket', () => {
    expect(STAIR_POCKET_ROTATED_LENGTH).toBe(4.4);
    expect(stairPocketRotationApplies(16, 2.59)).toBe(false);
    expect(stairPocketRotationApplies(16, 2.6)).toBe(true);
    expect(stairPocketRotationApplies(16, 4.19)).toBe(true);
    expect(stairPocketRotationApplies(16, 4.2)).toBe(false);
    expect(stairPocketRotationApplies(5.6, 3.5)).toBe(false);   // 5.6 − 4.4 = 1.2, not > 1.2
    expect(stairPocketRotationApplies(5.61, 3.5)).toBe(true);
  });

  it('the rotated 4.4 m pocket hosts the solver\'s U-stair across the whole 2.6–4.2 m range', () => {
    for (let d = 2.6; d < 4.2; d += 0.05) expect(solvable({ x: 0, y: 0, w: 4.4, h: +d.toFixed(2) })).toBe(true);
  });
});

describe('Phase 5.5B — rectangular placer', () => {
  const fp = (h: number): Rect => ({ x: 0, y: 0, w: 16, h });

  it('rotates a shallow-band pocket to 4.4 m × band depth; the clipped legacy hall has no stair, the rotated one does', () => {
    const off = place(fp(8.2), 'area-efficiency');
    const on = place(fp(8.2), 'area-efficiency', true);
    const a = hall(off), b = hall(on);
    expect(a.w).toBeCloseTo(2.9, 6);
    expect(b.w).toBeCloseTo(4.4, 6);
    expect(b.h).toBeCloseTo(a.h, 6);                      // full band depth kept
    expect(b.h).toBeGreaterThanOrEqual(2.6 - 1e-9);
    expect(b.h).toBeLessThan(4.2);
    expect(on.explanation.some(e => e.startsWith(MARK))).toBe(true);
    expect(off.explanation.some(e => e.includes(MARK))).toBe(false);
    expect(solvable(a)).toBe(false);
    expect(solvable(b)).toBe(true);
    // Rooms never overlap each other. (The raw placer corridor carries a legacy 2 mm
    // band-edge overlap, identical when OFF, removed by the generator's corridor snap —
    // final generated geometry is checked in the site45 test below.)
    expect(noOverlap(on.spaces.map(s => s.rect))).toBe(true);
    expect(on.corridors).toEqual(off.corridors);
  });

  it('boundaries: band < 2.6 m and band ≥ 4.2 m keep the legacy pocket (identical output)', () => {
    // alternative-zoning @ 7.0 m → band 2.40 m; area-efficiency @ 9.0 m → pocket depth 4.20 m.
    for (const [h, st] of [[7.0, 'alternative-zoning'], [7.4, 'alternative-zoning'], [9.0, 'area-efficiency'], [11.5, 'area-efficiency']] as const) {
      const off = place(fp(h), st), on = place(fp(h), st, true);
      expect(on).toEqual(off);
      expect(on.explanation.some(e => e.includes(MARK))).toBe(false);
    }
  });

  it('is deterministic and OFF (omitted / false) is identical', () => {
    for (const h of [7.8, 8.2, 8.6, 9.6]) for (const st of ['area-efficiency', 'alternative-zoning']) {
      expect(place(fp(h), st, true)).toEqual(place(fp(h), st, true));
      expect(place(fp(h), st, false)).toEqual(place(fp(h), st));
    }
  });
});

/** Generic random-sweep sites (not benchmark data). */
const SITE45 = {
  site: { shape: 'rectangle', width: 12.81, length: 21.36, streetWidth: 6.33, accessSide: 'west', setbackNorth: 2.05, setbackSouth: 0.77, setbackEast: 0.93, setbackWest: 1.89 },
  building: { type: 'villa', bedrooms: 3, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: true, floors: 3, hasElevator: false, hasStorage: true },
  seed: 69, deterministic: true, jurisdiction: 'IR',
};
const LSITE = {
  site: { shape: 'l-shape', width: 22.87, length: 25.97, streetWidth: 12.06, accessSide: 'north', setbackNorth: 1.91, setbackSouth: 2.34, setbackEast: 1.26, setbackWest: 0.5,
    lShape: { width: 22.87, length: 25.97, notchWidth: 8.37, notchLength: 5.66, notchCorner: 'south-west' } },
  building: { type: 'villa', bedrooms: 1, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 0, kitchenType: 'closed', hasStair: true, floors: 2, hasElevator: false, hasStorage: true },
  seed: 13, deterministic: true, jurisdiction: 'IR',
};
const R0 = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
const BENCH = { site: R0, building: B2, seed: 42, deterministic: true, jurisdiction: 'IR' };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as never;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const run = (inp: unknown, opts?: Record<string, boolean>, strats = STRATS): LayoutCandidate[] =>
  opts ? generateLayouts(clone(inp) as never, strats, opts) : generateLayouts(clone(inp) as never, strats);
const sig = (c: LayoutCandidate) => JSON.stringify({ s: c.metadata.strategy, f: c.floors, x: c.explanations, v: c.valid, n: c.findings.map(f => f.code) });
const byStrat = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const missing = (c: LayoutCandidate) => c.findings.filter(f => f.code === 'STAIR_MISSING').length;
const hardN = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard').length;

describe('Phase 5.5B — generator integration', () => {
  it('site45-style 12.81×21.36 m case: adopted, a valid 9+9 U-stair on every floor, stacked', () => {
    const off = byStrat(run(SITE45), 'alternative-zoning');
    const on = byStrat(run(SITE45, { rotateShallowStairPocket: true }), 'alternative-zoning');
    expect(missing(off)).toBeGreaterThan(0);
    expect(on.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
    expect(missing(on)).toBe(0);
    expect(hardN(on)).toBeLessThan(hardN(off));
    expect(on.valid).toBe(true);
    expect(on.floors).toHaveLength(3);
    for (const fl of on.floors) {
      expect(fl.stairs).toHaveLength(1);
      expect(fl.stairs[0].type).toBe('u-stair');
      expect(fl.stairs[0].flights.map(f => f.riserCount)).toEqual([9, 9]);
      expect(noOverlap(fl.spaces.map(sp => sp.rect))).toBe(true);
    }
  });

  it('L-shape: the option is forwarded to the wing placer, and the adopted variant clears STAIR_MISSING', () => {
    const off = run(LSITE, {});
    const on = run(LSITE, { rotateShallowStairPocket: true });
    let adopted = 0;
    for (const c of on) {
      const b = byStrat(off, c.metadata.strategy);
      if (!c.explanations.some(e => e.startsWith(ADOPTED))) { expect(sig(c)).toBe(sig(b)); continue; }
      adopted++;
      expect(c.explanations.some(e => e.includes(MARK) && e.startsWith('['))).toBe(true);   // wing-prefixed placer marker
      expect(missing(c)).toBeLessThan(missing(b));
      expect(hardN(c)).toBeLessThan(hardN(b));
    }
    expect(adopted).toBeGreaterThanOrEqual(1);
  });

  it('OFF (omitted / false) is identical to baseline; deterministic when ON', () => {
    for (const inp of [SITE45, LSITE, BENCH]) {
      const base = run(inp).map(sig);
      expect(run(inp, { rotateShallowStairPocket: false }).map(sig)).toEqual(base);
      expect(run(inp, { rotateShallowStairPocket: true }).map(sig)).toEqual(run(inp, { rotateShallowStairPocket: true }).map(sig));
    }
  });

  it('pipeline: DXF output with the option omitted / false is byte-identical', () => {
    const dxf = (o?: Record<string, boolean>) => writeDXF(generate(createProject(clone(BENCH) as never), o as never).candidates[0]);
    expect(dxf({ rotateShallowStairPocket: false })).toBe(dxf());
  });
});

describe('Phase 5.5B — adoptStairPocketVariant guard', () => {
  const F = (code: string, severity: 'hard' | 'soft' = 'hard'): Finding => ({ code, severity, message: code } as unknown as Finding);
  const cand = (findings: Finding[], valid = false, rotated = true): LayoutCandidate =>
    ({ findings, valid, explanations: rotated ? [`[night wing] ${MARK}: 4.40 m`] : [], floors: [] } as unknown as LayoutCandidate);
  const base = () => cand([F('STAIR_MISSING'), F('STAIR_MISSING'), F('ROOM_CONSTRAINT_MIN_AREA')], false, false);

  it('adopts when STAIR_MISSING and HARD strictly fall with nothing else added', () => {
    const v = cand([F('ROOM_CONSTRAINT_MIN_AREA')]);
    expect(adoptStairPocketVariant(base(), v)).toBe(v);
  });
  it('rejects without the rotation marker', () => {
    const b = base();
    expect(adoptStairPocketVariant(b, cand([], false, false))).toBe(b);
  });
  it('rejects when STAIR_MISSING does not strictly fall', () => {
    const b = base();
    expect(adoptStairPocketVariant(b, cand([F('STAIR_MISSING'), F('STAIR_MISSING')]))).toBe(b);
  });
  it('rejects when total HARD does not strictly fall', () => {
    const b = base();
    expect(adoptStairPocketVariant(b, cand([F('ROOM_CONSTRAINT_MIN_AREA'), F('ROOM_CONSTRAINT_MIN_AREA'), F('ROOM_CONSTRAINT_MIN_AREA')]))).toBe(b);
  });
  it('rejects any other HARD code increase', () => {
    const b = base();
    expect(adoptStairPocketVariant(b, cand([F('ELEV_SHAFT_MISALIGNED')]))).toBe(b);
  });
  it('rejects a circulation / access / daylight increase at any severity', () => {
    const b = base();
    expect(adoptStairPocketVariant(b, cand([F('CIRCULATION_DEAD_END', 'soft')]))).toBe(b);
    expect(adoptStairPocketVariant(b, cand([F('ROOM_DAYLIGHT_QUALITY', 'soft')]))).toBe(b);
    expect(adoptStairPocketVariant(b, cand([F('CONSTRAINT_DIRECT_ACCESS', 'soft')]))).toBe(b);
  });
  it('never turns a valid candidate invalid', () => {
    const b = cand([F('STAIR_MISSING'), F('X_HARD'), F('Y_HARD')], true, false);
    expect(adoptStairPocketVariant(b, cand([F('X_HARD')], false))).toBe(b);
  });
});
