/**
 * P7 — the coordinated rectangle planner (GenerateLayoutsOptions.coordinatedRectPlanner) on
 * the remaining rectangle modes: the vertical spine (daylight-orientation, carveZones'
 * vertical zoning with ONE spine fraction for every floor), elevator cores on it, north /
 * east / west access (explicitly designated kitchen / stair pockets on pinned layouts), and
 * narrow / deep rectangles (a coherent frame or the exact legacy candidate). Cases are the
 * existing benchmark / sweep inputs; the north / west sites re-orient existing inputs.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts } from './generator.js';
import { benchmarkInputs, sweepInputs } from '../regression/layout-cases.js';
import {
  COORDINATED_RESIDUAL_APPLIED, planCoordinatedCore, placeCoordinatedFloor, verticalFloorZones,
} from '../layout/coordinated-rect.js';
import { deriveBuildingFrame } from '../layout/building-frame.js';
import { buildAccessFrame, mapZoneLayout, type PlacedSpec, type ZoneLayout } from '../layout/placer.js';
import { writeDXF } from '../dxf/writer.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { LayoutCandidate, CandidateStrategy } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { AccessSide } from '../model/site.js';
import type { Floor } from '../model/floor.js';
import type { Rect } from '../geometry/rect.js';
import type { Space, SpaceType, Zone } from '../model/space.js';

const S: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const ALL = [...benchmarkInputs(), ...sweepInputs()];
const inputOf = (id: string, access?: AccessSide): ProjectInput => {
  const inp = structuredClone(ALL.find(b => b.id === id)!.input);
  if (access) inp.site = { ...inp.site, accessSide: access };
  return inp;
};
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? undefined : v));
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const legacy = (id: string, access?: AccessSide) => generateLayouts(inputOf(id, access), S, { upperFloorFrontPrivate: true });
const on = (id: string, access?: AccessSide) =>
  generateLayouts(inputOf(id, access), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: true });
const isAdopted = (c: LayoutCandidate) => c.explanations.some(e => /^P[45]: coordinated .* adopted/.test(e));
const isCore = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith('P5: coordinated multi-floor core variant adopted'));
const sameR = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const inside = (r: Rect, o: Rect, e = 1e-6) =>
  r.x >= o.x - e && r.y >= o.y - e && r.x + r.w <= o.x + o.w + e && r.y + r.h <= o.y + o.h + e;
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-3 && h > 1e-3 ? w * h : 0;
};
const floorSpecs = (input: ProjectInput): PlacedSpec[][] =>
  allocateBuildingProgram(input.building, input.building.floors).map((al, l) =>
    programForFloor(input.building, l, input.building.floors === 1, al)
      .map((s, k) => ({ ...s, placedId: `${s.type}-${l}-${k}`, placedLabel: s.type }) as PlacedSpec));
const occupied = (f: Floor): Rect[] => [
  ...f.spaces.filter(s => s.type !== 'yard').map(s => s.rect),
  ...f.stairs.map(s => s.footprint),
  ...f.elevators.map(e => e.rect),
  ...(f.parkingStalls ?? []).map(p => p.rect),
  ...(f.parkingArea?.aisleRect ? [f.parkingArea.aisleRect] : []),
];
const hardCounts = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard')
  .reduce((m, f) => m.set(f.code, (m.get(f.code) ?? 0) + 1), new Map<string, number>());
const watched = (c: LayoutCandidate) => c.findings.filter(f => /CIRC|ACCESS|DAYLIGHT|DYL/.test(f.code)).length;

/**
 * Residual strips of a coordinated candidate for ANY access side: the dimensions from the
 * P6 note, placed in the access frame of the buildable rect (rear strip on the local rear
 * edge, side strip on the local max-x edge in front of it — the street-side parking band
 * only moves the local street edge) and mapped back to world coordinates.
 */
