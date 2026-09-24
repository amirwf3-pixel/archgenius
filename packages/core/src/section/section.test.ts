import { describe, it, expect } from 'vitest';
import { generate, createProject, exportDXF } from '../pipeline.js';
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import { writeDXF, validateDXFStructure } from '../dxf/writer.js';
import { LAYERS, SECTION_LAYERS } from '../dxf/layers.js';
import { computeSection, validateSection, defaultSectionCuts, buildSections } from './section.js';

/**
 * Task 35 — Multi-section details. Sections are derived only from
 * candidate.floors; DXF section output is opt-in so the default drawing is
 * byte-identical (the golden DXF hashes elsewhere pin that too).
 */
function input(floors: number, lift = false): ProjectInput {
  return {
    name: 'section', country: 'IR', deterministic: true, seed: 42,
    site: {
      shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8,
      setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
    },
    building: {
      type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
      kitchenType: 'closed', parkingSpaces: 1, hasStair: true, floors,
      ...(lift ? { hasElevator: true } : {}),
    },
  } as ProjectInput;
}
function best(inp: ProjectInput): LayoutCandidate {
  const c = generate(createProject(inp), {}).bestCandidate;
  if (!c) throw new Error('expected a feasible candidate');
  return c;
}
const F2 = best(input(2));
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);
const clone = (c: LayoutCandidate) => structuredClone(c) as LayoutCandidate;

describe('section geometry — derived from the model', () => {
  const [A] = buildSections(F2);
  const flight0 = F2.floors[0].stairs[0].flights[0];

  it('default cut A runs along the first flight and yields no findings', () => {
    expect(A.cut.id).toBe('A');
    expect(A.findings).toEqual([]);
    expect(A.extent).not.toBeNull();
  });

  it('stair profile: riserCount risers of riserHeight and treadCount treads of treadDepth from startPoint', () => {
    const p = A.flights.find((f) => f.flightId === flight0.id)!;
    expect(p).toBeDefined();
    expect(p.points.length).toBe(1 + flight0.riserCount + flight0.treadCount);
    expect(p.points[0]).toEqual({ u: flight0.startPoint.y, z: F2.floors[0].elevation });
    for (let i = 1; i < p.points.length; i++) {
      const du = Math.abs(p.points[i].u - p.points[i - 1].u), dz = p.points[i].z - p.points[i - 1].z;
      // Each segment is either a riser (vertical) or a tread (horizontal).
      expect((du < 1e-6 && Math.abs(dz - flight0.riserHeight) < 1e-5) || (dz === 0 && Math.abs(du - flight0.treadDepth) < 1e-5)).toBe(true);
    }
    const top = p.points[p.points.length - 1];
    expect(top.z).toBeCloseTo(flight0.riserCount * flight0.riserHeight, 5);
    expect(top.u).toBeCloseTo(flight0.endPoint.y, 5);
  });

  it('landing is drawn at the top of the flight below it', () => {
    const top = A.flights[0].points[A.flights[0].points.length - 1];
    expect(A.landings.length).toBeGreaterThan(0);
    expect(A.landings[0].z).toBeCloseTo(top.z, 5);
  });

  it('only flights rising to an existing floor are profiled (none on the top floor)', () => {
    const top = F2.floors[F2.floors.length - 1].level;
    expect(A.flights.every((f) => f.floor !== top)).toBe(true);
  });

  it('cut walls span their storey; openings split the band at sill/head from the model', () => {
    for (const w of A.walls) {
      const fl = F2.floors.find((f) => f.level === w.floor)!;
      const opened = A.openings.filter((o) => o.wallId === w.wallId);
      const covered = [...w.solids, ...opened.map((o) => o.rect)].reduce((s, r) => s + (r.z1 - r.z0), 0);
      expect(covered).toBeCloseTo(fl.floorHeight, 5);
      for (const o of opened) {
        const src = fl.openings.find((x) => x.id === o.openingId)!;
        expect(o.rect.z0).toBeCloseTo(fl.elevation + src.sill, 5);
        expect(o.rect.z1).toBeCloseTo(fl.elevation + src.sill + src.height, 5);
      }
    }
    expect(A.openings.length).toBeGreaterThan(0);
  });

  it('level lines at each floor elevation plus the top of the highest cut storey', () => {
    const zs = A.levels.map((l) => l.z);
    for (const f of F2.floors) expect(zs).toContain(f.elevation);
    const last = F2.floors[F2.floors.length - 1];
    expect(zs).toContain(last.elevation + last.floorHeight);
  });

  it('multi-section defaults are deterministic; a lift adds cut C through the shaft on every floor', () => {
    expect(defaultSectionCuts(F2)).toEqual(defaultSectionCuts(best(input(2))));
    expect(defaultSectionCuts(F2).map((c) => c.id)).toEqual(['A', 'B']);
    const lift = best(input(2, true));
    const secs = buildSections(lift);
    expect(secs.map((d) => d.cut.id)).toEqual(['A', 'B', 'C']);
    const C = secs[2];
    expect(C.findings).toEqual([]);
    expect(new Set(C.lifts.map((l) => l.floor)).size).toBe(lift.floors.length);
  });
});

