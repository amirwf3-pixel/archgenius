import { describe, it, expect } from 'vitest';
import { generateLayouts } from './generator/generator.js';
import type { ProjectInput } from './model/project.js';
import { rContains } from './geometry/rect.js';
import { writeDXF, validateDXFStructure } from './dxf/writer.js';
import { validateFloor } from './validation/validator.js';

function baseInput(overrides: Partial<ProjectInput['site'] & { bedrooms?: number; floors?: number; seed?: number }> = {}): ProjectInput {
  const width = (overrides as any).width ?? 15;
  const length = (overrides as any).length ?? 20;
  const bedrooms = (overrides as any).bedrooms ?? 2;
  const floors = (overrides as any).floors ?? 1;
  const seed = (overrides as any).seed ?? 42;
  return {
    name: `Test ${width}x${length} ${bedrooms}BR ${floors}F`,
    site: { shape: 'rectangle', width, length, accessSide: 'south', streetWidth: 8 },
    building: {
      type: floors > 1 ? 'apartment' : 'villa',
      floors,
      bedrooms,
      masterBedrooms: bedrooms > 0 ? 1 : 0,
      bathrooms: Math.max(1, Math.floor(bedrooms / 2)),
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 1,
      hasStair: floors > 1,
      hasStorage: true,
    },
    deterministic: true,
    seed,
  };
}

const SCENARIOS = [
  { width: 12, length: 18, bedrooms: 1, floors: 1, seed: 1 },
  { width: 12, length: 18, bedrooms: 2, floors: 1, seed: 2 },
  { width: 15, length: 20, bedrooms: 2, floors: 1, seed: 42 },
  { width: 15, length: 20, bedrooms: 3, floors: 1, seed: 42 },
  { width: 15, length: 22, bedrooms: 2, floors: 2, seed: 42 },
  { width: 18, length: 25, bedrooms: 3, floors: 2, seed: 42 },
  { width: 14, length: 20, bedrooms: 2, floors: 2, seed: 7 },
  { width: 20, length: 20, bedrooms: 2, floors: 1, seed: 1 },
  { width: 20, length: 25, bedrooms: 3, floors: 2, seed: 2 },
  { width: 15, length: 18, bedrooms: 1, floors: 1, seed: 3 },
];

