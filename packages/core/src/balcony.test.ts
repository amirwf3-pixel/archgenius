/**
 * Task 152 — bounded balcony core correction.
 *
 * Contract under test (hasBalcony=true uses the EXISTING balcony program:
 * target 4 m², min 2 m², minWidth 1.2 m — programming/program.ts):
 *   1. The generated balcony is sized from that program (≈ 4 m²), never the leftover band.
 *   2. It never absorbs the band: every other room on its floor is identical to hasBalcony=false.
 *   3. It has exactly one real door from adjacent circulation / a habitable room.
 *   4. A balcony that cannot be bounded yields the existing deterministic INFEASIBLE result
 *      (BALCONY_OVERSIZED / BALCONY_NO_ACCESS are HARD).
 *   5. hasBalcony=false (or omitted) is unchanged.
 *   6. Generation is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createProject, generate, exportDXF, validateCandidate } from './pipeline.js';
import { getTypicalArea } from './programming/program.js';
import { validateBalconies, balconyAreaCap, BALCONY_ACCESS_PARTNER_TYPES } from './validation/balcony.js';
import { buildStressCases } from './stress/matrix.js';
import type { ProjectInput } from './model/project.js';
import type { LayoutCandidate } from './model/layout.js';

/** The web UI's default project input (App.tsx DEFAULT_STATE), with a balcony switch. */
function uiDefault(hasBalcony: boolean | undefined): ProjectInput {
  const building: any = {
    type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
    kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasElevator: false, hasStorage: true, hasYard: false,
  };
  if (hasBalcony !== undefined) building.hasBalcony = hasBalcony;
  return {
    name: 'balcony-t152',
    site: {
      shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8, northRotationDeg: 0,
      setbacks: { north: 2, south: 3, east: 2, west: 2 },
      jurisdiction: 'Tehran-Municipality-Default', city: 'Tehran', parkingLayout: 'auto',
    },
    building,
    deterministic: true, seed: 42,
  } as ProjectInput;
}

const oneFloor = (): ProjectInput => {
  const p = uiDefault(true);
  (p.building as any).floors = 1; (p.building as any).bedrooms = 2; (p.building as any).hasStair = false;
  return p;
};

const run = (p: ProjectInput) => generate(createProject(p), { allStrategies: true });
const balconies = (c: LayoutCandidate) =>
  c.floors.flatMap(f => f.spaces.filter(s => s.type === 'balcony').map(s => ({ f, s })));
const fingerprint = (cands: LayoutCandidate[]) => {
  const h = createHash('sha256');
  for (const c of cands) { h.update(JSON.stringify(c.floors)); h.update(exportDXF(c, 'x').dxf); }
  return h.digest('hex');
};

const PROG = getTypicalArea('balcony');
const CAP = balconyAreaCap(PROG.target, PROG.min);

describe('Task 152: balcony program is the existing one', () => {
  it('default balcony program: target 4 m², min 2 m², minWidth 1.2 m; cap = existing M4 formula', () => {
    expect(PROG.target).toBe(4.0);
    expect(PROG.min).toBe(2.0);
    expect(PROG.minWidth).toBe(1.2);
    expect(CAP).toBeCloseTo(7.0, 9); // max(1.1·2, 1.75·4)
  });
});