function residualStrips(c: LayoutCandidate, access: AccessSide): Rect[] {
  const note = c.explanations.find(e => e.startsWith(`${COORDINATED_RESIDUAL_APPLIED} level 0 `));
  if (!note) return [];
  const m = note.match(/rear (none|([\d.]+)×([\d.]+) m), side (none|([\d.]+)×([\d.]+) m)/)!;
  const af = buildAccessFrame(c.buildableArea as Rect, access);
  const L = af ? af.to(c.buildableArea as Rect) : (c.buildableArea as Rect);
  const from = (r: Rect) => (af ? af.from(r) : r);
  // the note prints world w × h; east / west frames are transposed against the world.
  const t = access === 'east' || access === 'west';
  const dims = (a: string, b: string) => (t ? [Number(b), Number(a)] : [Number(a), Number(b)]);
  const out: Rect[] = [];
  const [rw, rh] = m[1] === 'none' ? [0, 0] : dims(m[2], m[3]);
  if (m[1] !== 'none') out.push(from({ x: L.x, y: L.y + L.h - rh, w: rw, h: rh }));
  if (m[4] !== 'none') {
    const [sw, sh] = dims(m[5], m[6]);
    out.push(from({ x: L.x + L.w - sw, y: L.y + L.h - rh - sh, w: sw, h: sh }));
  }
  return out;
}

/** Every P7 acceptance invariant of one coordinated candidate against its legacy candidate. */
function expectCoherent(c: LayoutCandidate, l: LayoutCandidate, access: AccessSide, tag: string) {
  expect(c.valid, `${tag} valid`).toBe(true);
  const lc = hardCounts(l);
  for (const [code, k] of hardCounts(c)) expect(k, `${tag} ${code}`).toBeLessThanOrEqual(lc.get(code) ?? 0);
  expect(watched(c), `${tag} circulation / access / daylight`).toBeLessThanOrEqual(watched(l));
  // core: nothing lost, one rect per core type across the floors
  for (const t of ['stair-hall', 'elevator-hall'] as const) {
    const cells = c.floors.flatMap(f => f.spaces.filter(s => s.type === t).map(s => s.rect));
    expect(cells.length, `${tag} ${t}`).toBeGreaterThanOrEqual(l.floors.flatMap(f => f.spaces.filter(s => s.type === t)).length);
    for (const r of cells) expect(sameR(r, cells[0]), `${tag} ${t} aligned`).toBe(true);
  }
  c.floors.forEach(f => {
    const lf = l.floors.find(x => x.level === f.level)!;
    expect(f.stairs.length, `${tag} stairs L${f.level}`).toBeGreaterThanOrEqual(lf.stairs.length);
    expect(f.elevators.length, `${tag} elevators L${f.level}`).toBeGreaterThanOrEqual(lf.elevators.length);
    for (const st of f.stairs) expect(st.valid, `${tag} stair L${f.level}`).toBe(true);
    // residual: no room / stair / elevator / parking rect in it
    for (const s of residualStrips(c, access)) for (const r of occupied(f)) {
      expect(overlap(r, s), `${tag} L${f.level} residual`).toBe(0);
    }
    const sp = f.spaces.filter(s => s.rect && s.type !== 'parking');
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
      expect(overlap(sp[i].rect, sp[j].rect), `${tag} ${sp[i].id}|${sp[j].id}`).toBeLessThan(1e-4);
    }
  });
  expect(writeDXF(c)).toMatch(/\$ACADVER\s*\n\s*1\s*\nAC1009/);
}

/** Non-adopted candidates are the exact legacy candidates. */
function expectLegacyWhereNotAdopted(onC: LayoutCandidate[], legC: LayoutCandidate[]) {
  for (const c of onC.filter(x => !isAdopted(x))) expect(strip(c)).toBe(strip(byStrategy(legC, c.metadata.strategy)));
}

const mk = (type: SpaceType, rect: Rect, label: string, id: string, zone: Zone): Space =>
  ({ id, type, label, rect, polygon: [], area: rect.w * rect.h, zone } as unknown as Space);

