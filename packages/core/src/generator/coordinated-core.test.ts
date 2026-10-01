/**
 * P5 — coordinated multi-floor rectangle planning (GenerateLayoutsOptions.coordinatedRectPlanner
 * on 2+ floor rectangle sites): ONE pre-placement plan (frame corridor line, stair cell,
 * elevator cell, CoreAnchors) shared by every floor; alignHallToAnchor only validates; any
 * floor that cannot fit the plan discards the variant; adoption only through
 * adoptCoordinatedCoreVariant. Cases are the existing benchmark / sweep inputs.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, adoptCoordinatedCoreVariant } from './generator.js';
import { benchmarkInputs, sweepInputs } from '../regression/layout-cases.js';
import { COORDINATED_CORE_APPLIED, planCoordinatedCore } from '../layout/coordinated-rect.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { PlacedSpec } from '../layout/placer.js';
import type { LayoutCandidate, CandidateStrategy } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Rect } from '../geometry/rect.js';

const S: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const ADOPTED = 'P5: coordinated multi-floor core variant adopted';
const ALL = [...benchmarkInputs(), ...sweepInputs()];
const inputOf = (id: string): ProjectInput => structuredClone(ALL.find(b => b.id === id)!.input);
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? undefined : v));
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const legacy = (id: string) => generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true });
const on = (id: string) => generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: true });
const isAdopted = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(ADOPTED));
const sameR = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const inside = (r: Rect, o: Rect, e = 1e-3) =>
  r.x >= o.x - e && r.y >= o.y - e && r.x + r.w <= o.x + o.w + e && r.y + r.h <= o.y + o.h + e;
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-6 && h > 1e-6 ? w * h : 0;
};
const floorSpecs = (input: ProjectInput): PlacedSpec[][] =>
  allocateBuildingProgram(input.building, input.building.floors).map((al, l) =>
    programForFloor(input.building, l, false, al).map((s, k) => ({ ...s, placedId: `${s.type}-${l}-${k}`, placedLabel: s.type }) as PlacedSpec));

const TWO = 'rect/b2/42';                 // 2 floors, south access
const THREE = 'R16x26--U2-3f5bd';         // 3 floors (sweep)
const LIFT = 'rect/b3lift/42';            // 3 floors + elevator
const LIFT_EAST = 'rectE/b3lift/42';

describe('P5 — option off', () => {
  it('omitted / false are byte-identical to legacy on 2- and 3-floor rectangles', () => {
    for (const id of [TWO, THREE, LIFT]) {
      const ref = strip(generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true }));
      expect(strip(generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: false }))).toBe(ref);
      expect(strip(generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: undefined }))).toBe(ref);
      const plain = strip(generateLayouts(inputOf(id), S));
      expect(strip(generateLayouts(inputOf(id), S, { coordinatedRectPlanner: false }))).toBe(plain);
    }
  });
});

describe('P5 — coordinated multi-floor path', () => {
  const coreOf = (c: LayoutCandidate) => c.floors.map(f => ({
    hall: f.spaces.find(s => s.type === 'stair-hall')!.rect,
    stair: f.stairs[0],
  }));

  it('2-floor rectangle: adopted, one stair cell / stair on both floors', () => {
    for (const [id, st] of [[TWO, 'functional-circulation'], [TWO, 'alternative-zoning'], ['rect/b2/7', 'alternative-zoning']] as const) {
      const c = byStrategy(on(id), st);
      expect(isAdopted(c), `${id} ${st}`).toBe(true);
      expect(c.valid).toBe(true);
      expect(c.floors).toHaveLength(2);
      const core = coreOf(c);
      expect(sameR(core[0].hall, core[1].hall)).toBe(true);
      expect(core[1].stair.footprint).toEqual(core[0].stair.footprint);
      expect(core[1].stair.type).toBe(core[0].stair.type);
      expect(core[1].stair.flights.map(f => f.riserCount)).toEqual(core[0].stair.flights.map(f => f.riserCount));
    }
  });

  it('3-floor rectangle: adopted, the stair core stacks on all three floors', () => {
    const c = byStrategy(on(THREE), 'functional-circulation');
    expect(isAdopted(c)).toBe(true);
    expect(c.floors).toHaveLength(3);
    const core = coreOf(c);
    for (const k of [1, 2]) {
      expect(sameR(core[k].hall, core[0].hall)).toBe(true);
      expect(core[k].stair.footprint).toEqual(core[0].stair.footprint);
    }
  });

  it('shared corridor line: every floor keeps the frame corridor at the same offset and width', () => {
    for (const id of [TWO, THREE]) {
      const c = on(id).find(isAdopted)!;
      const note = c.explanations.find(e => e.startsWith(COORDINATED_CORE_APPLIED) && /corridor y=/.test(e))!;
      const [, off, width] = note.match(/corridor y=([\d.]+) \(([\d.]+) m\)/)!;
      for (const f of c.floors) {
        const line = f.spaces.filter(s => s.type === 'corridor' && Math.abs(s.rect.y - Number(off)) < 0.011 && Math.abs(s.rect.h - Number(width)) < 0.011);
        expect(line.length, `level ${f.level}`).toBeGreaterThan(0);
      }
      expect(c.floors.every(f => c.explanations.some(e => e.startsWith(`${COORDINATED_CORE_APPLIED} level ${f.level} `)))).toBe(true);
    }
  });

  it('upper floors are placed from the plan with their whole programme', () => {
    const c = byStrategy(on(THREE), 'functional-circulation');
    const req = (c as any).programRequirements as { level: number; byType: Record<string, number> }[];
    for (const f of c.floors.filter(f => f.level > 0)) {
      const byType = req.find(r => r.level === f.level)!.byType;
      for (const [t, n] of Object.entries(byType)) {
        expect(f.spaces.filter(s => s.type === t).length, `level ${f.level} ${t}`).toBeGreaterThanOrEqual(n);
      }
      expect(f.spaces.some(s => s.type === 'bedroom' || s.type === 'master-bedroom')).toBe(true);
    }
    expect(c.findings.some(f => f.code === 'ARCH_PROGRAM_UNPLACED')).toBe(false);
  });

  it('elevator continuity: one elevator cell beside the stair on the corridor, pinned on every floor', () => {
    const input = inputOf(LIFT);
    const fs = floorSpecs(input);
    const slice: Rect = { x: 2, y: 1.5, w: 14, h: 20.5 };
    const plan = planCoordinatedCore({ slice, access: 'south', strategy: 'functional-circulation', floorSpecs: fs })!;
    expect(plan).not.toBeNull();
    expect(plan.stair).not.toBeNull();
    expect(plan.elevator).not.toBeNull();
    expect(plan.elevator!.side).toBe(plan.stair!.side);
    // beside the stair cell, same corridor edge
    expect(plan.elevator!.rect.x).toBeCloseTo(plan.stair!.rect.x + plan.stair!.rect.w, 9);
    expect(plan.elevator!.rect.y).toBeCloseTo(plan.stair!.rect.y, 9);
    fs.forEach((specs, l) => {
      const z = plan.floorZones[l];
      if (specs.some(s => s.type === 'elevator-hall')) expect(z.elevatorPocket).toEqual(plan.elevator!.rect);
      if (specs.some(s => s.type === 'stair-hall')) expect(z.zones.service[0]).toEqual(plan.stair!.rect);
      // one corridor line on every floor
      expect(z.corridors[0]).toEqual(plan.floorZones[0].corridors[0]);
    });
    // generated with the option: whichever candidate stands keeps the shaft on one cell
    for (const c of on(LIFT)) {
      const cells = c.floors.flatMap(f => f.spaces.filter(s => s.type === 'elevator-hall').map(s => s.rect));
      if (isAdopted(c)) for (const r of cells) expect(sameR(r, cells[0])).toBe(true);
      expect(c.floors.every(f => f.elevators.length === byStrategy(legacy(LIFT), c.metadata.strategy).floors[f.level].elevators.length)).toBe(true);
    }
  });

  it('repeated generation is deterministic', () => {
    for (const id of [TWO, THREE, LIFT]) {
      const a = strip(on(id)), b = strip(on(id)), c = strip(on(id));
      expect(b).toBe(a);
      expect(c).toBe(a);
    }
  });

  it('adopted candidates: no programme loss, no overlaps, nothing outside the buildable area', () => {
    let n = 0;
    for (const id of [TWO, THREE, 'R20x26--U1-2f4bd', 'R14x34--U2-3f5bd']) {
      const leg = legacy(id);
      for (const c of on(id).filter(isAdopted)) {
        n++;
        const l = byStrategy(leg, c.metadata.strategy);
        const buildable = (c as any).buildableRects as Rect[];
        for (const f of c.floors) {
          const lf = l.floors.find(x => x.level === f.level)!;
          for (const t of new Set(lf.spaces.map(s => s.type))) {
            if (t === 'corridor') continue;
            expect(f.spaces.filter(s => s.type === t).length, `${id} L${f.level} ${t}`)
              .toBeGreaterThanOrEqual(lf.spaces.filter(s => s.type === t).length);
          }
          expect(f.stairs.length).toBeGreaterThanOrEqual(lf.stairs.length);
          const sp = f.spaces.filter(s => s.rect && s.type !== 'parking');
          for (const s of sp) expect(buildable.some(b => inside(s.rect, b)), `${id} ${s.id}`).toBe(true);
          for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
            expect(overlap(sp[i].rect, sp[j].rect), `${sp[i].id}|${sp[j].id}`).toBeLessThan(1e-4);
          }
        }
        const hard = (x: LayoutCandidate) => x.findings.filter(f => f.severity === 'hard');
        const counts = (x: LayoutCandidate) => hard(x).reduce((m, f) => m.set(f.code, (m.get(f.code) ?? 0) + 1), new Map<string, number>());
        const lc = counts(l);
        for (const [code, k] of counts(c)) expect(k, code).toBeLessThanOrEqual(lc.get(code) ?? 0);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('P5 — fallback and guard', () => {
  it('impossible pinned core → the exact legacy candidate', () => {
    // no plan: a 5 m band cannot pocket the stair
    const fs = floorSpecs(inputOf(TWO));
    expect(planCoordinatedCore({ slice: { x: 0, y: 0, w: 5, h: 30 }, access: 'south', strategy: 'functional-circulation', floorSpecs: fs })).toBeNull();
    expect(planCoordinatedCore({ slice: { x: 0, y: 0, w: 14, h: 20 }, access: 'south', strategy: 'functional-circulation', floorSpecs: [fs[0]] })).toBeNull();
    // area-efficiency on rectE/b3lift: the ground-floor stair cannot stay on the plan's
    // cell, the build is discarded and the legacy candidate stands unchanged
    for (const id of [LIFT_EAST, 'rect14/b2/42', LIFT]) {
      const leg = legacy(id);
      for (const c of on(id).filter(x => !isAdopted(x))) {
        expect(strip(c)).toBe(strip(byStrategy(leg, c.metadata.strategy)));
      }
    }
    expect(isAdopted(byStrategy(on(LIFT_EAST), 'area-efficiency'))).toBe(false);
  });

  it('rejects core discontinuity and every P4 guard violation, returning the base unchanged', () => {
    const base = byStrategy(legacy(TWO), 'functional-circulation');
    const snap = strip(base);
    const variantOf = () => {
      const v = byStrategy(on(TWO), 'functional-circulation');
      v.explanations = v.explanations.filter(e => !e.startsWith(ADOPTED));
      return v;
    };
    expect(adoptCoordinatedCoreVariant(base, variantOf())).not.toBe(base); // control
    const hall = (v: LayoutCandidate, l: number) => v.floors[l].spaces.find(s => s.type === 'stair-hall')!;
    const mutations: [string, (v: LayoutCandidate) => void][] = [
      ['not coordinated', v => { v.explanations = v.explanations.filter(e => !e.startsWith(COORDINATED_CORE_APPLIED)); }],
      ['invalid', v => { v.valid = false; }],
      ['new HARD', v => { v.findings = [...v.findings, { code: 'STAIR_MISSING', severity: 'hard', message: 'x' } as any]; }],
      ['stair lost', v => { v.floors[1].stairs = []; }],
      ['stair invalid', v => { v.floors[1].stairs = v.floors[1].stairs.map(s => ({ ...s, valid: false })); }],
      ['stair hall off the core', v => { const h = hall(v, 1); h.rect = { ...h.rect, w: h.rect.w - 0.2 }; }],
      ['programme space lost', v => { v.floors[1].spaces = v.floors[1].spaces.filter(s => s.type !== 'bedroom'); }],
      ['floor lost', v => { v.floors = v.floors.slice(0, 1); }],
    ];
    for (const [name, mutate] of mutations) {
      const v = variantOf();
      mutate(v);
      expect(adoptCoordinatedCoreVariant(base, v), name).toBe(base);
    }
    expect(strip(base)).toBe(snap);
  });
});