describe('section validation — invalid / missing section geometry', () => {
  it('invalid cut', () => {
    expect(codes(validateSection(F2, { id: 'X', axis: 'x', at: Number.NaN }))).toEqual(['SECTION_INVALID_CUT']);
    expect(codes(validateSection(F2, { id: '', axis: 'x', at: 5 }))).toEqual(['SECTION_INVALID_CUT']);
    expect(codes(validateSection(F2, { id: 'X', axis: 'z' as never, at: 5 }))).toEqual(['SECTION_INVALID_CUT']);
  });

  it('cut outside the building', () => {
    const d = computeSection(F2, { id: 'X', axis: 'x', at: -50 });
    expect(codes(d.findings)).toEqual(['SECTION_CUT_OUTSIDE_BUILDING']);
    expect(d.extent).toBeNull();
  });

  it('cut running inside a wall is rejected (ambiguous)', () => {
    const w = F2.floors[0].walls.find((x) => Math.abs(x.start.x - x.end.x) < 1e-9 && Math.abs(x.start.y - x.end.y) > 1)!;
    expect(codes(validateSection(F2, { id: 'X', axis: 'x', at: w.start.x }))).toContain('SECTION_CUT_ALONG_WALL');
  });

  it('missing / non-positive storey height and inconsistent elevations', () => {
    const a = clone(F2); a.floors[1].floorHeight = 0;
    expect(codes(validateSection(a, { id: 'A', axis: 'x', at: 9 }))).toContain('SECTION_LEVEL_INVALID');
    const b = clone(F2); b.floors[1].elevation = 2.5;
    expect(codes(validateSection(b, { id: 'A', axis: 'x', at: 9 }))).toContain('SECTION_LEVEL_INVALID');
  });

  it('stair rise not matching the storey height', () => {
    const cut = defaultSectionCuts(F2)[0];
    const c = clone(F2); c.floors[0].stairs[0].flights[0].riserHeight *= 1.1;
    expect(codes(validateSection(c, cut))).toContain('SECTION_STAIR_RISE_MISMATCH');
  });

  it('cut opening that does not fit the storey', () => {
    const [A] = buildSections(F2);
    const id = A.openings[0].openingId;
    const c = clone(F2);
    for (const f of c.floors) for (const o of f.openings) if (o.id === id) o.height = 5;
    expect(codes(validateSection(c, A.cut))).toContain('SECTION_OPENING_OUT_OF_STOREY');
  });

  it('flight cut across its run is reported (advisory), never silently dropped', () => {
    const fl = F2.floors[0].stairs[0].flights[0];
    const across = fl.direction === 'north' || fl.direction === 'south'
      ? { id: 'X', axis: 'y' as const, at: fl.footprint.y + fl.footprint.h / 2 }
      : { id: 'X', axis: 'x' as const, at: fl.footprint.x + fl.footprint.w / 2 };
    const fs = validateSection(F2, across);
    expect(fs.filter((f) => f.code === 'SECTION_STAIR_NOT_PROFILED').every((f) => f.severity === 'advisory')).toBe(true);
    expect(codes(fs)).toContain('SECTION_STAIR_NOT_PROFILED');
    expect(fs.some((f) => f.severity === 'hard')).toBe(false);
  });

  it('no floors, duplicate section ids', () => {
    const c = clone(F2); c.floors = [];
    expect(codes(validateSection(c, { id: 'A', axis: 'x', at: 1 }))).toEqual(['SECTION_NO_FLOORS']);
    const cut = defaultSectionCuts(F2)[0];
    const d = buildSections(F2, [cut, { ...cut }]);
    expect(codes(d[1].findings)).toContain('SECTION_INVALID_CUT');
  });
});

