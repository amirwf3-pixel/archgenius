/**
 * P2 — rectangle public-band families extracted from placeSpacesFacingSouth.
 * The extraction is behaviour-preserving (the layout regression harness proves the
 * production output byte-identical); these tests pin the family contract:
 * plan() pure and deterministic, demand() = the extent of the same plan, place()
 * replays the plan's cells through mkSpace in order.
 */
import { describe, it, expect } from 'vitest';
import {
  PUBLIC_FAMILIES, publicGalleryContext, publicGalleryRowFits, publicMainContext, publicPlanDemand,
  type PlacedSpec, type PublicFamily, type PublicFamilyPlan, type PublicGalleryContext, type PublicMainContext,
} from './placer.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { Rect } from '../geometry/rect.js';
import type { Space, SpaceType, Zone } from '../model/space.js';

type Building = Parameters<typeof allocateBuildingProgram>[0];
const villa = (o: Partial<Building> = {}): Building => ({
  type: 'villa', bedrooms: 1, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 0,
  kitchenType: 'open', hasStair: false, floors: 1, ...o,
} as Building);
function groundSpecs(b: Building): PlacedSpec[] {
  const [al] = allocateBuildingProgram(b, 1);
  return programForFloor(b, 0, true, al).map((s, k) => ({ ...s, placedId: `${s.type}-${k}`, placedLabel: s.type }) as PlacedSpec);
}
const specs = groundSpecs(villa());
const one = (t: string) => specs.find(s => s.type === t)!;
const living = one('living'), dining = one('dining'), guestWc = one('guest-wc');
const entry = specs.filter(s => s.type === 'entrance' || s.type === 'foyer');
const mainPref = (s: PlacedSpec, cross: number) => Math.max(s.minLength ?? s.minWidth ?? 1.2, Math.max(s.minArea ?? 0, 12) / Math.max(cross, 0.5));

const footprint: Rect = { x: 2, y: 1.5, w: 14, h: 20.5 };
const BANDS: Rect[] = [
  { x: 2, y: 1.5, w: 9.6, h: 7.9 },    // wide band: gallery row
  { x: 2, y: 1.5, w: 11.6, h: 8.5 },
  { x: 3.4, y: 1.5, w: 3.2, h: 14 },   // tall-narrow: entry column / stack
  { x: 2, y: 1.5, w: 16, h: 3.6 },     // shallow
  { x: 1.35, y: 2.15, w: 10.03, h: 9.87 },
];
const corridors = (b: Rect): Rect[] => [{ x: b.x, y: b.y + b.h, w: b.w, h: 1.5 }];
const kitchenFor = (b: Rect): Rect => ({ x: b.x + b.w, y: b.y, w: 2.4, h: b.h });

const galleryFamilies = [
  PUBLIC_FAMILIES.diningFacadeRow, PUBLIC_FAMILIES.diningEntryColumn, PUBLIC_FAMILIES.daylightGallery,
  PUBLIC_FAMILIES.entryGallery, PUBLIC_FAMILIES.entryColumn,
] as PublicFamily<PublicGalleryContext>[];
const mainFamilies = [PUBLIC_FAMILIES.stacked, PUBLIC_FAMILIES.shallowBand, PUBLIC_FAMILIES.sideBySide] as PublicFamily<PublicMainContext>[];

function galleryCtx(b: Rect, withKitchen = true): PublicGalleryContext {
  const g = publicGalleryContext(footprint, b, living, dining, entry, guestWc, withKitchen ? kitchenFor(b) : null, corridors(b));
  expect(g).not.toBeNull();
  return g!;
}
const recorder = () => {
  const calls: { type: SpaceType; rect: Rect; label: string; id: string; zone: Zone }[] = [];
  const mk = (type: SpaceType, rect: Rect, label: string, id: string, zone: Zone) => {
    calls.push({ type, rect, label, id, zone });
    return { type, rect: { ...rect }, id, label, zone } as unknown as Space;
  };
  return { calls, mk };
};

function expectContract<C>(fam: PublicFamily<C>, ctx: C): PublicFamilyPlan | null {
  const before = JSON.stringify(ctx);
  const p = fam.plan(ctx);
  expect(JSON.stringify(ctx)).toBe(before); // pure: the context is not mutated
  expect(fam.plan(ctx)).toEqual(p);         // deterministic
  const d = fam.demand(ctx);
  if (!p) { expect(d).toBeNull(); return null; }
  expect(p.family).toBe(fam.id);
  expect(d).toEqual(publicPlanDemand(p));
  // demand = extent of the plan's cells from the band origin
  const maxY = Math.max(...p.cells.map(c => c.rect.y + c.rect.h));
  const maxX = Math.max(...p.cells.map(c => c.rect.x + c.rect.w));
  expect(d!.depth).toBeCloseTo(maxY - p.band.y, 12);
  expect(d!.width).toBeCloseTo(maxX - p.band.x, 12);
  for (const c of p.cells) {
    expect(c.rect.w).toBeGreaterThan(0);
    expect(c.rect.h).toBeGreaterThan(0);
  }
  // place replays the cells in order, then appends the explanation lines
  const { calls, mk } = recorder();
  const placed: Space[] = [];
  const explanation: string[] = ['pre'];
  fam.place(p, mk, placed, explanation);
  expect(calls).toEqual(p.cells);
  expect(placed.map(s => s.id)).toEqual(p.cells.map(c => c.id));
  expect(explanation).toEqual(['pre', ...p.explanation]);
  return p;
}

