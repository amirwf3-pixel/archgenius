/**
 * Phase 5.4A — opt-in `galleryDaylightAware` (rectangular M3 entry gallery).
 *
 * When the full-width front entry gallery would leave dining (side by side with
 * living below it) without an exterior edge, the gallery is confined to the living
 * column so dining runs full depth to the street façade — only when every gallery
 * cell keeps its programme minimums. The generator adopts the variant only through
 * the validator-guarded comparison. Infeasible cases and OFF must be identical.
 */
import { describe, it, expect } from 'vitest';
import { placeSpaces, type PlacedSpec } from './placer.js';
import { generateLayouts, adoptGalleryDaylightVariant } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Space, SpaceType, Zone, AdjacencyRequirement } from '../model/space.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

type Out = { spaces: Space[]; corridors: Space[]; explanation: string[] };

const mkSpace = (type: SpaceType, r: Rect, label: string, id: string, zone: Zone): Space => ({
  id, type, label, zone, privacy: zone === 'circulation' ? 'service' : zone,
  polygon: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  rect: { ...r }, area: r.w * r.h, targetArea: r.w * r.h, minArea: 0,
  wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
}) as unknown as Space;

const DK: AdjacencyRequirement = { spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true };

function spec(type: SpaceType, minArea: number, targetArea: number, minWidth: number, privacy: 'public' | 'semi-private' | 'service' | 'private', adjacencies?: AdjacencyRequirement[]): PlacedSpec {
  return { type, minArea, targetArea, minWidth, privacy, priority: 5, adjacencies, placedId: `${type}-x`, placedLabel: type } as PlacedSpec;
}

/** Ground floor with programme minimums from TYPICAL_AREAS (generic, not benchmark data). */
const GALLERY_MINS = [['entrance', 2.0, 1.2], ['foyer', 3.0, 1.4], ['guest-wc', 1.4, 1.1]] as const;
function groundSpecs(): PlacedSpec[] {
  return [
    spec('entrance', 2.0, 3.0, 1.2, 'public'),
    spec('foyer', 3.0, 4.0, 1.4, 'public'),
    spec('guest-wc', 1.4, 2.2, 1.1, 'public'),
    spec('living', 12.0, 18.0, 3.0, 'public'),
    spec('dining', 7.0, 10.0, 2.4, 'semi-private', [DK]),
    spec('kitchen', 6.0, 10.0, 2.0, 'service', [{ ...DK, spaceType: 'dining' }]),
    spec('stair-hall', 4.5, 6.0, 1.2, 'service'),
    spec('bedroom', 9.0, 12.0, 2.5, 'private'),
    spec('bathroom', 2.4, 3.6, 1.3, 'private'),
  ];
}

type Strat = 'area-efficiency' | 'daylight-orientation';
function run(fp: Rect, strategy: Strat, opts?: { galleryDaylightAware: boolean }): Out {
  const cloned = groundSpecs();
  return opts ? placeSpaces(fp, cloned, strategy, 'south', mkSpace, opts) : placeSpaces(fp, cloned, strategy, 'south', mkSpace);
}

const byType = (o: Out, t: string) => o.spaces.find(s => s.type === t)!;
const onEdge = (r: Rect, fp: Rect) => {
  const e = 1e-6;
  return Math.abs(r.x - fp.x) < e || Math.abs(r.y - fp.y) < e ||
    Math.abs(r.x + r.w - (fp.x + fp.w)) < e || Math.abs(r.y + r.h - (fp.y + fp.h)) < e;
};
function contact(a: Rect, b: Rect): number {
  const e = 1e-6;
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if ((Math.abs(a.x + a.w - b.x) < e || Math.abs(b.x + b.w - a.x) < e) && oy > e) return oy;
  if ((Math.abs(a.y + a.h - b.y) < e || Math.abs(b.y + b.h - a.y) < e) && ox > e) return ox;
  return 0;
}
/** Overlapping pairs (type/type) — the option must never add one over the legacy output. */
const overlapPairs = (sp: Space[]) => sp.flatMap((a, i) => sp.slice(i + 1).filter(b =>
  Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x) > 1e-6 &&
  Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y) > 1e-6).map(b => `${a.type}/${b.type}`)).sort();

// Generic footprints (arbitrary / decimal, not benchmark geometry).
const FEASIBLE: Rect[] = [{ x: 0, y: 0, w: 14, h: 15 }, { x: 0, y: 0, w: 13.37, h: 17.21 }, { x: 0, y: 0, w: 16, h: 19 }];
// Daylight-orientation band too narrow: living column (band − dining min) < Σ gallery minWidths.
const INFEASIBLE: Rect = { x: 0, y: 0, w: 13.37, h: 17.21 };
// Dining already reaches an exterior edge without the option.
const ALREADY_EXTERIOR: Rect = { x: 0, y: 0, w: 12, h: 16 };