describe('section DXF — opt-in, frozen R12 profile', () => {
  it('default output is unchanged: sections off / false / [] are byte-identical and contain no A-SECT', () => {
    const base = writeDXF(F2, 'P');
    expect(writeDXF(F2, 'P', { sections: false })).toBe(base);
    expect(writeDXF(F2, 'P', { sections: [] })).toBe(base);
    expect(base.includes('A-SECT')).toBe(false);
  });

  it('INTEGRATION: canonical 18x25 F2 → sections → valid, deterministic AC1009 DXF', () => {
    const { dxf, validation } = exportDXF(F2, 'P', { sections: true });
    expect(validation.ok).toBe(true);
    expect(validateDXFStructure(dxf).errors).toEqual([]);
    expect(dxf).toBe(exportDXF(F2, 'P', { sections: true }).dxf);

    // Header: $ACADVER = AC1009 only.
    const header = dxf.slice(0, dxf.indexOf('ENDSEC'));
    expect(header.match(/\$[A-Z]+/g)).toEqual(['$ACADVER']);
    expect(header).toContain('AC1009');

    // LAYER table = default table + the 7 section layers.
    const count = (s: string) => { const L = s.split('\r\n'); const i = L.findIndex((v, k) => v === 'LAYER' && L[k - 2] === 'TABLE'); return Number(L[i + 2]); };
    expect(count(dxf)).toBe(count(writeDXF(F2, 'P')) + SECTION_LAYERS.length);
    expect(SECTION_LAYERS.every((l) => !LAYERS.some((b) => b.name === l.name))).toBe(true);

    // Section entities: LINE / POLYLINE(VERTEX/SEQEND) / TEXT only, on A-SECT-* layers.
    const L = dxf.split('\r\n');
    const types = new Set<string>(); const layers = new Set<string>();
    let wallMinX = Infinity;
    for (let i = L.indexOf('ENTITIES'); i < L.length - 3; i++) {
      if (L[i] !== '0' || L[i + 2].trim() !== '8' || !L[i + 3].startsWith('A-SECT')) continue;
      types.add(L[i + 1]); layers.add(L[i + 3]);
      if (L[i + 1] === 'VERTEX' && L[i + 3] === 'A-SECT-WALL') wallMinX = Math.min(wallMinX, Number(L[i + 5]) / 1000);
    }
    expect([...types].every((t) => ['LINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'TEXT'].includes(t))).toBe(true);
    for (const n of ['A-SECT-WALL', 'A-SECT-OPENING', 'A-SECT-STAIR', 'A-SECT-LEVEL', 'A-SECT-TEXT', 'A-SECT-MARK']) expect(layers.has(n)).toBe(true);
    // Sections are placed clear of (east of) the plans.
    const planMaxX = Math.max(...F2.floors.map((f) => f.footprint.x + f.footprint.w));
    expect(wallMinX).toBeGreaterThan(planMaxX);
  });

  it('an invalid requested section is refused, never exported silently', () => {
    expect(() => writeDXF(F2, 'P', { sections: [{ id: 'X', axis: 'x', at: -50 }] })).toThrow(/SECTION_CUT_OUTSIDE_BUILDING/);
  });
});
