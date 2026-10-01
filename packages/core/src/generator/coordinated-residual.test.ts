/**
 * P6 — the coordinated frame's residual rear / side cuts (BuildingFrame.world.residualRear /
 * residualSide) integrated with applyFloorCompaction() and addYard(): the residual is
 * intentional open space — no room, core or parking rect in it, never inside a floor's
 * compacted envelope beyond the exterior-wall half-thickness — and a yard lands against the
 * frame, never inside it. A floor that violates it discards the coordinated variant (the next
 * family, then the unchanged legacy candidate). Cases are the existing benchmark / sweep inputs.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts } from './generator.js';
import { benchmarkInputs, sweepInputs } from '../regression/layout-cases.js';
import {
  COORDINATED_RESIDUAL_APPLIED, COORDINATED_RESIDUAL_RETRY, frameEnvelopeBound, frameResidual, residualEnvelopeOverlap, residualIntrusions,
} from '../layout/coordinated-rect.js';
import { deriveBuildingFrame } from '../layout/building-frame.js';
import { applyFloorCompaction, floorWallPad } from '../layout/compaction.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { PlacedSpec } from '../layout/placer.js';
import type { LayoutCandidate, CandidateStrategy } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Floor } from '../model/floor.js';
import type { Rect } from '../geometry/rect.js';

const S: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const ALL = [...benchmarkInputs(), ...sweepInputs()];
const inputOf = (id: string, yard = false): ProjectInput => {
  const inp = structuredClone(ALL.find(b => b.id === id)!.input);
  if (yard) inp.building = { ...inp.building, hasYard: true };
  return inp;
};
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? undefined : v));
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const legacy = (id: string, yard = false) => generateLayouts(inputOf(id, yard), S, { upperFloorFrontPrivate: true });
const on = (id: string, yard = false) => generateLayouts(inputOf(id, yard), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: true });
const isAdopted = (c: LayoutCandidate) => c.explanations.some(e => /^P[45]: coordinated .* adopted/.test(e));
const overlapArea = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-3 && h > 1e-3 ? w * h : 0;
};
const inside = (r: Rect, o: Rect, e = 1e-3) =>
  r.x >= o.x - e && r.y >= o.y - e && r.x + r.w <= o.x + o.w + e && r.y + r.h <= o.y + o.h + e;
const occupied = (f: Floor): Rect[] => [
  ...f.spaces.filter(s => s.type !== 'yard').map(s => s.rect),
  ...f.stairs.map(s => s.footprint),
  ...f.elevators.map(e => e.rect),
  ...(f.parkingStalls ?? []).map(p => p.rect),
  ...(f.parkingArea?.aisleRect ? [f.parkingArea.aisleRect] : []),
];

/**
 * Independent residual strips of a SOUTH-access coordinated candidate: the dimensions from
 * the P6 note, the position from the buildable rect (the street-side parking band never
 * moves the slice's rear / east edges): rear strip on the buildable's rear edge, side strip
 * on its east edge in front of the rear strip.
 */
function strips(c: LayoutCandidate): { rear: Rect | null; side: Rect | null } {
  const note = c.explanations.find(e => e.startsWith(`${COORDINATED_RESIDUAL_APPLIED} level 0 `))!;
  const m = note.match(/rear (none|([\d.]+)×([\d.]+) m), side (none|([\d.]+)×([\d.]+) m)/)!;
  const b = c.buildableArea as Rect;
  const rear = m[1] === 'none' ? null : { x: b.x, y: b.y + b.h - Number(m[3]), w: Number(m[2]), h: Number(m[3]) };
  const rearH = rear ? rear.h : 0;
  const side = m[4] === 'none' ? null
    : { x: b.x + b.w - Number(m[5]), y: b.y + b.h - rearH - Number(m[6]), w: Number(m[5]), h: Number(m[6]) };
  return { rear, side };
}

/** The strip shrunk by the exterior-wall pad along the frame edge it adjoins. */
const beyondPad = (r: Rect, kind: 'rear' | 'side', pad: number): Rect =>
  kind === 'rear' ? { ...r, y: r.y + pad, h: r.h - pad } : { ...r, x: r.x + pad, w: r.w - pad };

