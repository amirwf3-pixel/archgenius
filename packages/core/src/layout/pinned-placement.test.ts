/**
 * P3 — optional pinned inputs to placeSpaces(): `pinnedZones` (an authoritative zone
 * partition used instead of carveZones) and `publicFamily` (the public-band family used
 * instead of the placer's selection). Absent / null / undefined options execute the
 * existing logic exactly (the layout regression harness proves the production output
 * byte-identical); these tests pin the option contract.
 */
import { describe, it, expect } from 'vitest';
import {
  placeSpaces, rectangleZoneLayout, type PlacedSpec, type PlacerOptions, type PublicFamilyId, type ZoneLayout,
} from './placer.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import { createRectangleRoomPolygon } from '../geometry/room-polygon.js';
import type { Rect } from '../geometry/rect.js';
import type { Space, SpaceType, Zone } from '../model/space.js';
import type { CandidateStrategy } from '../model/index.js';

type Building = Parameters<typeof allocateBuildingProgram>[0];
type Access = 'north' | 'south' | 'east' | 'west';
const villa = (o: Partial<Building> = {}): Building => ({
  type: 'villa', bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, parkingSpaces: 0,
  kitchenType: 'open', hasStair: false, floors: 1, ...o,
} as Building);
function groundSpecs(b: Building): PlacedSpec[] {
  const [al] = allocateBuildingProgram(b, 1);
  return programForFloor(b, 0, true, al).map((s, k) => ({ ...s, placedId: `${s.type}-${k}`, placedLabel: s.type }) as PlacedSpec);
}
const mk = (type: SpaceType, rect: Rect, label: string, id: string, zone: Zone): Space =>
  ({ type, rect: { ...rect }, polygon: createRectangleRoomPolygon(rect), label, id, zone }) as unknown as Space;

const specs = groundSpecs(villa());
const fresh = () => specs.map(s => ({ ...s }));
const FOOTPRINTS: Rect[] = [
  { x: 0, y: 0, w: 14, h: 20 },
  { x: 1.35, y: 2.15, w: 11, h: 24 },
  { x: 0, y: 0, w: 20, h: 12 },
];
const STRATEGIES: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const ACCESS: Access[] = ['south', 'north', 'east', 'west'];
const run = (fp: Rect, st: CandidateStrategy, acc: Access, opts?: PlacerOptions) =>
  opts === undefined ? placeSpaces(fp, fresh(), st, acc, mk) : placeSpaces(fp, fresh(), st, acc, mk, opts);
const rooms = (o: { spaces: Space[]; corridors: Space[] }) =>
  [...o.spaces, ...o.corridors].map(s => ({ type: s.type, id: s.id, zone: s.zone, rect: s.rect }));
const inside = (r: Rect, o: Rect, e = 1e-6) =>
  r.x >= o.x - e && r.y >= o.y - e && r.x + r.w <= o.x + o.w + e && r.y + r.h <= o.y + o.h + e;

describe('P3 pinned placement inputs — off path', () => {
  it('options omitted, {} and explicit undefined / null are all identical', () => {
    for (const fp of FOOTPRINTS) for (const st of STRATEGIES) for (const acc of ACCESS) {
      const ref = JSON.stringify(run(fp, st, acc));
      expect(JSON.stringify(run(fp, st, acc, {}))).toBe(ref);
      expect(JSON.stringify(run(fp, st, acc, { pinnedZones: undefined, publicFamily: undefined }))).toBe(ref);
      expect(JSON.stringify(run(fp, st, acc, { pinnedZones: null, publicFamily: null }))).toBe(ref);
    }
  });

  it('an unpinned run carries no P3 notes', () => {
    const o = run(FOOTPRINTS[0], 'area-efficiency', 'south');
    expect(o.explanation.some(x => x.startsWith('P3'))).toBe(false);
  });
});

