/**
 * Phase 5.4E — opt-in `connectIsolatedRooms` (post-placement upper-floor repair).
 *
 * An upper-floor room with no wall to a corridor / foyer / entrance / stair hall long
 * enough for its door is joined to the circulation by a corridor connector filling a
 * clean empty gap, found by the UNCHANGED 5.4B search (findStairCoreConnector). Rooms,
 * halls, stair and corridors never move. Adoption is validator-guarded; OFF is identical.
 */
import { describe, it, expect } from 'vitest';
import { findRoomAccessConnectors, adoptRoomAccessConnectorVariant, generateLayouts } from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { rectInsidePolygon } from '../geometry/polygon-ops.js';
import { CORRIDOR_MIN_WIDTH } from '../units.js';
import type { Rect } from '../geometry/rect.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

const close = (a: Rect, b: Rect) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 9); };
const ovl = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
const overlaps = (rs: Rect[]) => rs.flatMap((a, i) => rs.slice(i + 1).filter(b => ovl(a, b)));

// ---------------------------------------------------------------- pure finder
describe('Phase 5.4E findRoomAccessConnectors (pure)', () => {
  const inside = () => true;
  // Corridor spine along y 10.25–11.75; bedroom north of it behind a 1.64 m empty strip.
  const corridor = { id: 'corridor-1-000', type: 'corridor', rect: { x: 2, y: 10.25, w: 10, h: 1.5 } };
  const bedroom = { id: 'bedroom-1-001', type: 'bedroom', rect: { x: 2, y: 13.39, w: 3, h: 4 } };

  it('isolated room behind a clean gap: connector fills the gap at 1.5 m cross width', () => {
    const r = findRoomAccessConnectors([corridor, bedroom], inside);
    expect(r).toHaveLength(1);
    expect(r[0].roomId).toBe('bedroom-1-001');
    expect(r[0].side).toBe('south');
    close(r[0].rect, { x: 2, y: 11.75, w: 1.5, h: 1.64 });
    expect(Math.min(r[0].rect.w, r[0].rect.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - 1e-9);
  });

  it('pure: inputs are not mutated and repeated calls are identical', () => {
    const sp = [corridor, bedroom];
    const snap = JSON.stringify(sp);
    const a = findRoomAccessConnectors(sp, inside);
    expect(findRoomAccessConnectors(sp, inside)).toEqual(a);
    expect(JSON.stringify(sp)).toBe(snap);
  });

  it('room already served (door-capable circulation wall) → no connector', () => {
    const served = { ...bedroom, rect: { ...bedroom.rect, y: 11.75 } };
    expect(findRoomAccessConnectors([corridor, served], inside)).toEqual([]);
    // served by a stair hall or a foyer as well
    const hall = { id: 'stair-hall-1-002', type: 'stair-hall', rect: { x: 5, y: 13.39, w: 2.6, h: 4 } };
    expect(findRoomAccessConnectors([corridor, bedroom, hall], inside)).toEqual([]);
  });

  it('elevator hall contact does not count as access (rooms cannot door onto it)', () => {
    const lift = { id: 'elevator-hall-1-002', type: 'elevator-hall', rect: { x: 5, y: 13.39, w: 2, h: 2 } };
    expect(findRoomAccessConnectors([corridor, bedroom, lift], inside)).toHaveLength(1);
  });

  it('contact shorter than the door width + jamb margins still triggers; ≥ that width does not', () => {
    // 0.9 m door needs ≥ 0.94 m of wall (openings.ts minimum jamb margins).
    const stub = (w: number) => ({ id: 'corridor-1-000', type: 'corridor', rect: { x: 5 - w, y: 11.89, w: 1.5, h: 1.5 } });
    const east = { id: 'corridor-1-00z', type: 'corridor', rect: { x: 6.5, y: 13.39, w: 1.5, h: 4 } }; // 1.5 m clean gap east
    const r = findRoomAccessConnectors([stub(0.9), east, bedroom], inside); // stub touches 0.9 m of the south edge
    expect(r).toHaveLength(1);
    expect(r[0].side).toBe('east');
    close(r[0].rect, { x: 5, y: 13.39, w: 1.5, h: 1.5 });
    expect(findRoomAccessConnectors([stub(0.94), east, bedroom], inside)).toEqual([]);
  });

  it('no connector: gap thinner than CORRIDOR_MIN_WIDTH', () => {
    const b = { ...bedroom, rect: { ...bedroom.rect, y: 11.75 + 0.8 } };
    expect(findRoomAccessConnectors([corridor, b], inside)).toEqual([]);
  });
  it('no connector: overlap shorter than CORRIDOR_MIN_WIDTH', () => {
    const b = { ...bedroom, rect: { x: 11.2, y: 13.39, w: 3, h: 4 } }; // overlaps corridor x-span by 0.8 m
    expect(findRoomAccessConnectors([corridor, b], inside)).toEqual([]);
  });
  it('no connector: gap blocked by another space', () => {
    const blk = { id: 'bathroom-1-003', type: 'bathroom', rect: { x: 2, y: 11.75, w: 3, h: 1.64 } };
    const r = findRoomAccessConnectors([corridor, bedroom, blk], inside);
    expect(r.find(c => c.roomId === 'bedroom-1-001')).toBeUndefined();
    for (const c of r) for (const s of [corridor, bedroom, blk]) expect(ovl(c.rect, s.rect)).toBe(false);
  });
  it('no connector: outside the buildable geometry', () => {
    expect(findRoomAccessConnectors([corridor, bedroom], () => false)).toEqual([]);
  });
  it('no connector: off the 1 cm grid', () => {
    const b = { ...bedroom, rect: { ...bedroom.rect, y: 13.395 } };
    expect(findRoomAccessConnectors([corridor, b], inside)).toEqual([]);
  });

  it('en-suite exclusion: master-bathroom served by its master-bedroom gets no connector', () => {
    const mb = { id: 'master-bedroom-1-004', type: 'master-bedroom', rect: { x: 5, y: 11.75, w: 4, h: 4 } }; // on the corridor
    const ens = { id: 'master-bathroom-1-005', type: 'master-bathroom', rect: { x: 9, y: 13.39, w: 2, h: 2.36 } }; // shares 2.36 m with mb, gap to corridor
    expect(findRoomAccessConnectors([corridor, mb, ens], inside)).toEqual([]);
    // the same bathroom without its bedroom wall is isolated and connected
    const lone = { ...ens, rect: { x: 9.5, y: 13.39, w: 2, h: 2.36 } };
    const mb2 = { ...mb, rect: { x: 5, y: 11.75, w: 3, h: 4 } };
    const r = findRoomAccessConnectors([corridor, mb2, lone], inside);
    expect(r.map(c => c.roomId)).toEqual(['master-bathroom-1-005']);
  });
  it('storage served by an adjoining kitchen is exempt', () => {
    const kit = { id: 'kitchen-1-006', type: 'kitchen', rect: { x: 5, y: 11.75, w: 4, h: 4 } };
    const st = { id: 'storage-1-007', type: 'storage', rect: { x: 9, y: 13.39, w: 2, h: 2.36 } };
    expect(findRoomAccessConnectors([corridor, kit, st], inside)).toEqual([]);
  });

  it('L-shape buildable polygon: a connector crossing the notch is rejected, inside the L it is accepted', () => {
    // L: 20 × 20 with the north-east 8 × 8 notch removed.
    const L = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 20 }, { x: 0, y: 20 }];
    const insideL = (r: Rect) => rectInsidePolygon(r, L as never, 1e-3);
    const k = { id: 'corridor-1-000', type: 'corridor', rect: { x: 2, y: 8, w: 16, h: 1.5 } };
    // room in the east arm, gap north of the corridor: 9.5 → 10.8 (inside the L)
    const east = { id: 'bedroom-1-001', type: 'bedroom', rect: { x: 14, y: 10.8, w: 4, h: 1.2 + 0 } };
    const rIn = findRoomAccessConnectors([k, east], insideL);
    expect(rIn).toHaveLength(1);
    expect(insideL(rIn[0].rect)).toBe(true);
    // a room whose gap strip would run through the notch (y ≥ 12, x ≥ 12)
    const k2 = { id: 'corridor-1-000', type: 'corridor', rect: { x: 13, y: 8, w: 5, h: 1.5 } };
    const inNotch = { id: 'bedroom-1-002', type: 'bedroom', rect: { x: 13, y: 13.5, w: 4, h: 3 } };
    expect(findRoomAccessConnectors([k2, inNotch], insideL)).toEqual([]);
    expect(findRoomAccessConnectors([k2, inNotch], inside)).toHaveLength(1);
    // a connector straddling the arm junction x = 12 (would split across two buildable
    // rects) is accepted by the real polygon test
    const wide = { id: 'bedroom-1-003', type: 'bedroom', rect: { x: 11.25, y: 10.9, w: 1.5, h: 1 } };
    const r3 = findRoomAccessConnectors([k, wide], insideL);
    expect(r3).toHaveLength(1);
    close(r3[0].rect, { x: 11.25, y: 9.5, w: 1.5, h: 1.4 });
    expect(r3[0].rect.x < 12 && r3[0].rect.x + r3[0].rect.w > 12).toBe(true);
  });

  it('multiple connectors on one floor; later rooms may use earlier connectors; no overlaps; id order', () => {
    const a = { id: 'bedroom-1-001', type: 'bedroom', rect: { x: 2, y: 13.39, w: 3, h: 4 } };
    const b = { id: 'bedroom-1-002', type: 'bedroom', rect: { x: 8, y: 13.39, w: 3, h: 4 } };
    const sp = [b, corridor, a]; // input order must not matter
    const r = findRoomAccessConnectors(sp, inside);
    expect(r.map(c => c.roomId)).toEqual(['bedroom-1-001', 'bedroom-1-002']);
    close(r[0].rect, { x: 2, y: 11.75, w: 1.5, h: 1.64 });
    close(r[1].rect, { x: 8, y: 11.75, w: 1.5, h: 1.64 });
    expect(overlaps([...sp.map(s => s.rect), ...r.map(c => c.rect)])).toEqual([]);
    expect(findRoomAccessConnectors([a, corridor, b], inside)).toEqual(r);
  });

  it('an accepted connector becomes an obstacle for later rooms', () => {
    // two rooms sharing the same 1.5 m-wide gap column: only the first (id order) gets it
    const a = { id: 'bedroom-1-001', type: 'bedroom', rect: { x: 2, y: 13.39, w: 1.5, h: 4 } };
    const b = { id: 'bedroom-1-002', type: 'bedroom', rect: { x: 2, y: 11.75 + 1.64 + 4, w: 1.5, h: 3 } };
    const r = findRoomAccessConnectors([corridor, b, a], inside);
    expect(r.map(c => c.roomId)).toEqual(['bedroom-1-001']);
  });
});