const VERT2 = 'rect14/b4/42';          // 2 floors, vertical spine adopted (bench)
const VERT3 = 'R14x22--U2-3f5bd';      // 3 floors, vertical spine adopted (sweep)
const LIFT = 'rect/b3lift/42';         // 3 floors + elevator
const SLICE: Rect = { x: 2, y: 1.5, w: 14, h: 20.5 };

describe('P7 — option off', () => {
  it('omitted / false stay byte-identical to legacy on every P7 mode (vertical, lift, north / west, narrow / deep)', () => {
    const cases: [string, AccessSide | undefined][] = [
      [VERT2, undefined], [LIFT, undefined], ['rect/b2/42', 'north'], ['rect/b1/42', 'west'],
      ['R8x34--U0-2f3bd', undefined], ['R12x34--S1-2bd', undefined],
    ];
    for (const [id, acc] of cases) {
      const a = strip(generateLayouts(inputOf(id, acc), S, { upperFloorFrontPrivate: true }));
      expect(strip(generateLayouts(inputOf(id, acc), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: false }))).toBe(a);
    }
  });
});

describe('P7 — vertical-spine frame', () => {
  it('opt-in only: without verticalSpine the vertical spine still has no frame', () => {
    const fs = floorSpecs(inputOf('rect/b2/42'));
    expect(deriveBuildingFrame({ slice: SLICE, access: 'south', strategy: 'daylight-orientation', floorSpecs: fs })).toBeNull();
    expect(deriveBuildingFrame({ slice: SLICE, access: 'south', strategy: 'daylight-orientation', floorSpecs: fs, verticalSpine: false })).toBeNull();
  });

  it('one full-depth spine for every floor, bands disjoint and inside the slice, on every access side', () => {
    const fs = floorSpecs(inputOf('rect/b2/42'));
    for (const access of ['south', 'north', 'east', 'west'] as AccessSide[]) {
      const f = deriveBuildingFrame({ slice: SLICE, access, strategy: 'daylight-orientation', floorSpecs: fs, verticalSpine: true })!;
      expect(f, access).not.toBeNull();
      expect(f.spine).toBe('vertical');
      expect(f.corridorFraction).toBeGreaterThanOrEqual(0.3);
      expect(f.corridorFraction).toBeLessThanOrEqual(0.7);
      expect(f.world.residualRear).toBeNull();
      expect(f.world.residualSide).toBeNull();
      const w = f.world;
      for (const r of [w.publicBand, w.corridor, w.privateBand]) expect(inside(r, SLICE), access).toBe(true);
      expect(overlap(w.publicBand, w.corridor) + overlap(w.corridor, w.privateBand) + overlap(w.publicBand, w.privateBand)).toBe(0);
      // the spine runs street → rear: across the whole slice depth
      const acrossY = access === 'south' || access === 'north';
      expect(f.corridorLine.axis).toBe(acrossY ? 'x' : 'y');
      expect(f.corridorLine.to - f.corridorLine.from).toBeCloseTo(acrossY ? SLICE.h : SLICE.w, 9);
      // every floor's pinned zones share that corridor
      for (const specs of fs) expect(verticalFloorZones(f, specs).corridors[0]).toEqual(w.corridor);
    }
  });

  it('2- and 3-floor vertical-spine buildings are adopted with one stair cell against the spine', () => {
    for (const id of [VERT2, VERT3]) {
      const c = byStrategy(on(id), 'daylight-orientation');
      expect(isCore(c), id).toBe(true);
      expectCoherent(c, byStrategy(legacy(id), 'daylight-orientation'), inputOf(id).site.accessSide, id);
      // one vertical corridor line: the same corridor rect on every floor
      const corr = c.floors.map(f => f.spaces.find(s => s.type === 'corridor' && s.rect.h > s.rect.w)!.rect);
      for (const r of corr) expect(sameR(r, corr[0]), id).toBe(true);
      const hall = c.floors[0].spaces.find(s => s.type === 'stair-hall')!.rect;
      expect(Math.abs(hall.x - (corr[0].x + corr[0].w)), `${id} hall on the spine`).toBeLessThan(0.011);
    }
  });

  it('repeated generation is deterministic', () => {
    for (const id of [VERT2, VERT3, LIFT]) {
      const a = strip(on(id));
      expect(strip(on(id))).toBe(a);
      expect(strip(on(id))).toBe(a);
    }
  });
});

