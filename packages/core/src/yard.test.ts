/**
 * Task 154 — yard core support (`building.hasYard === true`).
 *
 * Contract under test (existing program: yard target 20 m², min 10 m²):
 *   1. ON: one real, bounded, open-air yard on the ground floor — inside the buildable
 *      polygon, under no floor's spaces, clear of parking, never on the street side,
 *      never walled, reachable from the street over open ground.
 *   2. OFF / omitted: unchanged (no yard, no yard program requirement).
 *   3. Decimal / asymmetric / all access sides / narrow / L-shaped sites.
 *   4. A yard that cannot fit → deterministic INFEASIBLE (ARCH_PROGRAM_UNPLACED).
 *   5. Validation: YARD_INVALID / YARD_NO_ACCESS (HARD), reachability walkway ≥ corridor min.
 *   6. Deterministic; DXF keeps the frozen R12 profile.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createProject, generate, exportDXF, validateCandidate } from './pipeline.js';
import { getTypicalArea } from './programming/program.js';
import { validateYards } from './validation/yard.js';
import { yardAreaCap, yardReachable, rectsOverlap } from './generator/yard.js';
import { generateWalls } from './generator/walls.js';
import { rectInsidePolygon } from './geometry/polygon-ops.js';
import type { ProjectInput } from './model/project.js';
import type { LayoutCandidate } from './model/layout.js';
import type { Rect } from './geometry/rect.js';

const V2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
const V1 = { ...V2, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 };
const sb = (n: number, s: number, e: number, w: number) => ({ setbackNorth: n, setbackSouth: s, setbackEast: e, setbackWest: w });

function mk(site: any, building: any, seed: number, hasYard: boolean | undefined): ProjectInput {
  const b: any = { ...building };
  if (hasYard !== undefined) b.hasYard = hasYard;
  return { name: 'yard-t154', site, building: b, seed, deterministic: true } as unknown as ProjectInput;
}

/** The web UI's default project input (App.tsx DEFAULT_STATE). */
const uiDefault = (y: boolean | undefined) => mk(
  { shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8, northRotationDeg: 0,
    setbacks: { north: 2, south: 3, east: 2, west: 2 }, jurisdiction: 'Tehran-Municipality-Default', city: 'Tehran', parkingLayout: 'auto' },
  { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2,
    hasStair: true, hasElevator: false, hasStorage: true, hasBalcony: false },
  42, y);

const SITES: Array<[string, any, any, number]> = [
  ['decimal+asymmetric 17.5×28.3 south 2F', { shape: 'rectangle', width: 17.5, length: 28.3, streetWidth: 9.5, accessSide: 'south', ...sb(2.25, 1.75, 1.5, 2.6) }, V2, 7],
  ['decimal+asymmetric 28.3×17.5 east 2F', { shape: 'rectangle', width: 28.3, length: 17.5, streetWidth: 9.5, accessSide: 'east', ...sb(2.25, 1.75, 1.5, 2.6) }, V2, 7],
  ['decimal+asymmetric 17.5×30.3 north 2F', { shape: 'rectangle', width: 17.5, length: 30.3, streetWidth: 9.5, accessSide: 'north', ...sb(2.25, 1.75, 1.5, 2.6) }, V2, 7],
  ['decimal+asymmetric 30.3×17.5 west 2F', { shape: 'rectangle', width: 30.3, length: 17.5, streetWidth: 9.5, accessSide: 'west', ...sb(2.25, 1.75, 1.5, 2.6) }, V2, 7],
  ['narrow 12×30 1F', { shape: 'rectangle', width: 12, length: 30, streetWidth: 8, accessSide: 'south', ...sb(3, 1.5, 1.5, 1.5) }, V1, 42],
  ['narrow decimal 12.5×32.5 1F', { shape: 'rectangle', width: 12.5, length: 32.5, streetWidth: 8, accessSide: 'south', ...sb(3, 1.5, 1.5, 1.5) }, V1, 42],
  ['narrow 13×30 2F', { shape: 'rectangle', width: 13, length: 30, streetWidth: 8, accessSide: 'south', ...sb(3, 1.5, 1.5, 1.5) }, V2, 42],
  ['L-shape 18×25 NE 4×6 1F', { shape: 'l-shape', width: 18, length: 25, streetWidth: 8, accessSide: 'south', ...sb(3, 1.5, 2, 2), lShape: { width: 18, length: 25, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } }, V1, 42],
  ['L-shape 20×26 SW 4×6 1F (flank yard)', { shape: 'l-shape', width: 20, length: 26, streetWidth: 8, accessSide: 'south', ...sb(3, 1.5, 2, 2), lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'south-west' } }, V1, 42],
];