describe('Phase 5.4A galleryDaylightAware — placer', () => {
  it('feasible: gallery over the living column only, dining gains the street façade', () => {
    for (const fp of FEASIBLE) {
      const off = run(fp, 'area-efficiency');
      const on = run(fp, 'area-efficiency', { galleryDaylightAware: true });
      expect(off.explanation.some(e => e.startsWith('Phase15 M3 entry gallery'))).toBe(true);
      expect(onEdge(byType(off, 'dining').rect, fp)).toBe(false);
      expect(on.explanation.some(e => e.startsWith('Phase 5.4A daylight-aware entry gallery'))).toBe(true);
      const dining = byType(on, 'dining').rect, living = byType(on, 'living').rect;
      expect(dining.y).toBeCloseTo(fp.y, 9); // street façade (frame-south)
      // Gallery cells sit on the façade inside the living column; foyer still opens onto living.
      for (const [t] of GALLERY_MINS) {
        const r = byType(on, t).rect;
        expect(r.y).toBeCloseTo(fp.y, 9);
        expect(r.x).toBeGreaterThanOrEqual(living.x - 1e-6);
        expect(r.x + r.w).toBeLessThanOrEqual(living.x + living.w + 1e-6);
      }
      expect(contact(byType(on, 'entrance').rect, byType(on, 'foyer').rect)).toBeGreaterThan(1.0);
      expect(contact(byType(on, 'foyer').rect, living)).toBeGreaterThan(1.0);
      expect(contact(living, dining)).toBeGreaterThan(2.0);
      expect(on.spaces.map(s => s.type).sort()).toEqual(off.spaces.map(s => s.type).sort());
      const added = overlapPairs([...on.spaces, ...on.corridors]).filter(p => !overlapPairs([...off.spaces, ...off.corridors]).includes(p));
      expect(added).toEqual([]);
      const pub = on.spaces.filter(s => ['entrance', 'foyer', 'guest-wc', 'living', 'dining'].includes(s.type));
      expect(overlapPairs(pub)).toEqual([]);
    }
  });

  it('gallery cells, living and dining keep their programme minimums', () => {
    for (const fp of FEASIBLE) {
      const on = run(fp, 'area-efficiency', { galleryDaylightAware: true });
      for (const [t, minA, minW] of GALLERY_MINS) {
        const r = byType(on, t).rect;
        expect(r.w * r.h).toBeGreaterThanOrEqual(minA - 1e-9);
        expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(minW - 1e-9);
      }
      const l = byType(on, 'living').rect, d = byType(on, 'dining').rect;
      expect(l.w * l.h).toBeGreaterThanOrEqual(12 - 1e-9);
      expect(Math.min(l.w, l.h)).toBeGreaterThanOrEqual(3.0 - 1e-9);
      expect(d.w * d.h).toBeGreaterThanOrEqual(7 - 1e-9);
      expect(Math.min(d.w, d.h)).toBeGreaterThanOrEqual(2.4 - 1e-9);
    }
  });

  it('infeasible gallery geometry: identical to legacy', () => {
    const off = run(INFEASIBLE, 'daylight-orientation');
    const on = run(INFEASIBLE, 'daylight-orientation', { galleryDaylightAware: true });
    expect(off.explanation.some(e => e.startsWith('Phase15 M3 entry gallery'))).toBe(true);
    expect(onEdge(byType(off, 'dining').rect, INFEASIBLE)).toBe(false);
    expect(on).toEqual(off);
  });

  it('dining already on an exterior edge: identical to legacy', () => {
    const off = run(ALREADY_EXTERIOR, 'daylight-orientation');
    expect(onEdge(byType(off, 'dining').rect, ALREADY_EXTERIOR)).toBe(true);
    expect(run(ALREADY_EXTERIOR, 'daylight-orientation', { galleryDaylightAware: true })).toEqual(off);
  });

  it('option false / omitted is the legacy call; deterministic', () => {
    const fp = FEASIBLE[0];
    expect(run(fp, 'area-efficiency', { galleryDaylightAware: false })).toEqual(run(fp, 'area-efficiency'));
    expect(run(fp, 'area-efficiency', { galleryDaylightAware: true })).toEqual(run(fp, 'area-efficiency', { galleryDaylightAware: true }));
  });
});