describe('P7 — elevator core on the vertical spine', () => {
  it('stair pocket + lift cell above it, both on the spine, pinned identically on every floor (all access sides)', () => {
    const fs = floorSpecs(inputOf(LIFT));
    for (const access of ['south', 'north', 'east', 'west'] as AccessSide[]) {
      const plan = planCoordinatedCore({ slice: SLICE, access, strategy: 'daylight-orientation', floorSpecs: fs })!;
      expect(plan, access).not.toBeNull();
      expect(plan.stair).not.toBeNull();
      expect(plan.elevator).not.toBeNull();
      expect(plan.elevator!.side).toBe(plan.stair!.side);
      expect(inside(plan.stair!.rect, SLICE) && inside(plan.elevator!.rect, SLICE), access).toBe(true);
      expect(overlap(plan.stair!.rect, plan.elevator!.rect)).toBe(0);
      // adjacent along the spine (they share an edge)
      const s = plan.stair!.rect, e = plan.elevator!.rect;
      const touch = Math.abs(s.y + s.h - e.y) < 1e-9 || Math.abs(e.y + e.h - s.y) < 1e-9
        || Math.abs(s.x + s.w - e.x) < 1e-9 || Math.abs(e.x + e.w - s.x) < 1e-9;
      expect(touch, access).toBe(true);
      fs.forEach((specs, l) => {
        const z = plan.floorZones[l];
        expect(z.stairPocket, `${access} L${l}`).toEqual(plan.stair!.rect);
        expect(z.elevatorPocket, `${access} L${l}`).toEqual(plan.elevator!.rect);
        expect(z.corridors[0]).toEqual(plan.floorZones[0].corridors[0]);
        void specs;
      });
    }
  });

  it('a lift building the guard rejects keeps the exact legacy candidate, core intact', () => {
    const leg = legacy(LIFT);
    const cs = on(LIFT);
    expectLegacyWhereNotAdopted(cs, leg);
    for (const c of cs.filter(isAdopted)) expectCoherent(c, byStrategy(leg, c.metadata.strategy), 'south', `${LIFT} ${c.metadata.strategy}`);
  });
});