// ---------------------------------------------------------------- generator
const B = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
const R = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const mk = (site: object, building: object, seed: number) => ({ site, building, seed, deterministic: true, jurisdiction: 'IR' });
const FIX = {
  rectB4: mk(R, { ...B, bedrooms: 3, bathrooms: 2, hasStorage: true }, 42),
  rect14B3lift: mk({ ...R, width: 14, length: 22 }, { ...B, bedrooms: 3, hasElevator: true, floors: 3 }, 42),
  // arbitrary L-shape site (not a benchmark dimension)
  lGeneric: mk({ shape: 'l-shape', width: 13.8, length: 20.18, streetWidth: 8.24, accessSide: 'west', setbackNorth: 1.29, setbackSouth: 1.3, setbackEast: 1.87, setbackWest: 2.43,
    lShape: { width: 13.8, length: 20.18, notchWidth: 4.12, notchLength: 3.17, notchCorner: 'north-west' } },
  { ...B, bedrooms: 3, parkingSpaces: 0, kitchenType: 'open', floors: 3, hasElevator: false, hasStorage: false }, 33),
  // arbitrary rectangular site where two rooms of one floor get connectors
  multi: mk({ shape: 'rectangle', width: 13.37, length: 25.68, streetWidth: 12.12, accessSide: 'east', setbackNorth: 2.46, setbackSouth: 1.88, setbackEast: 1.8, setbackWest: 0.3 },
    { ...B, bedrooms: 3, kitchenType: 'open', hasElevator: true, hasStorage: false }, 74),
};
const ALL7 = { galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true, programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const cand = (inp: object, strategy: string, opts: object) => generateLayouts(clone(inp) as never, [strategy as never], opts)[0];
const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard');
const circHard = (c: LayoutCandidate) => hard(c).filter(f => /^CIRC/.test(f.code) || f.code === 'CONSTRAINT_DIRECT_ACCESS').length;
const ADOPTED = 'Phase 5.4E: isolated-room connector variant adopted';
const CONN = 'Room access connector';

function checkAdopted(off: LayoutCandidate, on: LayoutCandidate): Rect[] {
  expect(on.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
  expect(circHard(on)).toBeLessThan(circHard(off));
  expect(hard(on).length).toBeLessThanOrEqual(hard(off).length);
  const offCodes = new Set(hard(off).map(f => f.code));
  for (const f of hard(on)) expect(offCodes.has(f.code), f.code).toBe(true);
  expect(on.valid || !off.valid).toBe(true);
  expect(JSON.stringify(on.floors[0])).toBe(JSON.stringify(off.floors[0]));
  const added: Rect[] = [];
  on.floors.forEach((fl, li) => {
    const offFl = off.floors[li];
    // every base space (rooms, halls, stair hall, corridors) unchanged: same id, type, rect, area
    const keep = fl.spaces.filter(s => s.label !== CONN).map(s => [s.id, s.type, s.rect, s.area]);
    expect(keep).toEqual(offFl.spaces.map(s => [s.id, s.type, s.rect, s.area]));
    expect(JSON.stringify(fl.stairs)).toBe(JSON.stringify(offFl.stairs));
    expect(overlaps(fl.spaces.map(s => s.rect))).toEqual([]);
    for (const s of fl.spaces.filter(x => x.label === CONN)) {
      expect(li).toBeGreaterThan(0);
      expect(s.type).toBe('corridor');
      expect(Math.min(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - 1e-9);
      for (const v of [s.rect.x, s.rect.y, s.rect.w, s.rect.h]) expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
      added.push(s.rect);
    }
  });
  expect(added.length).toBeGreaterThan(0);
  return added;
}

describe('Phase 5.4E connectIsolatedRooms — generator', () => {
  it('rect b4 alternative-zoning: Bedroom 2 joined north (1.50 × 1.64), candidate becomes valid', () => {
    const off = cand(FIX.rectB4, 'alternative-zoning', {});
    const on = cand(FIX.rectB4, 'alternative-zoning', { connectIsolatedRooms: true });
    expect(off.valid).toBe(false);
    expect(on.valid).toBe(true);
    const added = checkAdopted(off, on);
    expect(added).toEqual([{ x: 2, y: 12.28, w: 1.5, h: 1.64 }]);
    expect(hard(off).map(f => f.code).sort()).toEqual(['CIRC_INACCESSIBLE_SPACE', 'CONSTRAINT_DIRECT_ACCESS']);
  });

  it('rect14 b3lift area-efficiency: master bedroom joined west to the stair hall (1.95 × 1.50)', () => {
    const off = cand(FIX.rect14B3lift, 'area-efficiency', {});
    const on = cand(FIX.rect14B3lift, 'area-efficiency', { connectIsolatedRooms: true });
    expect(checkAdopted(off, on)).toEqual([{ x: 4.6, y: 14.74, w: 1.95, h: 1.5 }]);
    expect(n(on, 'CIRC_ROOM_THROUGH_ROOM')).toBeLessThan(n(off, 'CIRC_ROOM_THROUGH_ROOM'));
    // with all seven existing options the candidate becomes valid
    const off7 = cand(FIX.rect14B3lift, 'area-efficiency', ALL7);
    const on7 = cand(FIX.rect14B3lift, 'area-efficiency', { ...ALL7, connectIsolatedRooms: true });
    expect(off7.valid).toBe(false);
    expect(on7.valid).toBe(true);
    checkAdopted(off7, on7);
  });

  it('L-shape arbitrary site: connector inside the real buildable polygon', () => {
    const off = cand(FIX.lGeneric, 'functional-circulation', {});
    const on = cand(FIX.lGeneric, 'functional-circulation', { connectIsolatedRooms: true });
    const added = checkAdopted(off, on);
    for (const r of added) expect(rectInsidePolygon(r, (on as any).buildableBoundary, 1e-3)).toBe(true);
    expect(added).toEqual([{ x: 6.55, y: 4.47, w: 1.19, h: 2.65 }]);
  });

  it('multiple connectors on one floor (all seven options), non-overlapping, deterministic ids', () => {
    const off = cand(FIX.multi, 'daylight-orientation', ALL7);
    const on = cand(FIX.multi, 'daylight-orientation', { ...ALL7, connectIsolatedRooms: true });
    const added = checkAdopted(off, on);
    expect(added.length).toBe(2);
    const ids = on.floors[1].spaces.filter(s => s.label === CONN).map(s => s.id);
    expect(ids).toEqual(['corridor-1-009', 'corridor-1-00a']);
  });

  it('no clean gap → candidate unchanged (options off: lshape b4, single floor)', () => {
    const cases: [object, string][] = [
      [mk({ ...R, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } }, { ...B, bedrooms: 3, bathrooms: 2, hasStorage: true }, 42), 'area-efficiency'],
      [mk(R, { ...B, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 }, 42), 'daylight-orientation'],
      [FIX.rectB4, 'area-efficiency'],
    ];
    for (const [inp, st] of cases) {
      const off = cand(inp, st, {});
      const on = cand(inp, st, { connectIsolatedRooms: true });
      expect(JSON.stringify(on.floors)).toBe(JSON.stringify(off.floors));
      expect(on.explanations.some(e => e.startsWith(ADOPTED))).toBe(false);
    }
  });

  it('adoptRoomAccessConnectorVariant guard: accept / reject', () => {
    const f = (code: string, severity: Finding['severity'] = 'hard') => ({ code, severity, message: '' }) as Finding;
    const sp = (id: string, type: string, rect: Rect) => ({ id, type, rect, area: rect.w * rect.h, label: id });
    const room = sp('bedroom-1-001', 'bedroom', { x: 2, y: 13.39, w: 3, h: 4 });
    const cor = sp('corridor-1-000', 'corridor', { x: 2, y: 10.25, w: 10, h: 1.5 });
    const conn = sp('corridor-1-002', 'corridor', { x: 2, y: 11.75, w: 1.5, h: 1.64 });
    const c = (valid: boolean, findings: Finding[], spaces: object[]) =>
      ({ valid, findings, floors: [{ spaces: [] }, { spaces }], explanations: [] }) as unknown as LayoutCandidate;
    const base = c(false, [f('CIRC_INACCESSIBLE_SPACE'), f('CONSTRAINT_DIRECT_ACCESS'), f('ROOM-001')], [cor, room]);
    // accept: circulation HARD 2 → 0, HARD 3 → 1, no new code
    const ok = c(false, [f('ROOM-001')], [cor, room, conn]);
    expect(adoptRoomAccessConnectorVariant(base, ok)).toBe(ok);
    expect(ok.explanations[0]).toMatch(/^Phase 5\.4E: isolated-room connector variant adopted \(1 connector/);
    // reject: new HARD code
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('GEO_OVERLAPPING_ROOMS')], [cor, room, conn]))).toBe(base);
    // reject: circulation HARD not strictly decreased
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('CIRC_INACCESSIBLE_SPACE'), f('CONSTRAINT_DIRECT_ACCESS')], [cor, room, conn]))).toBe(base);
    // reject: total HARD increased (existing code repeated)
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('ROOM-001'), f('ROOM-001'), f('ROOM-001'), f('ROOM-001')], [cor, room, conn]))).toBe(base);
    // reject: validity lost
    const vb = c(true, [f('CIRC_ROOM_THROUGH_ROOM', 'soft')], [cor, room]);
    expect(adoptRoomAccessConnectorVariant(vb, c(false, [], [cor, room, conn]))).toBe(vb);
    // reject: a room moved / area changed
    const moved = sp('bedroom-1-001', 'bedroom', { x: 2, y: 13.3, w: 3, h: 4 });
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('ROOM-001')], [cor, moved, conn]))).toBe(base);
    const resized = { ...room, area: room.area + 1 };
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('ROOM-001')], [cor, resized, conn]))).toBe(base);
    // reject: connector overlaps a space
    const bad = sp('corridor-1-002', 'corridor', { x: 2, y: 11.5, w: 1.5, h: 1.89 });
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('ROOM-001')], [cor, room, bad]))).toBe(base);
    // reject: connector below the corridor minimum width
    const thin = sp('corridor-1-002', 'corridor', { x: 2, y: 11.75, w: 1.0, h: 1.64 });
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('ROOM-001')], [cor, room, thin]))).toBe(base);
    // reject: added space is not a corridor
    const notCorr = { ...conn, type: 'storage' };
    expect(adoptRoomAccessConnectorVariant(base, c(false, [f('ROOM-001')], [cor, room, notCorr]))).toBe(base);
    // identical floors → base
    expect(adoptRoomAccessConnectorVariant(base, c(false, [], [cor, room]))).toBe(base);
  });

  it('deterministic', () => {
    for (const [inp, st, o] of [[FIX.rect14B3lift, 'area-efficiency', {}], [FIX.multi, 'daylight-orientation', ALL7]] as const) {
      const a = cand(inp, st, { ...o, connectIsolatedRooms: true });
      const b = cand(inp, st, { ...o, connectIsolatedRooms: true });
      expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
      expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
    }
  });

  it('option false is identical to omitted (generator + pipeline DXF)', () => {
    for (const inp of [FIX.rectB4, FIX.rect14B3lift]) {
      for (const st of ['area-efficiency', 'alternative-zoning']) {
        expect(JSON.stringify(cand(inp, st, { connectIsolatedRooms: false }).floors))
          .toBe(JSON.stringify(cand(inp, st, {}).floors));
      }
      const omit = generate(createProject(clone(inp) as never)).candidates;
      const off = generate(createProject(clone(inp) as never), { connectIsolatedRooms: false }).candidates;
      expect(off.length).toBe(omit.length);
      off.forEach((c, i) => expect(writeDXF(c)).toBe(writeDXF(omit[i])));
    }
  });

  it('interactions: each existing option (and all seven) + 5.4E never adds a HARD code, never loses validity', () => {
    const others = [
      { preferDiningKitchenAdjacency: true }, { preferLShapeProgrammeAdjacency: true }, { galleryDaylightAware: true },
      { connectStairCore: true }, { programmeDoorCompletion: true }, { stackPublicForDaylight: true }, { bridgeThinStairGap: true }, ALL7,
    ];
    for (const [inp, st] of [[FIX.rectB4, 'alternative-zoning'], [FIX.rect14B3lift, 'area-efficiency']] as const) for (const o of others) {
      const alone = cand(inp, st, o);
      const both = cand(inp, st, { ...o, connectIsolatedRooms: true });
      const codes = new Set(hard(alone).map(f => f.code));
      for (const f of hard(both)) expect(codes.has(f.code), f.code).toBe(true);
      expect(hard(both).length).toBeLessThanOrEqual(hard(alone).length);
      expect(circHard(both)).toBeLessThanOrEqual(circHard(alone));
      expect(both.valid || !alone.valid).toBe(true);
      expect(JSON.stringify(cand(inp, st, { ...o, connectIsolatedRooms: true }).floors)).toBe(JSON.stringify(both.floors));
    }
  });
});

const n = (c: LayoutCandidate, code: string) => c.findings.filter(f => f.code === code).length;