function expectResidualOpen(c: LayoutCandidate, want: { rear: boolean; side: boolean }) {
  const res = strips(c);
  expect(!!res.rear, 'rear residual').toBe(want.rear);
  expect(!!res.side, 'side residual').toBe(want.side);
  const E = 0.011; // the note prints centimetres
  // the strips adjoin the built frame: some floor's rooms reach the strip edge exactly.
  const rooms = c.floors.flatMap(f => f.spaces.filter(s => s.type !== 'yard').map(s => s.rect));
  if (res.rear) expect(Math.abs(Math.max(...rooms.map(r => r.y + r.h)) - res.rear.y)).toBeLessThan(E);
  if (res.side) expect(Math.abs(Math.max(...rooms.map(r => r.x + r.w)) - res.side.x)).toBeLessThan(E);
  for (const f of c.floors) {
    const pad = floorWallPad(f);
    for (const [kind, r] of [['rear', res.rear], ['side', res.side]] as const) {
      if (!r) continue;
      // intentional open space: no room / core / parking rect enters it …
      for (const o of occupied(f)) expect(overlapArea(o, { x: r.x + E, y: r.y + E, w: r.w - 2 * E, h: r.h - 2 * E }), `level ${f.level} ${kind}`).toBe(0);
      // … and the compacted envelope stops at the frame edge + exterior-wall half-thickness.
      expect(overlapArea(f.footprint, beyondPad(r, kind, pad + E)), `level ${f.level} ${kind} envelope`).toBe(0);
    }
    expect(c.explanations.some(e => e.startsWith(`${COORDINATED_RESIDUAL_APPLIED} level ${f.level} `))).toBe(true);
  }
}

const ONE_REAR_SIDE = 'rect/b1/42';          // 1 floor, rear + side residual (P4)
const ONE_REAR = 'R12x34--S0-1bd-open';      // 1 floor, rear residual only (P4)
const TWO = 'rect/b2/42';                    // 2 floors, rear + side residual (P5)
const THREE = 'R16x26--U2-3f5bd';            // 3 floors, rear residual (P5)
const YARD_THREE = 'R14x34--U2-3f5bd';       // 3 floors, 6.08 m rear residual deep enough for a yard

describe('P6 — option off', () => {
  it('omitted / false are byte-identical to legacy (with and without a yard)', () => {
    for (const [id, yard] of [[ONE_REAR_SIDE, false], [TWO, false], [THREE, false], [ONE_REAR_SIDE, true], [TWO, true]] as const) {
      const ref = strip(legacy(id, yard));
      expect(strip(generateLayouts(inputOf(id, yard), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: false }))).toBe(ref);
      expect(strip(generateLayouts(inputOf(id, yard), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: undefined }))).toBe(ref);
      expect(ref.includes(COORDINATED_RESIDUAL_APPLIED)).toBe(false);
    }
  });

  it('applyFloorCompaction without a bound is the P17-C compaction', () => {
    const c = legacy(TWO)[0];
    for (const f of c.floors) {
      const a = structuredClone(f), b = structuredClone(f);
      a.footprint = { x: 2, y: 1.5, w: 14, h: 20.5 };
      b.footprint = { x: 2, y: 1.5, w: 14, h: 20.5 };
      expect(applyFloorCompaction(a)).toBe(applyFloorCompaction(b, undefined));
      expect(a.footprint).toEqual(b.footprint);
    }
  });
});