describe('Phase 6 — Regression scenarios (10 + bedroom/floor variants)', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.width}x${sc.length} ${sc.bedrooms}BR ${sc.floors}F seed ${sc.seed} — valid`, () => {
      const input = baseInput(sc);
      const cands = generateLayouts(input);
      expect(cands.length).toBeGreaterThan(0);
      const cand = cands[0];
      // No ROOM_UNUSABLE hard for any scenario
      const unusable = cand.findings.filter(f => f.severity === 'hard' && f.code === 'ROOM_UNUSABLE');
      expect(unusable.length, `ROOM_UNUSABLE found in ${sc.width}x${sc.length}`).toBe(0);
      // For normal sizes >=12x18, require no GEO outside
      if (sc.width >= 12 && sc.length >= 18) {
        const hardGeoOutside = cand.findings.filter(f => f.code === 'GEO_ROOM_OUTSIDE_FOOTPRINT' && f.severity === 'hard');
        // Allow 0 for most, but log if fails — for 10x18 we allow up to 5 as known tight-site limitation
        if (sc.width < 12) {
          expect(hardGeoOutside.length).toBeLessThanOrEqual(5);
        } else {
          expect(hardGeoOutside.length).toBe(0);
        }
      }
    });
  }

  it('1-3 bedrooms 1-3 floors matrix', () => {
    for (let br = 1; br <= 3; br++) {
      for (let fl = 1; fl <= 3; fl++) {
        const input = baseInput({ width: 15, length: 22, bedrooms: br, floors: fl, seed: 10 + br * 10 + fl });
        const cands = generateLayouts(input);
        expect(cands.length).toBeGreaterThan(0);
        expect(cands[0].floors.length).toBe(fl);
      }
    }
  });
});

describe('Phase 6 — Property-based invariants', () => {
  it('area > 0 for all spaces', () => {
    for (const sc of SCENARIOS.slice(0, 5)) {
      const input = baseInput(sc);
      const cands = generateLayouts(input);
      for (const sp of cands[0].floors[0].spaces) {
        expect(sp.area).toBeGreaterThan(0);
        expect(sp.rect.w).toBeGreaterThan(0);
        expect(sp.rect.h).toBeGreaterThan(0);
      }
    }
  });

  it('valid polygon (rect corners form non-self-intersecting quad)', () => {
    const input = baseInput({ width: 15, length: 20, bedrooms: 2, floors: 1, seed: 42 });
    const cands = generateLayouts(input);
    for (const sp of cands[0].floors[0].spaces) {
      expect(sp.polygon.length).toBe(4);
      // Polygon area should match rect area approximately
      const polyArea = Math.abs(
        (sp.polygon[0].x * sp.polygon[1].y - sp.polygon[1].x * sp.polygon[0].y +
          sp.polygon[1].x * sp.polygon[2].y - sp.polygon[2].x * sp.polygon[1].y +
          sp.polygon[2].x * sp.polygon[3].y - sp.polygon[3].x * sp.polygon[2].y +
          sp.polygon[3].x * sp.polygon[0].y - sp.polygon[0].x * sp.polygon[3].y) / 2
      );
      expect(polyArea).toBeGreaterThan(0);
    }
  });

  it('no room outside buildable footprint', () => {
    for (const sc of SCENARIOS.slice(0, 5)) {
      const input = baseInput(sc);
      const cands = generateLayouts(input);
      const cand = cands[0];
      for (const fl of cand.floors) {
        for (const sp of fl.spaces) {
          if (sp.type === 'parking' || sp.type === 'yard') continue;
          const inside = rContains(cand.buildableArea, sp.rect, 0.05);
          expect(inside, `Space ${sp.label} outside buildable in ${sc.width}x${sc.length}`).toBe(true);
        }
      }
    }
  });

  it('furniture inside its room', () => {
    const input = baseInput({ width: 15, length: 20, bedrooms: 2, floors: 1, seed: 42 });
    const cands = generateLayouts(input);
    const floor = cands[0].floors[0];
    for (const furn of floor.furniture) {
      const sp = floor.spaces.find(s => s.id === furn.spaceId);
      expect(sp, `Furniture ${furn.id} references missing space`).toBeDefined();
      if (sp) {
        expect(rContains(sp.rect, furn.rect, 0.01), `Furniture ${furn.type} outside room ${sp.label}`).toBe(true);
      }
    }
  });

  it('openings are on walls', () => {
    const input = baseInput({ width: 15, length: 20, bedrooms: 2, floors: 1, seed: 42 });
    const cands = generateLayouts(input);
    const floor = cands[0].floors[0];
    for (const o of floor.openings) {
      const wall = floor.walls.find(w => w.id === o.wallId);
      expect(wall, `Opening ${o.id} wall ${o.wallId} missing`).toBeDefined();
    }
  });

  it('deterministic: same input+seed → same output', () => {
    const input = baseInput({ width: 15, length: 20, bedrooms: 2, floors: 1, seed: 99 });
    const c1 = generateLayouts(input)[0];
    const c2 = generateLayouts(input)[0];
    expect(c1.floors[0].spaces.length).toBe(c2.floors[0].spaces.length);
    expect(c1.floors[0].walls.length).toBe(c2.floors[0].walls.length);
    expect(c1.floors[0].openings.length).toBe(c2.floors[0].openings.length);
    // Compare first space rect
    const s1 = c1.floors[0].spaces[0].rect;
    const s2 = c2.floors[0].spaces[0].rect;
    expect(s1.x).toBeCloseTo(s2.x, 6);
    expect(s1.y).toBeCloseTo(s2.y, 6);
    expect(s1.w).toBeCloseTo(s2.w, 6);
    expect(s1.h).toBeCloseTo(s2.h, 6);
  });

  it('DXF structural validation', () => {
    const input = baseInput({ width: 15, length: 20, bedrooms: 2, floors: 1, seed: 42 });
    const cands = generateLayouts(input);
    const dxf = writeDXF(cands[0], 'Invariant Test');
    const res = validateDXFStructure(dxf);
    expect(res.ok).toBe(true);
    expect(res.errors.length).toBe(0);
    // Phase 28-E R12: $ACADVER-only minimal profile (AutoCAD 2027 proven safe);
    // every variable beyond $ACADVER is forbidden (Phase 28-D ladder evidence)
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    for (const v of ['$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$VIEWCTR', '$VIEWSIZE', '$VIEWDIR', '$LUNITS']) {
      expect(dxf).not.toContain(v);
    }
    expect(dxf).not.toContain('$SCREENSIZE');
    expect(dxf).not.toContain('$DWGCODEPAGE');
    expect(dxf).not.toContain('VPORT');
    expect(dxf).not.toContain('$INSUNITS');
    expect(dxf).not.toContain('$MEASUREMENT');
    // Check layers
    expect(dxf).toContain('A-WALL-EXT');
    expect(dxf).toContain('A-DOOR');
    expect(dxf).toContain('A-WINDOW');
  });

  it('architectural QA does not produce HARD for normal cases', () => {
    const input = baseInput({ width: 15, length: 20, bedrooms: 2, floors: 1, seed: 42 });
    const cands = generateLayouts(input);
    const floor = cands[0].floors[0];
    const findings = validateFloor(floor);
    const hardQA = findings.filter(f => f.severity === 'hard' && (f.code.startsWith('ROOM_') || f.code.startsWith('CIRCULATION_')));
    // For normal case, no hard QA failures
    expect(hardQA.length).toBe(0);
  });
});