describe('P3 pinnedZones', () => {
  it('pinning the zones the placer would carve reproduces the unpinned placement', () => {
    for (const fp of FOOTPRINTS) for (const st of STRATEGIES) for (const acc of ACCESS) {
      const ref = run(fp, st, acc);
      const pinned = run(fp, st, acc, { pinnedZones: rectangleZoneLayout(fp, fresh(), st, acc) });
      expect(pinned.explanation.filter(x => !x.startsWith('P3 pinned zones'))).toEqual(ref.explanation);
      expect(pinned.explanation.some(x => x.startsWith('P3 pinned zones'))).toBe(true);
      const a = rooms(ref), b = rooms(pinned);
      if (acc === 'south') { expect(b).toEqual(a); continue; }
      // other access sides round-trip the zones through the orientation frame
      expect(b.map(s => [s.type, s.id, s.zone])).toEqual(a.map(s => [s.type, s.id, s.zone]));
      b.forEach((s, i) => {
        for (const k of ['x', 'y', 'w', 'h'] as const) expect(s.rect[k]).toBeCloseTo(a[i].rect[k], 6);
      });
    }
  });

  it('a custom zone partition is used instead of carveZones', () => {
    const fp = FOOTPRINTS[0];
    const legacy = rectangleZoneLayout(fp, fresh(), 'area-efficiency', 'south');
    // hand the public band 1 m less depth and give it to the private side
    const pub = legacy.zones.public[0];
    const custom: ZoneLayout = {
      ...legacy,
      zones: { ...legacy.zones, public: [{ ...pub, h: pub.h - 1 }] },
    };
    const ref = run(fp, 'area-efficiency', 'south');
    const out = run(fp, 'area-efficiency', 'south', { pinnedZones: custom });
    expect(JSON.stringify(rooms(out))).not.toBe(JSON.stringify(rooms(ref)));
    expect(out.explanation.some(x => x.startsWith('P3 pinned zones'))).toBe(true);
    for (const s of out.spaces) expect(inside(s.rect, fp, 1e-3)).toBe(true);
    // the caller's layout object is not mutated
    expect(custom.zones.public[0].h).toBeCloseTo(pub.h - 1, 12);
  });

  it('pinned zones are copied, never mutated, for every access side', () => {
    const fp = FOOTPRINTS[1];
    for (const acc of ACCESS) {
      const z = rectangleZoneLayout(fp, fresh(), 'functional-circulation', acc);
      const snap = JSON.stringify(z);
      run(fp, 'functional-circulation', acc, { pinnedZones: z });
      expect(JSON.stringify(z)).toBe(snap);
    }
  });

  it('rejects structurally malformed pinned zones with a RangeError', () => {
    const fp = FOOTPRINTS[0];
    const z = rectangleZoneLayout(fp, fresh(), 'area-efficiency', 'south');
    const withPublic = (r: unknown): ZoneLayout => ({ ...z, zones: { ...z.zones, public: [r as Rect] } });
    const bad: ZoneLayout[] = [
      withPublic({ x: 0, y: 0, w: Number.NaN, h: 5 }),
      withPublic({ x: 0, y: Number.POSITIVE_INFINITY, w: 4, h: 5 }),
      withPublic({ x: 0, y: 0, w: 4 }),
      withPublic(null),
      { ...z, corridors: [{ x: 0, y: 19, w: 14, h: Number.NaN }] },
      { ...z, corridors: undefined } as unknown as ZoneLayout,
      { ...z, zones: undefined } as unknown as ZoneLayout,
      { ...z, zones: { ...z.zones, private: 'x' } } as unknown as ZoneLayout,
      { ...z, elevatorPocket: { x: 1, y: 1, w: Number.NaN, h: 2 } },
    ];
    for (const b of bad) expect(() => run(fp, 'area-efficiency', 'south', { pinnedZones: b })).toThrow(RangeError);
    for (const acc of ACCESS) expect(() => run(fp, 'area-efficiency', acc, { pinnedZones: bad[0] })).toThrow(RangeError);
  });
});

