/**
 * Phase 5.6C — opt-in `linkLShapeWingCorridors` (L-shape east–west wing-corridor link).
 *
 * On L-shape sites, after wing-plan selection, when the bridge strip and a parallel wing
 * corridor face each other across an empty gap without being circulation-connected, one
 * cut-perpendicular corridor link of L_CONNECTOR_W is added across the gap
 * (findWingCorridorLink). Selection, rooms, stair / elevator halls and existing corridors
 * never change. Adopted only through adoptLShapeWingLinkVariant. Omitted or false must be
 * byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, type GenerateLayoutsOptions } from './generator.js';
import { findWingCorridorLink } from './l-shape.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { CORRIDOR_MIN_WIDTH } from '../units.js';
import type { Rect } from '../geometry/index.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Space } from '../model/space.js';
import type { ProjectInput } from '../model/project.js';

const E = 1e-6;
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B1 = { ...B2, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 };
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const BEST: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true,
};
const ON: GenerateLayoutsOptions = { ...BEST, linkLShapeWingCorridors: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const gen = (inp: ProjectInput, opts?: GenerateLayoutsOptions) =>
  opts === undefined ? generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS])
    : generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS], opts);
const byStrategy = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const snap = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));
const snapOne = (c: LayoutCandidate) => JSON.stringify({ ...c, metadata: { ...c.metadata, generatedAt: 0 } });
const hard = (c: LayoutCandidate, code?: string) => c.findings.filter(f => f.severity === 'hard' && (code === undefined || f.code === code));
const counts = (c: LayoutCandidate) => {
  const m = new Map<string, number>();
  for (const f of c.findings) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
  return m;
};

// ---------------------------------------------------------------- pure link search
describe('Phase 5.6C findWingCorridorLink (lshape/b1 daylight-orientation wing plan)', () => {
  // Buildable L: rects [2,1.5,12,21.5] + [14,1.5,4,15.5].
  const BOUNDARY: Polygon = [{ x: 2, y: 1.5 }, { x: 18, y: 1.5 }, { x: 18, y: 17 }, { x: 14, y: 17 }, { x: 14, y: 23 }, { x: 2, y: 23 }];
  const sp = (id: string, type: string, r: Rect) => ({ id, type, rect: r }) as unknown as Space;
  const ROOMS = [
    sp('master-bathroom-0-008', 'master-bathroom', { x: 8, y: 1.5, w: 4.5, h: 1.94 }),
    sp('guest-wc-0-002', 'guest-wc', { x: 5.23, y: 1.5, w: 1.27, h: 2.3 }),
    sp('living-0-003', 'living', { x: 2, y: 3.8, w: 4.5, h: 8.6 }),
    sp('master-bedroom-0-007', 'master-bedroom', { x: 14, y: 1.5, w: 4, h: 7 }),
  ];
  const SPINE = sp('corridor-0', 'corridor', { x: 6.5, y: 1.5, w: 1.5, h: 21.5 });
  const STRIP = sp('corridor-bridge', 'corridor', { x: 12.5, y: 1.5, w: 1.5, h: 21.5 });

  it('links spine and strip across the empty band: first free position above the bathroom', () => {
    const link = findWingCorridorLink(ROOMS, [SPINE, STRIP], BOUNDARY)!;
    expect(link).not.toBeNull();
    expect(link.fromId).toBe('corridor-0');
    expect(link.toId).toBe('corridor-bridge');
    expect(link.rect.x).toBeCloseTo(8, 9);
    expect(link.rect.y).toBeCloseTo(3.44, 9);
    expect(link.rect.w).toBeCloseTo(4.5, 9);
    expect(link.rect.h).toBeCloseTo(1.5, 9);
    expect(Math.min(link.rect.w, link.rect.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - E);
  });
  it('deterministic and pure (inputs untouched)', () => {
    const before = JSON.stringify([ROOMS, SPINE, STRIP]);
    expect(findWingCorridorLink(ROOMS, [SPINE, STRIP], BOUNDARY)).toEqual(findWingCorridorLink(ROOMS, [SPINE, STRIP], BOUNDARY));
    expect(JSON.stringify([ROOMS, SPINE, STRIP])).toBe(before);
  });
  it('no-op: corridors already connected', () => {
    const link = sp('corridor-link', 'corridor', { x: 8, y: 10, w: 4.5, h: 1.5 });
    expect(findWingCorridorLink(ROOMS, [SPINE, STRIP, link], BOUNDARY)).toBeNull();
  });
  it('no-op: band fully occupied', () => {
    const fill = sp('bedroom-0-009', 'bedroom', { x: 8, y: 3.44, w: 4.5, h: 19.56 });
    expect(findWingCorridorLink([...ROOMS, fill], [SPINE, STRIP], BOUNDARY)).toBeNull();
  });
  it('no-op: no bridge strip in the plan', () => {
    expect(findWingCorridorLink(ROOMS, [SPINE, { ...STRIP, id: 'corridor-1' } as Space], BOUNDARY)).toBeNull();
  });
  it('no-op: gap thinner than CORRIDOR_MIN_WIDTH', () => {
    const near = sp('corridor-0', 'corridor', { x: 12.5 - 1.5 - 1.0, y: 1.5, w: 1.5, h: 21.5 });
    expect(findWingCorridorLink([], [near, STRIP], BOUNDARY)).toBeNull();
  });
  it('no-op: facing overlap shorter than L_CONNECTOR_W', () => {
    const short = sp('corridor-0', 'corridor', { x: 6.5, y: 21.9, w: 1.5, h: 1.1 });
    expect(findWingCorridorLink([], [short, STRIP], BOUNDARY)).toBeNull();
  });
  it('no-op: link would leave the buildable boundary', () => {
    const tiny: Polygon = [{ x: 2, y: 1.5 }, { x: 8.2, y: 1.5 }, { x: 8.2, y: 23 }, { x: 2, y: 23 }];
    expect(findWingCorridorLink(ROOMS, [SPINE, STRIP], tiny)).toBeNull();
  });
});

// ---------------------------------------------------------------- generator
describe('Phase 5.6C generator (lshape/b1 daylight-orientation)', () => {
  for (const seed of [42, 7]) {
    it(`seed ${seed}: CIRC_ROOM_THROUGH_ROOM cleared, valid, only the link added`, () => {
      const b = byStrategy(gen(input(LSHAPE, B1, seed), BEST), 'daylight-orientation');
      const c = byStrategy(gen(input(LSHAPE, B1, seed), ON), 'daylight-orientation');
      expect(b.valid).toBe(false);
      expect(hard(b).map(f => f.code)).toEqual(['CIRC_ROOM_THROUGH_ROOM']);
      expect(c.valid).toBe(true);
      expect(hard(c)).toHaveLength(0);
      // every other finding count identical (soft / advisory included)
      const cb = counts(b), cc = counts(c);
      cb.delete('hard:CIRC_ROOM_THROUGH_ROOM');
      expect([...cc].sort()).toEqual([...cb].sort());
      expect(c.explanations.some(e => e.startsWith('Phase 5.6C: L-shape wing-corridor link variant adopted'))).toBe(true);
      // geometry: every base space identical (id, type, rect, exterior wall); one new corridor
      const fb = b.floors[0], fc = c.floors[0];
      for (const s of fb.spaces) {
        const v = fc.spaces.find(x => x.id === s.id)!;
        expect(v).toBeDefined();
        expect(v.type).toBe(s.type);
        expect(v.rect).toEqual(s.rect);
        expect(v.hasExteriorWall).toBe(s.hasExteriorWall);
      }
      const added = fc.spaces.filter(s => !fb.spaces.some(x => x.id === s.id));
      expect(added).toHaveLength(1);
      expect(added[0].type).toBe('corridor');
      expect(added[0].rect.x).toBeCloseTo(8, 6);
      expect(added[0].rect.y).toBeCloseTo(3.44, 6);
      expect(added[0].rect.w).toBeCloseTo(4.5, 6);
      expect(added[0].rect.h).toBeCloseTo(1.5, 6);
      // the bathroom is no longer the strip's access: its only corridor door is to the spine
      const doors = (fc.openings ?? []).filter(o => o.type === 'door');
      const mb = fc.spaces.find(s => s.type === 'master-bathroom')!;
      const strip = fc.spaces.find(s => s.type === 'corridor' && Math.abs(s.rect.x - 12.5) < E)!;
      expect(doors.some(o => [o.spaceA, o.spaceB].includes(mb.id) && [o.spaceA, o.spaceB].includes(strip.id))).toBe(false);
      expect(doors.some(o => [o.spaceA, o.spaceB].includes(added[0].id) && [o.spaceA, o.spaceB].includes(strip.id))).toBe(true);
    });
  }
  it('other lshape/b1 strategies unchanged', () => {
    for (const seed of [42, 7]) {
      const b = gen(input(LSHAPE, B1, seed), BEST), c = gen(input(LSHAPE, B1, seed), ON);
      for (const s of ['area-efficiency', 'functional-circulation', 'alternative-zoning']) {
        expect(snapOne(byStrategy(c, s))).toBe(snapOne(byStrategy(b, s)));
      }
    }
  });
  it('every other L-shape candidate is unchanged (links not adopted by the guard)', () => {
    for (const prog of [B2, B3LIFT, B4]) for (const seed of [42, 7]) {
      const b = gen(input(LSHAPE, prog, seed), BEST), c = gen(input(LSHAPE, prog, seed), ON);
      for (const s of STRATS) expect(snapOne(byStrategy(c, s))).toBe(snapOne(byStrategy(b, s)));
    }
  });
  it('no-op on rectangular sites', () => {
    for (const site of [RECT, { ...RECT, width: 14, length: 22 }]) {
      const inp = input(site, B1, 42);
      expect(snap(gen(inp, ON))).toBe(snap(gen(inp, BEST)));
    }
  });
  it('deterministic', () => {
    const inp = input(LSHAPE, B1, 42);
    expect(snap(gen(inp, ON))).toBe(snap(gen(inp, ON)));
  });
});

// ---------------------------------------------------------------- OFF identity + DXF
describe('Phase 5.6C OFF identity', () => {
  it('generateLayouts: option omitted and false are byte-identical', () => {
    for (const inp of [input(LSHAPE, B1, 42), input(LSHAPE, B1, 7), input(LSHAPE, B4, 42), input(RECT, B2, 42)]) {
      expect(snap(gen(inp, { linkLShapeWingCorridors: false }))).toBe(snap(gen(inp)));
      expect(snap(gen(inp, { ...BEST, linkLShapeWingCorridors: false }))).toBe(snap(gen(inp, BEST)));
    }
  });
  it('pipeline DXF: omitted and false identical; R12 header is only $ACADVER = AC1009', () => {
    const dxfs = (opts: object) => {
      const r = generate(createProject(input(LSHAPE, B1, 42)), { allStrategies: true, topCandidates: 4, ...BEST, ...opts });
      return r.candidates.map(c => writeDXF(c, 'QA'));
    };
    const a = dxfs({}), b = dxfs({ linkLShapeWingCorridors: false }), on = dxfs({ linkLShapeWingCorridors: true });
    expect(b).toEqual(a);
    expect(on.length).toBeGreaterThan(a.length);
    for (const d of [...a, ...on]) {
      const hdr = d.slice(0, d.indexOf('ENDSEC'));
      expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
      expect(hdr).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    }
  });
});