const PROG = getTypicalArea('yard');
const CAP = yardAreaCap(PROG.target, PROG.min);
const run = (p: ProjectInput) => generate(createProject(JSON.parse(JSON.stringify(p))), { allStrategies: true });
const yards = (c: LayoutCandidate) => c.floors.flatMap(f => f.spaces.filter(s => s.type === 'yard').map(s => ({ f, s })));
const fingerprint = (cands: LayoutCandidate[]) => {
  const h = createHash('sha256');
  for (const c of cands) { h.update(JSON.stringify(c.floors)); h.update(exportDXF(c, 'x').dxf); }
  return h.digest('hex');
};

/** Full physical contract for a placed yard. */
function expectRealYard(c: LayoutCandidate) {
  const ys = yards(c);
  expect(ys.length).toBe(1);
  const { f, s } = ys[0];
  expect(f.level).toBe(0);
  expect(s.area).toBeGreaterThanOrEqual(PROG.min - 1e-6);
  expect(s.area).toBeLessThanOrEqual(CAP + 1e-6);
  expect(s.area).toBeCloseTo(PROG.target, 1);
  expect(Math.max(s.rect.w, s.rect.h) / Math.min(s.rect.w, s.rect.h)).toBeLessThanOrEqual(3.5 + 1e-6);
  expect(rectInsidePolygon(s.rect, (c as any).buildableBoundary, 1e-3)).toBe(true);
  for (const fl of c.floors) for (const o of fl.spaces) if (o.id !== s.id) expect(rectsOverlap(s.rect, o.rect)).toBe(false);
  const parking: Rect[] = [...(f.parkingStalls ?? []).map((p: any) => p.rect), ...(f.parkingArea?.aisleRect ? [f.parkingArea.aisleRect] : [])];
  for (const p of parking) expect(rectsOverlap(s.rect, p)).toBe(false);
  expect(f.walls.some(w => w.spaceIds.includes(s.id))).toBe(false);          // open ground: never walled
  expect(f.openings.some(o => o.spaceA === s.id || o.spaceB === s.id)).toBe(false);
  const vr = validateCandidate(c);
  expect(vr.findings.filter(x => String(x.code).startsWith('YARD_'))).toEqual([]);
  expect(vr.hard).toEqual([]);
}

describe('Task 154: yard program is the existing one', () => {
  it('target 20 m², min 10 m²; cap = existing M4 formula (35 m²)', () => {
    expect(PROG.target).toBe(20);
    expect(PROG.min).toBe(10);
    expect(CAP).toBeCloseTo(35, 9);
  });
});

