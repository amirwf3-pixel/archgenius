/**
 * Phase 5.3A — opt-in `preferDiningKitchenAdjacency` (rectangular placer).
 *
 * When the programme requires a dining↔kitchen door, the entry column may host
 * the guest WC (entrance sized down to its programme minimum) so the public band
 * no longer carves it between dining and the kitchen strip. Infeasible cases must
 * be IDENTICAL to the legacy output; OFF must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { placeSpaces, type PlacedSpec } from './placer.js';
import { generateLayouts } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Space, SpaceType, Zone, AdjacencyRequirement } from '../model/space.js';
import type { Rect } from '../geometry/index.js';

type Out = { spaces: Space[]; corridors: Space[]; explanation: string[] };

const mkSpace = (type: SpaceType, r: Rect, label: string, id: string, zone: Zone): Space => ({
  id, type, label, zone, privacy: zone === 'circulation' ? 'service' : zone,
  polygon: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  rect: { ...r }, area: r.w * r.h, targetArea: r.w * r.h, minArea: 0,
  wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
}) as unknown as Space;

const DK_DOOR: AdjacencyRequirement = { spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true };
const DK_SOFT: AdjacencyRequirement = { spaceType: 'kitchen', adjacent: true, weight: 3 };

function spec(type: SpaceType, minArea: number, targetArea: number, minWidth: number, privacy: 'public' | 'semi-private' | 'service', adjacencies?: AdjacencyRequirement[]): PlacedSpec {
  return { type, minArea, targetArea, minWidth, privacy, priority: 5, adjacencies, placedId: `${type}-x`, placedLabel: type } as PlacedSpec;
}

/** Ground-floor public programme (programme minimums from TYPICAL_AREAS). */
function groundSpecs(diningKitchen: AdjacencyRequirement): PlacedSpec[] {
  return [
    spec('entrance', 2.0, 3.0, 1.2, 'public'),
    spec('foyer', 3.0, 4.0, 1.4, 'public'),
    spec('guest-wc', 1.4, 2.0, 1.1, 'public'),
    spec('living', 12.0, 18.0, 3.0, 'public'),
    spec('dining', 7.0, 10.0, 2.4, 'semi-private', [diningKitchen]),
    spec('kitchen', 6.0, 10.0, 2.0, 'service', [{ ...diningKitchen, spaceType: 'dining' }]),
  ];
}

function run(fp: Rect, specs: PlacedSpec[], on: boolean): Out {
  const cloned = specs.map(s => ({ ...s }));
  return on
    ? placeSpaces(fp, cloned, 'functional-circulation', 'south', mkSpace, { preferDiningKitchenAdjacency: true })
    : placeSpaces(fp, cloned, 'functional-circulation', 'south', mkSpace);
}

const byType = (o: Out, t: string) => o.spaces.find(s => s.type === t);
/** Length of the shared boundary between two axis-aligned rects (0 when they only touch at a corner). */
function contact(a: Rect, b: Rect): number {
  const e = 1e-6;
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if ((Math.abs(a.x + a.w - b.x) < e || Math.abs(b.x + b.w - a.x) < e) && oy > e) return oy;
  if ((Math.abs(a.y + a.h - b.y) < e || Math.abs(b.y + b.h - a.y) < e) && ox > e) return ox;
  return 0;
}

// Footprints (generic fixtures, not benchmark geometry): the l-spur public band is
// deep enough for entrance+foyer+WC at programme minimums but NOT for the legacy
// 1.8 m entrance + M3 stack (foyer column < 3.9 m) → guest WC falls to the band.
const FEASIBLE: Rect = { x: 0, y: 0, w: 18, h: 13 };
// Band too shallow for the column even at programme minimums (entrance 1.2 +
// foyer 2.4 + WC 1.5 > band depth): legacy carve must be kept, never forced.
const SHALLOW: Rect = { x: 0, y: 0, w: 18, h: 11 };