describe('rectangle public-band families (P2)', () => {
  it('gallery families: pure plans, demand = plan extent, place replays in order', () => {
    let planned = 0;
    for (const b of BANDS) for (const k of [true, false]) {
      const g = galleryCtx(b, k);
      for (const fam of galleryFamilies) {
        const p = expectContract(fam, g);
        if (!p) continue;
        planned++;
        // gallery plans report the start of the living field
        expect(p.bottom).toBeDefined();
        expect(p.bottom!).toBeGreaterThan(b.y);
        for (const c of p.cells) expect(['entrance', 'foyer', 'guest-wc', 'living', 'dining']).toContain(c.type);
      }
    }
    expect(planned).toBeGreaterThan(0);
  });

  it('entry gallery (row) vs entry column: selected by the legacy row-fit guard', () => {
    const wide = galleryCtx(BANDS[0]);
    expect(publicGalleryRowFits(wide)).toBe(true);
    const p = PUBLIC_FAMILIES.entryGallery.plan(wide)!;
    expect(p).not.toBeNull();
    // one row across the band front: every cell starts at the band's front edge
    for (const c of p.cells) expect(c.rect.y).toBe(BANDS[0].y);
    expect(p.cells.map(c => c.type)[0]).toBe('entrance');

    const narrow = galleryCtx(BANDS[2]);
    expect(publicGalleryRowFits(narrow)).toBe(false);
    const q = PUBLIC_FAMILIES.entryColumn.plan(narrow)!;
    expect(q).not.toBeNull();
    expect(q.explanation[0]).toMatch(/^Phase15 M3 entry column/);
  });

  it('living/dining families: pure plans, demand = plan extent, place replays in order', () => {
    for (const b of BANDS) for (const [gwc, pool] of [[guestWc, entry], [undefined, []]] as const) {
      const m = publicMainContext(b, living, dining, gwc, [...pool], mainPref);
      for (const fam of mainFamilies) {
        const p = expectContract(fam, m);
        expect(p).not.toBeNull(); // these branches always paint once selected
        const types = p!.cells.map(c => c.type);
        expect(types).toContain('living');
        expect(types).toContain('dining');
      }
    }
  });

  it('shallow band hosts the whole public programme (entry rooms, guest WC, living, dining)', () => {
    const b = BANDS[3];
    const m = publicMainContext(b, living, dining, guestWc, [...entry], mainPref);
    const p = PUBLIC_FAMILIES.shallowBand.plan(m)!;
    expect(p.cells.map(c => c.id).sort()).toEqual([...entry, guestWc, living, dining].map(s => s.placedId).sort());
    // the legacy min-aware binary splitter (overflow allowed when minimums exceed the band)
    expect(publicPlanDemand(p)).toEqual(PUBLIC_FAMILIES.shallowBand.demand(m));
    expect(Math.min(...p.cells.map(c => c.rect.y))).toBeCloseTo(b.y, 9);
  });

  it('stacked: living over dining on a narrow band; side-by-side: living | dining on a wide one', () => {
    const narrow = publicMainContext(BANDS[2], living, dining, undefined, [], mainPref);
    const s = PUBLIC_FAMILIES.stacked.plan(narrow)!;
    const [lv, dn] = s.cells;
    expect([lv.type, dn.type]).toEqual(['living', 'dining']);
    expect(dn.rect.y).toBeCloseTo(lv.rect.y + lv.rect.h, 9);

    const wide = publicMainContext(BANDS[1], living, dining, undefined, [], mainPref);
    const r = PUBLIC_FAMILIES.sideBySide.plan(wide)!;
    const [l2, d2] = r.cells;
    expect([l2.type, d2.type]).toEqual(['living', 'dining']);
    expect(d2.rect.x).toBeCloseTo(l2.rect.x + l2.rect.w, 9);
    expect(d2.rect.y).toBe(l2.rect.y);
  });

  it('family ids are unique and cover every extracted branch', () => {
    const ids = Object.values(PUBLIC_FAMILIES).map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([
      'daylight-gallery-5.4A', 'dining-entry-column-5.5D', 'dining-facade-row-5.5A',
      'entry-column', 'entry-gallery', 'shallow-band', 'side-by-side', 'stacked',
    ]);
  });
});
