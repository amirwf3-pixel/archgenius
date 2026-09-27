/**
 * Guarded parking-cutout fallback: when no normal candidate is valid and the requested
 * parking could not be placed, the floors are laid out in the REAL L left by a corner
 * perpendicular stall row (derived from the buildable rect + parking constants), and the
 * rebuild is adopted only when the full validator reports zero HARD findings.
 */
import { describe, it, expect } from 'vitest';
import {
  generateLayouts, parkingCutoutGeometry, placeParkingCutoutFloor, adoptParkingCutoutVariant,
  PARKING_CUTOUT_APPLIED, type LayoutCandidate,
} from './generator.js';
import { createProject, generate } from '../pipeline.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import { PARKING_STALL_WIDTH, PARKING_STALL_LENGTH, PARKING_AISLE_MIN_WIDTH } from '../units.js';
import type { Rect } from '../geometry/rect.js';
import type { Space } from '../model/space.js';
import type { ProjectInput } from '../model/project.js';
import type { PlacedSpec } from '../layout/placer.js';

const E = 1e-6;
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (r: Rect, o: Rect) => r.x >= o.x - E && r.y >= o.y - E && r.x + r.w <= o.x + o.w + E && r.y + r.h <= o.y + o.h + E;

const BUILDING = { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: true } as const;
const SITE = { shape: 'rectangle', width: 12, length: 18, streetWidth: 8, accessSide: 'south', setbackNorth: 1.5, setbackSouth: 3, setbackEast: 1.5, setbackWest: 1.5 } as const;
const lot = (site: Record<string, unknown> = {}, building: Record<string, unknown> = {}): ProjectInput =>
  ({ name: 'lot', site: { ...SITE, ...site }, building: { ...BUILDING, ...building }, seed: 424242, jurisdiction: 'IR', deterministic: true }) as unknown as ProjectInput;
const run = (inp: ProjectInput) => generateLayouts(clone(inp), [...STRATS]);
const usesCutout = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(PARKING_CUTOUT_APPLIED));
const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard');

function expectSoundCutoutCandidate(c: LayoutCandidate, inp: ProjectInput) {
  expect(c.valid).toBe(true);
  expect(hard(c)).toEqual([]);
  // programme: every requested room of every floor is placed
  const floors = inp.building.floors;
  const allocs = allocateBuildingProgram(inp.building, floors);
  c.floors.forEach((f, l) => {
    const want: Record<string, number> = {};
    for (const s of programForFloor(inp.building, l, floors === 1, allocs[l])) want[s.type] = (want[s.type] ?? 0) + 1;
    const got: Record<string, number> = {};
    for (const s of f.spaces) got[s.type] = (got[s.type] ?? 0) + 1;
    for (const [t, n] of Object.entries(want)) expect(got[t] ?? 0, `floor ${l} ${t}`).toBeGreaterThanOrEqual(n);
    // no overlaps between rooms
    for (let i = 0; i < f.spaces.length; i++)
      for (let j = i + 1; j < f.spaces.length; j++) expect(overlapArea(f.spaces[i].rect, f.spaces[j].rect)).toBeLessThan(1e-3);
  });
  // stair on both floors, same footprint → vertical circulation connected
  expect(c.floors.every(f => f.stairs.length === 1)).toBe(true);
  const s0 = c.floors[0].stairs[0], s1 = c.floors[1].stairs[0];
  expect(s1.footprint).toEqual(s0.footprint);
  expect(s1.coreId).toBe(s0.coreId);
  const hall0 = c.floors[0].spaces.find(s => s.type === 'stair-hall')!;
  const hall1 = c.floors[1].spaces.find(s => s.type === 'stair-hall')!;
  expect(hall1.rect).toEqual(hall0.rect);
  expect(c.findings.some(f => /VERTICAL|STAIR/.test(f.code) && f.severity === 'hard')).toBe(false);
  // parking: requested stalls placed, zero overlap with the building
  const f0 = c.floors[0];
  expect(f0.parkingStalls).toHaveLength(inp.building.parkingSpaces ?? 0);
  const cuts = [...f0.parkingStalls.map(s => s.rect), ...(f0.parkingArea?.aisleRect ? [f0.parkingArea.aisleRect] : [])];
  for (const f of c.floors) for (const s of f.spaces) for (const r of cuts) expect(overlapArea(s.rect, r)).toBeLessThan(1e-3);
  expect(c.findings.some(f => f.code.startsWith('PARKING') || f.code.startsWith('SITE_PARKING'))).toBe(false);
}

describe('parkingCutoutGeometry — L derived from the buildable rect and the parking constants', () => {
  it('12×18 south: 9×8 rear slab + 4×5 street annex beside a 5×5 stall block behind the 3.5 m aisle', () => {
    const cut = parkingCutoutGeometry(R(0, 0, 12, 18), R(1.5, 3, 9, 13.5), 'south', 2)!;
    expect(cut).not.toBeNull();
    expect(cut.run).toBeCloseTo(2 * PARKING_STALL_WIDTH, 9);
    expect(cut.block).toEqual(R(1.5, PARKING_AISLE_MIN_WIDTH, 2 * PARKING_STALL_WIDTH, PARKING_STALL_LENGTH));
    expect(cut.rects).toEqual([R(6.5, 3.5, 4, 5), R(1.5, 8.5, 9, 8)]);
    expect(cut.polygon).toHaveLength(6);
    expect(cut.backSide).toBe('north');
  });

  it('impossible L → null (stall row as wide as the buildable, or no room behind the stalls)', () => {
    expect(parkingCutoutGeometry(R(0, 0, 8, 18), R(1.5, 3, 5, 13.5), 'south', 2)).toBeNull();
    expect(parkingCutoutGeometry(R(0, 0, 12, 10), R(1.5, 3, 9, 5.5), 'south', 2)).toBeNull();
    expect(parkingCutoutGeometry(R(0, 0, 12, 18), R(1.5, 3, 9, 13.5), 'south', 0)).toBeNull();
  });
});