describe('P6 — residual on coordinated floors', () => {
  it('rear residual: open, outside every envelope (single floor and three floors)', () => {
    expectResidualOpen(byStrategy(on(ONE_REAR), 'area-efficiency'), { rear: true, side: false });
    const three = byStrategy(on(THREE), 'functional-circulation');
    expect(isAdopted(three)).toBe(true);
    expect(three.floors).toHaveLength(3);
    expectResidualOpen(three, { rear: true, side: false });
  });

  it('side residual: open, outside every envelope (single floor and two floors)', () => {
    for (const [id, st] of [[ONE_REAR_SIDE, 'alternative-zoning'], [TWO, 'alternative-zoning'], [TWO, 'functional-circulation']] as const) {
      const c = byStrategy(on(id), st);
      expect(isAdopted(c), `${id} ${st}`).toBe(true);
      expectResidualOpen(c, { rear: true, side: true });
    }
    expect(byStrategy(on(TWO), 'alternative-zoning').floors).toHaveLength(2);
  });

  it('residual containment: strips inside the slice, disjoint from the frame and each other', () => {
    for (const [id, st] of [[ONE_REAR_SIDE, 'alternative-zoning'], [TWO, 'alternative-zoning'], [THREE, 'functional-circulation']] as const) {
      const c = byStrategy(on(id), st);
      const res = strips(c);
      const b = c.buildableArea as Rect;
      const rs = [res.rear, res.side].filter((r): r is Rect => r !== null);
      for (const r of rs) expect(inside(r, b)).toBe(true);
      if (res.rear && res.side) expect(overlapArea(res.rear, res.side)).toBe(0);
      // the frame (every room, core) lies outside the strips on every floor
      for (const f of c.floors) for (const o of [...f.spaces.map(s => s.rect), ...f.stairs.map(s => s.footprint)]) {
        for (const r of rs) expect(overlapArea(o, r)).toBeLessThan(0.02);
      }
    }
  });

  it('no overlaps, whole programme, nothing outside the buildable area; P5 core kept', () => {
    for (const id of [ONE_REAR_SIDE, ONE_REAR, TWO, THREE]) {
      for (const c of on(id).filter(isAdopted)) {
        expect(c.valid).toBe(true);
        expect(c.findings.some(f => f.code === 'ARCH_PROGRAM_UNPLACED')).toBe(false);
        const b = c.buildableArea as Rect;
        for (const f of c.floors) {
          const sp = f.spaces.filter(s => s.type !== 'yard');
          for (let i = 0; i < sp.length; i++) {
            expect(inside(sp[i].rect, b), `${id} ${sp[i].id}`).toBe(true);
            expect(inside(sp[i].rect, f.footprint), `${id} ${sp[i].id} in envelope`).toBe(true);
            for (let j = i + 1; j < sp.length; j++) expect(overlapArea(sp[i].rect, sp[j].rect), `${sp[i].id}/${sp[j].id}`).toBeLessThan(0.02);
          }
          for (const st of f.stairs) expect(inside(st.footprint, f.footprint, 0.02)).toBe(true);
        }
        if (c.floors.length > 1) {
          const halls = c.floors.map(f => f.spaces.find(s => s.type === 'stair-hall')!.rect);
          for (const h of halls) expect(h).toEqual(halls[0]);
          for (const f of c.floors) expect(f.stairs[0].footprint).toEqual(c.floors[0].stairs[0].footprint);
        }
      }
    }
  });

  it('repeated generation is deterministic (with and without a yard)', () => {
    for (const [id, yard] of [[ONE_REAR_SIDE, false], [TWO, false], [THREE, false], [ONE_REAR_SIDE, true], [TWO, true]] as const) {
      expect(strip(on(id, yard))).toBe(strip(on(id, yard)));
    }
  });
});

describe('P6 — yard interaction', () => {
  it('a yard lands in the frame residual, outside the frame and every envelope (1 and 3 floors)', () => {
    for (const [id, st] of [[ONE_REAR_SIDE, 'alternative-zoning'], [YARD_THREE, 'functional-circulation']] as const) {
      const c = byStrategy(on(id, true), st);
      expect(isAdopted(c), `${id} ${st}`).toBe(true);
      const yard = c.floors[0].spaces.find(s => s.type === 'yard')!;
      expect(yard, `${id} yard`).toBeTruthy();
      const res = strips(c);
      // inside the rear strip (0.02: the yard placer's overlap tolerance) …
      expect(inside(yard.rect, res.rear!, 0.02)).toBe(true);
      // … so clear of every floor's rooms, cores, parking and envelope.
      for (const f of c.floors) {
        for (const o of occupied(f)) expect(overlapArea(yard.rect, o)).toBeLessThan(0.02 * Math.max(yard.rect.w, yard.rect.h));
        // the envelope reaches the yard only by the exterior-wall half-thickness on the frame edge.
        expect(overlapArea(yard.rect, f.footprint)).toBeLessThanOrEqual((floorWallPad(f) + 0.02) * Math.max(yard.rect.w, yard.rect.h) + 1e-9);
      }
      expect(c.explanations.some(e => e.startsWith(`${COORDINATED_RESIDUAL_APPLIED} yard `) && e.includes('in the frame residual'))).toBe(true);
      // the coordinated rooms / cores are the no-yard ones: the yard only uses the residual.
      const noYard = byStrategy(on(id), st);
      expect(c.floors.map(f => f.spaces.filter(s => s.type !== 'yard').map(s => s.rect))).toEqual(noYard.floors.map(f => f.spaces.map(s => s.rect)));
      expect(c.floors.map(f => f.footprint)).toEqual(noYard.floors.map(f => f.footprint));
    }
    // multi-floor: the legacy building leaves no open-air spot for the yard; the frame's rear
    // residual does (the coordinated variant is adopted only through the unchanged guard).
    expect(byStrategy(legacy(YARD_THREE, true), 'functional-circulation').valid).toBe(false);
    expect(byStrategy(on(YARD_THREE, true), 'functional-circulation').valid).toBe(true);
  });
});