describe('Task 154: yard ON produces real bounded geometry', () => {
  it('UI default 18×28 2F: rear yard, open-air, inside buildable, reachable, no walls/doors', () => {
    const r = run(uiDefault(true));
    expect(r.bestCandidate).not.toBeNull();
    for (const c of r.candidates) expectRealYard(c);
    const { s } = yards(r.bestCandidate!)[0];
    const bldTop = Math.max(...r.bestCandidate!.floors.flatMap(f => f.spaces.filter(x => x.type !== 'yard').map(x => x.rect.y + x.rect.h)));
    expect(s.rect.y).toBeGreaterThanOrEqual(bldTop - 1e-6); // behind the building (street is south)
  });
  it('yard is a ground-floor program requirement only when requested', () => {
    const on = run(uiDefault(true)).bestCandidate as any;
    const off = run(uiDefault(false)).bestCandidate as any;
    expect(on.programRequirements[0].byType.yard).toBe(1);
    expect(off.programRequirements[0].byType.yard).toBeUndefined();
  });
  for (const [name, site, building, seed] of SITES) {
    it(`${name}: yard ON is feasible with a real yard; OFF unchanged-feasible`, () => {
      const on = run(mk(site, building, seed, true));
      expect(on.bestCandidate).not.toBeNull();
      for (const c of on.candidates) expectRealYard(c);
      const off = run(mk(site, building, seed, false));
      expect(off.bestCandidate).not.toBeNull();
      for (const c of off.candidates) expect(yards(c)).toEqual([]);
    });
  }
});

describe('Task 154: yard OFF unchanged', () => {
  it('hasYard=false and omitted give identical plans + DXF with no yard', () => {
    const f = run(uiDefault(false));
    const u = run(uiDefault(undefined));
    expect(fingerprint(f.candidates)).toBe(fingerprint(u.candidates));
    for (const c of f.candidates) expect(yards(c)).toEqual([]);
    expect(validateYards(f.bestCandidate!)).toEqual([]);
  });
  it('generateWalls ignores yard spaces (editing path keeps the yard open)', () => {
    const c = run(uiDefault(true)).bestCandidate!;
    const g = c.floors[0];
    const withYard = generateWalls(g.spaces, 0);
    const without = generateWalls(g.spaces.filter(s => s.type !== 'yard'), 0);
    expect(JSON.stringify(withYard)).toBe(JSON.stringify(without));
  });
});

describe('Task 154: impossible yard → deterministic INFEASIBLE', () => {
  // Golden L-shape 2F: the house covers the whole buildable envelope; the only open
  // ground inside it is < 10 m², so no program yard exists.
  const input = () => mk(
    { shape: 'l-shape', width: 20, length: 26, streetWidth: 8, accessSide: 'south', ...sb(3, 1.5, 2, 2), lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } },
    V2, 42, true);
  it('INFEASIBLE citing the unplaced yard, identically on repeat; no yard geometry anywhere', () => {
    const a = run(input());
    const b = run(input());
    expect(a.bestCandidate).toBeNull();
    expect(a.candidates).toEqual([]);
    expect(a.infeasible!.code).toBe('HARD_RULE_VIOLATION');
    expect(a.infeasible!.explanation).toContain('ARCH_PROGRAM_UNPLACED');
    expect(b.infeasible!.explanation).toBe(a.infeasible!.explanation);
    expect(b.infeasible!.attempts).toEqual(a.infeasible!.attempts);
    for (const d of a.infeasible!.diagnosticCandidates) {
      expect(yards(d)).toEqual([]);
      expect(d.findings.some(f => f.code === 'ARCH_PROGRAM_UNPLACED' && /'yard'/.test(f.message))).toBe(true);
      expect(d.explanations.some(e => e.startsWith('Yard INFEASIBLE'))).toBe(true);
    }
  });
  it('the same site without a yard stays feasible (failure is yard-specific)', () => {
    const p = input(); (p.building as any).hasYard = false;
    expect(run(p).bestCandidate).not.toBeNull();
  });
});