describe('placeParkingCutoutFloor — insufficient width → null', () => {
  const mk = (type: Space['type'], r: Rect, label: string, id: string, zone: string) => ({ id, type, name: label, rect: r, zone }) as unknown as Space;
  const specsFor = (level: number) => {
    const b = lot().building;
    const allocs = allocateBuildingProgram(b, 2);
    const all = allocs.map((a, l) => programForFloor(b, l, false, a));
    return { specs: all[level].map((s, i) => ({ ...s, placedId: `${s.type}-${i}`, placedLabel: s.type })) as PlacedSpec[], all };
  };
  it('the 12×18 L lays both floors out; an 8 m wide buildable (3 m annex) cannot host kitchen + foyer', () => {
    const cut = parkingCutoutGeometry(R(0, 0, 12, 18), R(1.5, 3, 9, 13.5), 'south', 2)!;
    for (const l of [0, 1]) { const { specs, all } = specsFor(l); expect(placeParkingCutoutFloor(cut, specs, l, all, mk)).not.toBeNull(); }
    const narrow = parkingCutoutGeometry(R(0, 0, 11, 18), R(1.5, 3, 8, 13.5), 'south', 2)!;
    expect(narrow).not.toBeNull();
    const { specs, all } = specsFor(0);
    expect(placeParkingCutoutFloor(narrow, specs, 0, all, mk)).toBeNull();
  });
});

describe('guarded parking-cutout fallback — generateLayouts', () => {
  it('12×18 + 2 parking → VALID via generate() and every strategy', () => {
    const inp = lot();
    const r = generate(createProject(clone(inp)), { allStrategies: true });
    expect(r.bestCandidate).not.toBeNull();
    expect(r.bestCandidate!.valid).toBe(true);
    for (const c of run(inp)) { expect(usesCutout(c)).toBe(true); expectSoundCutoutCandidate(c, inp); }
  });

  it('asymmetric setbacks and north / east access are derived, not hard-coded', () => {
    for (const inp of [
      lot({ width: 12.4, length: 18.6, setbackWest: 1.2, setbackEast: 1.9, setbackSouth: 3.2, setbackNorth: 1.3 }),
      lot({ accessSide: 'north', setbackNorth: 3, setbackSouth: 1.5 }),
      lot({ width: 18, length: 12, accessSide: 'east', setbackEast: 3, setbackWest: 1.5, setbackNorth: 1.5, setbackSouth: 1.5 }),
    ]) for (const c of run(inp)) { expect(usesCutout(c)).toBe(true); expectSoundCutoutCandidate(c, inp); }
  });

  it('narrow site → fallback not adopted, the candidates stay honestly invalid', () => {
    for (const c of run(lot({ width: 10 }))) {
      expect(usesCutout(c)).toBe(false);
      expect(c.valid).toBe(false);
    }
  });

  it('parking 1 and parking 0 regressions: the fallback never runs', () => {
    for (const p of [1, 0]) for (const c of run(lot({}, { parkingSpaces: p }))) expect(usesCutout(c)).toBe(false);
  });

  it('never runs when a normal candidate is valid', () => {
    const inp = { name: 'rect', site: { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 }, building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 }, seed: 42, jurisdiction: 'IR', deterministic: true } as unknown as ProjectInput;
    const cs = run(inp);
    expect(cs.some(c => c.valid)).toBe(true);
    expect(cs.some(usesCutout)).toBe(false);
  });

  it('adoption guard rejects a valid base, a base without a parking failure, and an invalid variant', () => {
    const [v] = run(lot());
    const invalidBase = { ...v, valid: false, findings: [{ severity: 'hard', code: 'PARKING_PROGRAM_UNPLACED' }] } as unknown as LayoutCandidate;
    expect(adoptParkingCutoutVariant(invalidBase, v, 2)).toBe(v);
    const validBase = { ...invalidBase, valid: true } as LayoutCandidate;
    expect(adoptParkingCutoutVariant(validBase, v, 2)).toBe(validBase);
    const otherFailure = { ...invalidBase, findings: [{ severity: 'hard', code: 'ROOM-001' }] } as unknown as LayoutCandidate;
    expect(adoptParkingCutoutVariant(otherFailure, v, 2)).toBe(otherFailure);
    const badVariant = { ...v, valid: false } as LayoutCandidate;
    expect(adoptParkingCutoutVariant(invalidBase, badVariant, 2)).toBe(invalidBase);
    expect(adoptParkingCutoutVariant(invalidBase, v, 3)).toBe(invalidBase);
  });

  it('deterministic: repeated generation is identical', () => {
    const strip = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));
    expect(strip(run(lot()))).toBe(strip(run(lot())));
  });
});