describe('Task 152: bounded balcony geometry', () => {
  const on = run(uiDefault(true));
  const off = run(uiDefault(false));

  it('UI default (2F): feasible, one upper-floor balcony ≈ 4 m² within program bounds', () => {
    expect(on.bestCandidate).not.toBeNull();
    for (const c of on.candidates) {
      const b = balconies(c);
      expect(b.length).toBe(1);
      const { f, s } = b[0];
      expect(f.level).toBe(1);
      expect(s.area).toBeCloseTo(PROG.target, 1);
      expect(s.area).toBeGreaterThanOrEqual(PROG.min - 1e-6);
      expect(s.area).toBeLessThanOrEqual(CAP + 1e-6);
      expect(Math.min(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual(PROG.minWidth! - 1e-6);
    }
  });

  it('does not consume the remaining band: every non-balcony room equals the hasBalcony=false plan', () => {
    expect(on.candidates.length).toBe(off.candidates.length);
    on.candidates.forEach((c, i) => {
      const o = off.candidates[i];
      expect(c.metadata.strategy).toBe(o.metadata.strategy);
      c.floors.forEach((f, li) => {
        const rects = (fl: typeof f) => fl.spaces.filter(s => s.type !== 'balcony')
          .map(s => `${s.id}:${s.rect.x},${s.rect.y},${s.rect.w},${s.rect.h}`).sort();
        expect(rects(f)).toEqual(rects(o.floors[li]));
      });
      const upper = c.floors[1];
      const occupied = upper.spaces.reduce((a, s) => a + s.area, 0);
      const occupiedOff = o.floors[1].spaces.reduce((a, s) => a + s.area, 0);
      expect(occupied - occupiedOff).toBeCloseTo(balconies(c)[0].s.area, 6); // only the balcony was added
    });
  });

  it('single-floor balcony (gallery path) is also bounded', () => {
    const r = run(oneFloor());
    expect(r.bestCandidate).not.toBeNull();
    for (const c of r.candidates) for (const { s } of balconies(c)) {
      expect(s.area).toBeGreaterThanOrEqual(PROG.min - 1e-6);
      expect(s.area).toBeLessThanOrEqual(CAP + 1e-6);
    }
  });
});

describe('Task 152: balcony access door', () => {
  for (const [name, p] of [['UI default 2F', uiDefault(true)], ['1F', oneFloor()]] as const) {
    it(`${name}: exactly one real door from an adjacent circulation space / habitable room`, () => {
      const r = run(p);
      expect(r.candidates.length).toBeGreaterThan(0);
      for (const c of r.candidates) {
        for (const { f, s } of balconies(c)) {
          const doors = f.openings.filter(o => o.type !== 'window' && (o.spaceA === s.id || o.spaceB === s.id));
          expect(doors.length).toBe(1);
          const d = doors[0];
          expect(d.type).toBe('door');
          const wall = f.walls.find(w => w.id === d.wallId)!;
          expect(wall).toBeDefined();
          expect(wall.kind).not.toBe('exterior');
          const otherId = d.spaceA === s.id ? d.spaceB! : d.spaceA!;
          expect(wall.spaceIds).toContain(s.id);
          expect(wall.spaceIds).toContain(otherId);
          const other = f.spaces.find(x => x.id === otherId)!;
          expect(BALCONY_ACCESS_PARTNER_TYPES.has(other.type)).toBe(true);
          // no other room is reached THROUGH the balcony
          expect(f.openings.filter(o => o.type !== 'window' && (o.spaceA === s.id || o.spaceB === s.id)).length).toBe(1);
        }
        const vr = validateCandidate(c);
        expect(vr.findings.filter(x => String(x.code).startsWith('BALCONY_'))).toEqual([]);
        expect(vr.hard.length).toBe(0);
      }
    });
  }
  it('UI default: the upper-floor balcony opens from the corridor', () => {
    const c = run(uiDefault(true)).bestCandidate!;
    const { f, s } = balconies(c)[0];
    const d = f.openings.find(o => o.type === 'door' && (o.spaceA === s.id || o.spaceB === s.id))!;
    const other = f.spaces.find(x => x.id === (d.spaceA === s.id ? d.spaceB : d.spaceA))!;
    expect(other.type).toBe('corridor');
  });
});

describe('Task 152: balcony validation findings (HARD)', () => {
  const base = run(uiDefault(true)).bestCandidate!;
  it('clean balcony → no findings', () => {
    expect(validateBalconies(base)).toEqual([]);
  });
  it('balcony without a door → BALCONY_NO_ACCESS', () => {
    const c: LayoutCandidate = structuredClone(base);
    const { f, s } = balconies(c)[0];
    f.openings = f.openings.filter(o => !(o.type !== 'window' && (o.spaceA === s.id || o.spaceB === s.id)));
    const fs = validateBalconies(c);
    expect(fs.map(x => x.code)).toEqual(['BALCONY_NO_ACCESS']);
    expect(fs[0].severity).toBe('hard');
    expect(fs[0].entityIds).toEqual([s.id]);
  });
  it('balcony above the program cap → BALCONY_OVERSIZED', () => {
    const c: LayoutCandidate = structuredClone(base);
    const { s } = balconies(c)[0];
    s.area = 108.8; // the Task 151 defect
    const fs = validateBalconies(c);
    expect(fs.map(x => x.code)).toEqual(['BALCONY_OVERSIZED']);
    expect(fs[0].severity).toBe('hard');
  });
  it('candidates without balconies produce no balcony findings', () => {
    expect(validateBalconies(run(uiDefault(false)).bestCandidate!)).toEqual([]);
  });
});

describe('Task 152: an unboundable balcony is a deterministic INFEASIBLE, never an oversized plan', () => {
  // Stress case whose only legacy "feasible" plan carried a 9.7 m² doorless balcony.
  const input = (): ProjectInput => {
    const c = buildStressCases().find(x => x.id === 'L6--S0-1bd-open')!;
    const p = structuredClone(c.input);
    (p.building as any).hasBalcony = true;
    return p;
  };
  it('returns INFEASIBLE (HARD_RULE_VIOLATION) citing BALCONY_OVERSIZED, identically on repeat', () => {
    const a = run(input());
    const b = run(input());
    expect(a.bestCandidate).toBeNull();
    expect(a.candidates).toEqual([]);
    expect(a.infeasible!.code).toBe('HARD_RULE_VIOLATION');
    expect(a.infeasible!.explanation).toContain('BALCONY_OVERSIZED');
    expect(b.infeasible!.explanation).toBe(a.infeasible!.explanation);
    expect(b.infeasible!.attempts).toEqual(a.infeasible!.attempts);
  });
  it('the same site without a balcony is still feasible (failure is balcony-specific)', () => {
    const p = input();
    (p.building as any).hasBalcony = false;
    expect(run(p).bestCandidate).not.toBeNull();
  });
});

describe('Task 152: hasBalcony=false regression + determinism', () => {
  it('hasBalcony=false and omitted produce identical plans + DXF with no balcony', () => {
    const f = run(uiDefault(false));
    const u = run(uiDefault(undefined));
    expect(fingerprint(f.candidates)).toBe(fingerprint(u.candidates));
    for (const c of f.candidates) expect(balconies(c)).toEqual([]);
  });
  it('repeated balcony generation is byte-identical (plans + DXF)', () => {
    expect(fingerprint(run(uiDefault(true)).candidates)).toBe(fingerprint(run(uiDefault(true)).candidates));
    expect(fingerprint(run(oneFloor()).candidates)).toBe(fingerprint(run(oneFloor()).candidates));
  });
  it('balcony DXF keeps the frozen R12 profile ($ACADVER AC1009)', () => {
    const { dxf, validation } = exportDXF(run(uiDefault(true)).bestCandidate!, 'balcony');
    expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    expect(validation.valid ?? true).toBe(true);
  });
});