describe('Task 154: yard validation', () => {
  const base = run(uiDefault(true)).bestCandidate!;
  const clone = () => structuredClone(base) as LayoutCandidate;
  const yardOf = (c: LayoutCandidate) => yards(c)[0].s;
  const setRect = (s: any, r: Rect) => { s.rect = r; s.polygon = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]; s.area = r.w * r.h; };

  it('valid yard → no findings', () => { expect(validateYards(base)).toEqual([]); });

  it('yard moved under a room → YARD_INVALID (hard)', () => {
    const c = clone(); const s = yardOf(c);
    const room = c.floors[0].spaces.find(x => x.type === 'living')!;
    setRect(s, { x: room.rect.x, y: room.rect.y, w: s.rect.w, h: s.rect.h });
    const fs = validateYards(c);
    expect(fs.some(f => f.code === 'YARD_INVALID' && f.severity === 'hard' && /overlapping building/.test(f.message))).toBe(true);
  });

  it('yard on the street side → YARD_INVALID', () => {
    const c = clone(); const s = yardOf(c);
    const front = Math.min(...c.floors[0].spaces.filter(x => x.type !== 'yard').map(x => x.rect.y));
    setRect(s, { x: s.rect.x, y: front - s.rect.h, w: s.rect.w, h: s.rect.h });
    expect(validateYards(c).some(f => f.code === 'YARD_INVALID' && /street side/.test(f.message))).toBe(true);
  });

  it('yard area outside the program bounds → YARD_INVALID', () => {
    const c = clone(); const s = yardOf(c);
    s.area = 5;
    expect(validateYards(c).some(f => f.code === 'YARD_INVALID' && /below the program minimum/.test(f.message))).toBe(true);
    s.area = 60;
    expect(validateYards(c).some(f => f.code === 'YARD_INVALID' && /above the program cap/.test(f.message))).toBe(true);
  });

  it('yard enclosed by ground-level obstacles → YARD_NO_ACCESS (hard)', () => {
    const c = clone(); const s = yardOf(c); const g = c.floors[0];
    const r = s.rect, t = 0.3;
    // ring of thin ground obstacles around the yard (a sealed courtyard)
    const ring: Rect[] = [
      { x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y + r.h, w: r.w + 2 * t, h: t },
      { x: r.x - t, y: r.y, w: t, h: r.h }, { x: r.x + r.w, y: r.y, w: t, h: r.h },
    ];
    ring.forEach((rr, i) => g.spaces.push({ ...structuredClone(g.spaces[0]), id: `wall-block-${i}`, type: 'storage', rect: rr, polygon: [], area: rr.w * rr.h }));
    const fs = validateYards(c);
    expect(fs.map(f => f.code)).toContain('YARD_NO_ACCESS');
    expect(fs.find(f => f.code === 'YARD_NO_ACCESS')!.severity).toBe('hard');
  });

  it('reachability needs a walkway ≥ CORRIDOR_MIN_WIDTH (1.10 m)', () => {
    const site = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const yard: Rect = { x: 8, y: 15, w: 4, h: 4 };
    // a block spanning the site with a gap of width g between x=0.. and the block
    const blockers = (g: number): Rect[] => [{ x: g, y: 8, w: 20 - g, h: 4 }];
    expect(yardReachable(yard, { siteBoundary: site, access: 'south', groundBlockers: blockers(1.5) })).toBe(true);
    expect(yardReachable(yard, { siteBoundary: site, access: 'south', groundBlockers: blockers(0.8) })).toBe(false);
    expect(yardReachable(yard, { siteBoundary: site, access: 'south', groundBlockers: [{ x: 0, y: 8, w: 20, h: 4 }] })).toBe(false);
  });
});

describe('Task 154: determinism + DXF', () => {
  it('repeated yard generation is byte-identical (plans + DXF)', () => {
    expect(fingerprint(run(uiDefault(true)).candidates)).toBe(fingerprint(run(uiDefault(true)).candidates));
    const [, site, building, seed] = SITES[7];
    expect(fingerprint(run(mk(site, building, seed, true)).candidates)).toBe(fingerprint(run(mk(site, building, seed, true)).candidates));
  });
  it('yard DXF keeps the frozen R12 profile ($ACADVER AC1009) and validates', () => {
    const { dxf, validation } = exportDXF(run(uiDefault(true)).bestCandidate!, 'yard');
    expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    expect((dxf.match(/\$ACADVER/g) ?? []).length).toBe(1);
    expect(validation.valid ?? true).toBe(true);
  });
});