describe('Phase 5.4A galleryDaylightAware — generator / pipeline', () => {
  const B = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
  const rect = (w: number, l: number) => ({
    site: { shape: 'rectangle', width: w, length: l, streetWidth: 9, accessSide: 'south', setbackNorth: 2.5, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 },
    building: B, seed: 11, deterministic: true, jurisdiction: 'IR',
  }) as never;
  const input = rect(17.3, 24.6);
  const cand = (strategy: string, opts: object, inp = input) => generateLayouts(inp, [strategy as never], opts)[0];
  const hardCodes = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard').map(f => f.code).sort();
  const WATCH = /^CIRC|DIRECT_ACCESS|INACCESSIBLE|DAYLIGHT|DYL/;
  const count = (c: LayoutCandidate, pick: (f: Finding) => boolean) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (pick(f)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };

  it('opt-in removes MBH4-DYL-001 with no added HARD / circulation / access / daylight finding', () => {
    const off = cand('area-efficiency', {});
    const on = cand('area-efficiency', { galleryDaylightAware: true });
    expect(hardCodes(off)).toContain('MBH4-DYL-001');
    expect(hardCodes(on)).not.toContain('MBH4-DYL-001');
    expect(on.explanations.some(e => e.startsWith('Phase 5.4A: daylight-aware entry-gallery variant adopted'))).toBe(true);
    const guarded = (f: Finding) => f.severity === 'hard' || WATCH.test(f.code);
    const co = count(off, guarded);
    for (const [k, n] of count(on, guarded)) expect(n).toBeLessThanOrEqual(co.get(k) ?? 0);
    expect(on.valid || !off.valid).toBe(true);
    const dining = on.floors[0].spaces.find(s => s.type === 'dining')!;
    expect(dining.hasExteriorWall).toBe(true);
  });

  it('guard: a variant adding a watched finding (deep dining) is rejected — legacy kept', () => {
    const off = cand('daylight-orientation', {});
    const on = cand('daylight-orientation', { galleryDaylightAware: true });
    expect(JSON.stringify(on.floors)).toBe(JSON.stringify(off.floors));
    expect(on.findings.map(f => f.code)).toEqual(off.findings.map(f => f.code));
  });

  it('adoptGalleryDaylightVariant: needs strictly fewer DYL-001 and no added guarded finding', () => {
    const f = (code: string, severity: Finding['severity'] = 'hard') => ({ code, severity, message: '' }) as Finding;
    const mk = (valid: boolean, findings: Finding[], tag: string) =>
      ({ valid, findings, floors: [{ tag }], explanations: [] }) as unknown as LayoutCandidate;
    const base = mk(false, [f('MBH4-DYL-001')], 'a');
    expect(adoptGalleryDaylightVariant(base, mk(true, [], 'b')).floors).toEqual([{ tag: 'b' }]);
    expect(adoptGalleryDaylightVariant(base, mk(false, [f('MBH4-DYL-001')], 'b'))).toBe(base);
    expect(adoptGalleryDaylightVariant(base, mk(false, [f('CIRC_INACCESSIBLE_SPACE')], 'b'))).toBe(base);
    expect(adoptGalleryDaylightVariant(base, mk(true, [f('ROOM_DAYLIGHT_QUALITY', 'soft')], 'b'))).toBe(base);
    expect(adoptGalleryDaylightVariant(base, mk(false, [f('ROOM-X')], 'b'))).toBe(base);
    const validBase = mk(true, [], 'a');
    expect(adoptGalleryDaylightVariant(validBase, mk(true, [], 'b'))).toBe(validBase);
    expect(adoptGalleryDaylightVariant(base, mk(true, [], 'a'))).toBe(base);
  });

  it('opt-in generation is deterministic', () => {
    const a = cand('area-efficiency', { galleryDaylightAware: true });
    const b = cand('area-efficiency', { galleryDaylightAware: true });
    expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it('interaction with preferDiningKitchenAdjacency: combined never adds findings over 5.3A alone', () => {
    for (const strategy of ['area-efficiency', 'functional-circulation', 'daylight-orientation']) {
      const a = cand(strategy, { preferDiningKitchenAdjacency: true });
      const both = cand(strategy, { preferDiningKitchenAdjacency: true, galleryDaylightAware: true });
      const guarded = (x: Finding) => x.severity === 'hard' || WATCH.test(x.code);
      const ca = count(a, guarded);
      for (const [k, n] of count(both, guarded)) expect(n).toBeLessThanOrEqual(ca.get(k) ?? 0);
      expect(both.valid || !a.valid).toBe(true);
      const again = cand(strategy, { preferDiningKitchenAdjacency: true, galleryDaylightAware: true });
      expect(JSON.stringify(again.floors)).toBe(JSON.stringify(both.floors));
    }
  });

  it('interaction with preferLShapeProgrammeAdjacency: L-shape sites are unaffected', () => {
    const l = {
      site: { shape: 'l-shape', width: 21, length: 25.5, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
        lShape: { width: 21, length: 25.5, notchWidth: 5, notchLength: 6.5, notchCorner: 'north-east' } },
      building: B, seed: 5, deterministic: true, jurisdiction: 'IR',
    };
    for (const strategy of ['area-efficiency', 'daylight-orientation']) {
      const b = generateLayouts(JSON.parse(JSON.stringify(l)), [strategy as never], { preferLShapeProgrammeAdjacency: true });
      const both = generateLayouts(JSON.parse(JSON.stringify(l)), [strategy as never], { preferLShapeProgrammeAdjacency: true, galleryDaylightAware: true });
      expect(JSON.stringify(both.map(c => c.floors))).toBe(JSON.stringify(b.map(c => c.floors)));
      expect(both.map(c => c.findings.map(f => f.code))).toEqual(b.map(c => c.findings.map(f => f.code)));
    }
  });

  it('pipeline default (omitted / false) is byte-identical DXF', () => {
    const omit = generate(createProject(input)).candidates;
    const off = generate(createProject(input), { galleryDaylightAware: false }).candidates;
    expect(off.length).toBe(omit.length);
    off.forEach((c, i) => expect(writeDXF(c)).toBe(writeDXF(omit[i])));
  });
});