describe('P3 publicFamily', () => {
  const FAMILIES: PublicFamilyId[] = [
    'entry-gallery', 'entry-column', 'daylight-gallery-5.4A', 'dining-facade-row-5.5A', 'dining-entry-column-5.5D',
    'stacked', 'side-by-side', 'shallow-band',
  ];
  // each placed family leaves its own existing explanation note
  const SIGNATURE: Record<PublicFamilyId, RegExp> = {
    'entry-gallery': /^Phase15 M3 entry gallery/,
    'entry-column': /^Phase15 M3 entry column/,
    'daylight-gallery-5.4A': /^Phase 5\.4A daylight-aware entry gallery/,
    'dining-facade-row-5.5A': /^Phase 5\.5A dining façade row/,
    'dining-entry-column-5.5D': /dining entry column/,
    'stacked': /./,
    'side-by-side': /./,
    'shallow-band': /^P17-E shallow-band public row/,
  };

  it('every pinned family is used or reported not applicable — never substituted', () => {
    const fp = FOOTPRINTS[0];
    const placedIds: string[] = [];
    for (const id of FAMILIES) {
      const out = run(fp, 'area-efficiency', 'south', { publicFamily: id });
      const note = out.explanation.find(x => x.startsWith(`P3 pinned public family ${id}:`));
      expect(note, id).toBeDefined();
      if (/: placed$/.test(note!)) {
        placedIds.push(id);
        expect(out.explanation.some(x => SIGNATURE[id].test(x)), id).toBe(true);
      }
      // the other entry-layer families are not painted
      if (id === 'entry-column') expect(out.explanation.some(x => /^Phase15 M3 entry gallery/.test(x))).toBe(false);
      if (id === 'entry-gallery' || id === 'daylight-gallery-5.4A') expect(out.explanation.some(x => /^Phase15 M3 entry column/.test(x))).toBe(false);
      for (const s of out.spaces) expect(Number.isFinite(s.rect.x + s.rect.y + s.rect.w + s.rect.h)).toBe(true);
    }
    // in this plan every family but the 5.5D column (its own guard) applies
    expect(placedIds).toEqual(FAMILIES.filter(f => f !== 'dining-entry-column-5.5D'));
  });

  it('a pinned complete daylight family places living + dining itself (no living/dining family on top)', () => {
    const out = run(FOOTPRINTS[0], 'area-efficiency', 'south', { publicFamily: 'daylight-gallery-5.4A' });
    expect(out.spaces.filter(s => s.type === 'living')).toHaveLength(1);
    expect(out.spaces.filter(s => s.type === 'dining')).toHaveLength(1);
    expect(out.explanation.some(x => /^P17-E shallow-band public row/.test(x))).toBe(false);
  });

  it('a pinned living/dining family replaces the default selection', () => {
    const fp = FOOTPRINTS[0];
    const ref = run(fp, 'area-efficiency', 'south');
    expect(ref.explanation.some(x => /^P17-E shallow-band public row/.test(x))).toBe(false);
    const band = run(fp, 'area-efficiency', 'south', { publicFamily: 'shallow-band' });
    expect(band.explanation.some(x => /^P17-E shallow-band public row/.test(x))).toBe(true);
    // default here is side-by-side; the pinned stack puts dining behind living
    const stack = run(fp, 'area-efficiency', 'south', { publicFamily: 'stacked' });
    const r = (o: typeof ref, t: string) => o.spaces.find(s => s.type === t)!.rect;
    expect(JSON.stringify(rooms(stack))).not.toBe(JSON.stringify(rooms(ref)));
    expect(r(stack, 'dining').y).toBeGreaterThan(r(stack, 'living').y);
    // rooms outside the public band are unchanged
    const nonPublic = (o: typeof ref) => rooms(o).filter(s => s.zone !== 'public');
    expect(nonPublic(stack)).toEqual(nonPublic(ref));
  });

  it('rejects an unknown family id', () => {
    expect(() => run(FOOTPRINTS[0], 'area-efficiency', 'south', { publicFamily: 'nope' as PublicFamilyId })).toThrow(RangeError);
  });
});

describe('P3 determinism', () => {
  it('repeated placements with pinned inputs are identical', () => {
    for (const fp of FOOTPRINTS) for (const acc of ACCESS) for (const fam of [undefined, 'stacked', 'entry-column', 'daylight-gallery-5.4A'] as const) {
      const opts = (): PlacerOptions => ({ pinnedZones: rectangleZoneLayout(fp, fresh(), 'daylight-orientation', acc), publicFamily: fam });
      const a = JSON.stringify(run(fp, 'daylight-orientation', acc, opts()));
      const b = JSON.stringify(run(fp, 'daylight-orientation', acc, opts()));
      const c = JSON.stringify(run(fp, 'daylight-orientation', acc, opts()));
      expect(b).toBe(a);
      expect(c).toBe(a);
    }
  });
});