describe('Phase 5.3A preferDiningKitchenAdjacency — placer', () => {
  it('feasible: guest WC moves to the entry column and dining shares a wall with the kitchen', () => {
    const off = run(FEASIBLE, groundSpecs(DK_DOOR), false);
    const on = run(FEASIBLE, groundSpecs(DK_DOOR), true);
    // Legacy: the WC is carved between dining and the kitchen strip.
    expect(contact(byType(off, 'dining')!.rect, byType(off, 'kitchen')!.rect)).toBe(0);
    expect(contact(byType(off, 'foyer')!.rect, byType(off, 'guest-wc')!.rect)).toBe(0);
    // Opt-in: dining↔kitchen shared wall, WC beside the foyer, foyer still on living.
    expect(contact(byType(on, 'dining')!.rect, byType(on, 'kitchen')!.rect)).toBeGreaterThan(1.0);
    expect(contact(byType(on, 'foyer')!.rect, byType(on, 'guest-wc')!.rect)).toBeGreaterThan(1.0);
    expect(contact(byType(on, 'foyer')!.rect, byType(on, 'living')!.rect)).toBeGreaterThan(1.0);
    expect(contact(byType(on, 'entrance')!.rect, byType(on, 'foyer')!.rect)).toBeGreaterThan(1.0);
    // Every entry-column room meets its programme minimums.
    for (const [t, minA, minW] of [['entrance', 2.0, 1.2], ['foyer', 3.0, 1.4], ['guest-wc', 1.4, 1.1]] as const) {
      const r = byType(on, t)!.rect;
      expect(r.w * r.h).toBeGreaterThanOrEqual(minA - 1e-9);
      expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(minW - 1e-9);
    }
    expect(on.explanation.some(e => e.startsWith('Phase5.3A entry column'))).toBe(true);
    // Same room set, no overlaps introduced.
    expect(on.spaces.map(s => s.type).sort()).toEqual(off.spaces.map(s => s.type).sort());
  });

  it('infeasible geometry (column too shallow at programme minimums): identical to legacy', () => {
    const off = run(SHALLOW, groundSpecs(DK_DOOR), false);
    const on = run(SHALLOW, groundSpecs(DK_DOOR), true);
    expect(byType(off, 'guest-wc')).toBeDefined();
    expect(on).toEqual(off);
  });

  it('no programme dining↔kitchen doorRequired adjacency: identical to legacy', () => {
    const off = run(FEASIBLE, groundSpecs(DK_SOFT), false);
    const on = run(FEASIBLE, groundSpecs(DK_SOFT), true);
    expect(on).toEqual(off);
  });

  it('no kitchen on the floor: identical to legacy', () => {
    const specs = groundSpecs(DK_DOOR).filter(s => s.type !== 'kitchen');
    expect(run(FEASIBLE, specs, true)).toEqual(run(FEASIBLE, specs, false));
  });

  it('option false / omitted is the legacy call', () => {
    const specs = groundSpecs(DK_DOOR);
    const legacy = run(FEASIBLE, specs, false);
    const explicitFalse = placeSpaces(FEASIBLE, specs.map(s => ({ ...s })), 'functional-circulation', 'south', mkSpace, { preferDiningKitchenAdjacency: false });
    expect(explicitFalse).toEqual(legacy);
  });

  it('deterministic', () => {
    expect(run(FEASIBLE, groundSpecs(DK_DOOR), true)).toEqual(run(FEASIBLE, groundSpecs(DK_DOOR), true));
  });
});

describe('Phase 5.3A preferDiningKitchenAdjacency — generator / pipeline', () => {
  // East-access rectangular villa (generic programme, 2 floors).
  const input = {
    site: { shape: 'rectangle', width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2, setbackEast: 2, setbackWest: 2 },
    building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 },
    seed: 42, deterministic: true, jurisdiction: 'IR',
  } as never;
  const strat = ['functional-circulation'] as const;
  const ground = (opts: object) => generateLayouts(input, [...strat], opts)[0];
  const rectOf = (c: ReturnType<typeof ground>, t: string) => c.floors[0].spaces.find(s => s.type === t)!.rect;

  it('opt-in: dining↔kitchen and foyer↔guest-wc share walls; no HARD findings added', () => {
    const off = ground({});
    const on = ground({ preferDiningKitchenAdjacency: true });
    expect(contact(rectOf(off, 'dining'), rectOf(off, 'kitchen'))).toBe(0);
    expect(contact(rectOf(on, 'dining'), rectOf(on, 'kitchen'))).toBeGreaterThan(1.0);
    expect(contact(rectOf(on, 'foyer'), rectOf(on, 'guest-wc'))).toBeGreaterThan(1.0);
    const hard = (c: typeof on) => c.findings.filter(f => f.severity === 'hard').map(f => f.code).sort();
    expect(hard(on).length).toBeLessThanOrEqual(hard(off).length);
    for (const code of hard(on)) expect(hard(off)).toContain(code);
    expect(on.valid).toBe(off.valid || on.valid);
  });

  it('opt-in generation is deterministic', () => {
    const a = ground({ preferDiningKitchenAdjacency: true });
    const b = ground({ preferDiningKitchenAdjacency: true });
    expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it('pipeline default (omitted / false) is byte-identical DXF', () => {
    const omit = generate(createProject(input)).candidates[0];
    const off = generate(createProject(input), { preferDiningKitchenAdjacency: false }).candidates[0];
    expect(writeDXF(off)).toBe(writeDXF(omit));
  });
});