describe('P7 — north / east / west access', () => {
  it('pinned kitchen / stair pockets are taken verbatim: the east ground-floor stair stays on the plan cell', () => {
    // rectE/b2: the frame is narrower than the slice (side residual), so the kitchen strip
    // no longer sits in the slice's east 40 % — the positional guess used to pick the stair
    // pocket as the kitchen and push the hall off the building.
    const input = inputOf('rectE/b2/42');
    const fs = floorSpecs(input);
    const slice: Rect = { x: 2, y: 2, w: 12.3, h: 18 };
    const plan = planCoordinatedCore({ slice, access: 'east', strategy: 'area-efficiency', floorSpecs: fs, upperFloorFrontPrivate: true })!;
    expect(plan).not.toBeNull();
    expect(plan.floorZones[0].kitchenPocket).toBeDefined();
    expect(plan.floorZones[0].stairPocket).toEqual(plan.stair!.rect);
    fs.forEach((specs, level) => {
      const out = placeCoordinatedFloor(plan, level, slice, specs, 'area-efficiency', 'east', mk)!;
      const hall = out.spaces.find(s => s.type === 'stair-hall')!;
      expect(hall.rect, `L${level}`).toEqual(plan.stair!.rect);
      if (level === 0) {
        const k = out.spaces.find(s => s.type === 'kitchen')!;
        expect(inside(k.rect, plan.floorZones[0].kitchenPocket!, 1e-6)).toBe(true);
      }
    });
  });

  it('designations survive mapZoneLayout with their identity inside zones.service', () => {
    const k = { x: 1, y: 1, w: 2, h: 3 }, st = { x: 4, y: 1, w: 3, h: 4 };
    const z: ZoneLayout = {
      zones: { public: [], 'semi-private': [], private: [], service: [st, k], circulation: [] },
      corridors: [], kitchenPocket: k, stairPocket: st,
    };
    const m = mapZoneLayout(z, r => ({ ...r, x: r.x + 10 }));
    expect(m.kitchenPocket).toBe(m.zones.service[1]);
    expect(m.stairPocket).toBe(m.zones.service[0]);
    expect(m.kitchenPocket).toEqual({ x: 11, y: 1, w: 2, h: 3 });
  });

  it('north and west sites are coordinated (single floor and multi-floor) with every invariant', () => {
    const seen = { P4: 0, P5: 0 };
    for (const [id, access] of [
      ['rect/b1/42', 'north'], ['rect/b1/42', 'west'], ['rect/b2/42', 'north'], ['rect/b4/42', 'north'], ['rectE/b1/42', 'west'],
    ] as [string, AccessSide][]) {
      const leg = legacy(id, access);
      const cs = on(id, access);
      expectLegacyWhereNotAdopted(cs, leg);
      for (const c of cs.filter(isAdopted)) {
        seen[isCore(c) ? 'P5' : 'P4']++;
        expectCoherent(c, byStrategy(leg, c.metadata.strategy), access, `${id}@${access} ${c.metadata.strategy}`);
      }
      expect(strip(on(id, access))).toBe(strip(cs));
    }
    expect(seen.P4).toBeGreaterThan(0);
    expect(seen.P5).toBeGreaterThan(0);
  });

  it('east sites whose late parking lands in the residual keep the exact legacy candidate', () => {
    for (const id of ['rectE/b2/42', 'rectE/b3lift/42']) expectLegacyWhereNotAdopted(on(id), legacy(id));
  });
});

describe('P7 — narrow / deep rectangles', () => {
  it('a stair on a band ≤ 5.5 m, or a vertical pocket wider than the east band, has no coordinated core', () => {
    // R8x34: 4 m wide — carveZones pockets no stair (legacy reports STAIR_MISSING itself).
    const narrow = floorSpecs(inputOf('R8x34--U0-2f3bd'));
    for (const st of S) expect(planCoordinatedCore({ slice: { x: 2, y: 1.5, w: 4, h: 29.5 }, access: 'south', strategy: st, floorSpecs: narrow }), st).toBeNull();
    // R12x26 vertical: the 4.2 m minimum pocket would pass the 3.25 m east band edge.
    const r12 = floorSpecs(inputOf('R12x26--U0-2f3bd'));
    expect(planCoordinatedCore({ slice: { x: 2, y: 1.5, w: 8, h: 22.5 }, access: 'south', strategy: 'daylight-orientation', floorSpecs: r12 })).toBeNull();
    for (const id of ['R8x34--U0-2f3bd', 'R12x26--U0-2f3bd', 'R8x22--U0-2f3bd']) expectLegacyWhereNotAdopted(on(id), legacy(id));
  });

  it('deep rectangles are coordinated where the frame is coherent', () => {
    let n = 0;
    for (const id of ['R12x34--S0-1bd-open', 'R12x34--S1-2bd', 'R14x34--U2-3f5bd']) {
      const leg = legacy(id);
      const cs = on(id);
      expectLegacyWhereNotAdopted(cs, leg);
      for (const c of cs.filter(isAdopted)) { n++; expectCoherent(c, byStrategy(leg, c.metadata.strategy), 'south', `${id} ${c.metadata.strategy}`); }
    }
    expect(n).toBeGreaterThan(0);
  });
});