describe('P6 — fallback', () => {
  it('a room overflowing into the side residual → the side-strip variant is discarded', () => {
    // rect/b4: the placer's min-width row overflows the pinned private zone into the side strip.
    // P6 discards that variant; P8's single retry without the side strip is what stands
    // (adopted through the unchanged guard) — no floor keeps a side strip.
    for (const st of ['alternative-zoning', 'functional-circulation']) {
      const c = byStrategy(on('rect/b4/42'), st);
      expect(c.explanations.some(e => e.startsWith(COORDINATED_RESIDUAL_RETRY))).toBe(true);
      const notes = c.explanations.filter(e => e.startsWith(COORDINATED_RESIDUAL_APPLIED));
      expect(notes.length).toBe(c.floors.length);
      for (const n of notes) expect(n).toMatch(/side none/);
    }
  });

  it('a parking stall in the residual → the exact legacy candidate', () => {
    const c = byStrategy(on('rectE/b2/42'), 'alternative-zoning');
    expect(isAdopted(c)).toBe(false);
    expect(strip(c)).toBe(strip(byStrategy(legacy('rectE/b2/42'), 'alternative-zoning')));
  });
});

describe('P6 — pure helpers', () => {
  const specs = (id: string) => programForFloor(inputOf(id).building, 0, true, allocateBuildingProgram(inputOf(id).building, 1)[0])
    .map((s, k) => ({ ...s, placedId: `${s.type}-0-${k}`, placedLabel: s.type }) as PlacedSpec);
  const frameOf = (id: string, access: 'south' | 'east', slice: Rect) =>
    deriveBuildingFrame({ slice, access, strategy: 'alternative-zoning', floorSpecs: [specs(id)] })!;

  it('frameResidual / frameEnvelopeBound / residualEnvelopeOverlap on south and east frames', () => {
    const south = frameResidual(frameOf(ONE_REAR_SIDE, 'south', { x: 2, y: 1.5, w: 14, h: 20.5 }));
    expect(south.rear && south.side).toBeTruthy();
    const fp = { x: 2, y: 1.5, w: 14, h: 20.5 };
    const bound = frameEnvelopeBound(fp, south)!;
    expect(bound).toEqual({ x: 2, y: 1.5, w: south.frame.x + south.frame.w - 2, h: south.frame.y + south.frame.h - 1.5 });
    expect(residualEnvelopeOverlap(fp, south, 0.175)).toBeGreaterThan(1);
    expect(residualEnvelopeOverlap(bound, south, 0.175)).toBe(0);
    const east = frameResidual(frameOf('rectE/b1/42', 'east', { x: 2, y: 2, w: 16, h: 18 }));
    expect(east.rear && east.side).toBeTruthy();
    const eb = frameEnvelopeBound({ x: 2, y: 2, w: 16, h: 18 }, east)!;
    expect(inside(eb, { x: 2, y: 2, w: 16, h: 18 })).toBe(true);
    expect(overlapArea(eb, east.rear!) + overlapArea(eb, east.side!)).toBe(0);
    expect(inside(east.frame, eb)).toBe(true);
    // shared edges are not intrusion; positive area is.
    const r = east.rear!;
    expect(residualIntrusions(east, [{ ...east.frame }])).toHaveLength(0);
    expect(residualIntrusions(east, [{ x: r.x + 0.1, y: r.y + 0.1, w: 1, h: 1 }])).toHaveLength(1);
  });

  it('applyFloorCompaction(bound): clips at bound + wall pad; refuses when occupied geometry passes it', () => {
    const c = byStrategy(on(ONE_REAR_SIDE), 'alternative-zoning');
    const f0 = c.floors[0];
    const pad = floorWallPad(f0);
    const res = strips(c);
    const frame: Rect = { x: 2, y: 1.5, w: res.side!.x - 2, h: res.rear!.y - 1.5 };
    const a = structuredClone(f0);
    a.footprint = { x: 2, y: 1.5, w: 14, h: 20.5 };
    expect(applyFloorCompaction(a, frame)).toBe(true);
    expect(a.footprint.x + a.footprint.w).toBeLessThanOrEqual(frame.x + frame.w + pad + 1e-9);
    expect(a.footprint.y + a.footprint.h).toBeLessThanOrEqual(frame.y + frame.h + pad + 1e-9);
    // a stair outside the bound: the bounded compaction refuses (envelope unchanged).
    const b = structuredClone(f0);
    b.footprint = { x: 2, y: 1.5, w: 14, h: 20.5 };
    b.stairs = [{ ...(b.stairs[0] ?? {}), footprint: { x: res.side!.x + 0.1, y: 3, w: 0.4, h: 2 } } as any];
    expect(applyFloorCompaction(b, frame)).toBe(false);
    expect(b.footprint).toEqual({ x: 2, y: 1.5, w: 14, h: 20.5 });
  });
});
