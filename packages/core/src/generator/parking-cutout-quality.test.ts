/**
 * Parking-cutout fallback — ground-floor room-layout quality of the selected candidate.
 * The stair hall, corridor and parking stay as the fallback derived them; only the
 * programme rooms around them are arranged: dining at the verified MBH4-ROOM-001 minimum
 * width, dining↔kitchen door contact, no new proportion defects, lower circulation /
 * residual, kitchen↔storage adjacency, guest WC apart from the kitchen.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate } from '../pipeline.js';
import { PARKING_CUTOUT_APPLIED } from './generator.js';
import { room001Thresholds } from '../layout/placer.js';
import { DOOR_INT_WIDTH } from '../units.js';
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Space } from '../model/space.js';

const BUILDING = { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: true };
const lot = (w: number, l: number, site: Record<string, unknown> = {}): ProjectInput => ({
  name: `${w}x${l}`, jurisdiction: 'IR', seed: 424242, deterministic: true,
  site: { shape: 'rectangle', width: w, length: l, streetWidth: 8, accessSide: 'south', setbackNorth: 1.5, setbackSouth: 3, setbackEast: 1.5, setbackWest: 1.5, ...site },
  building: { ...BUILDING },
} as unknown as ProjectInput);
const run = (inp: ProjectInput) => generate(createProject(JSON.parse(JSON.stringify(inp))), { allStrategies: true });

/** Length of the wall two axis-aligned rooms share (0 when they only touch at a corner or not at all). */
const contact = (a: Space, b: Space) => {
  const A = a.rect, B = b.rect, e = 1e-6;
  const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
  const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
  if (Math.abs(ox) < e && oy > e) return oy;
  if (Math.abs(oy) < e && ox > e) return ox;
  return 0;
};
const room = (c: LayoutCandidate, t: string) => c.floors[0].spaces.find(s => s.type === t)!;
const qa = (c: LayoutCandidate, code: string, needle = '') => c.findings.filter(f => f.code === code && (f.message ?? '').includes(needle));
const groundArea = (c: LayoutCandidate) => c.floors[0].spaces.reduce((a, s) => a + s.area, 0);
const circRatio = (c: LayoutCandidate) => {
  const sp = c.floors[0].spaces;
  const circ = sp.filter(s => ['corridor', 'foyer', 'entrance', 'stair-hall'].includes(s.type)).reduce((a, s) => a + s.area, 0);
  return circ / groundArea(c);
};

const SITES: Array<[string, ProjectInput]> = [
  ['12×18', lot(12, 18)],
  ['13×19', lot(13, 19)],
  ['12.4×18.6 asymmetric', lot(12.4, 18.6, { setbackWest: 1.2, setbackEast: 1.9, setbackSouth: 3.2, setbackNorth: 1.3 })],
  ['12×18 north access', lot(12, 18, { accessSide: 'north', setbackNorth: 3, setbackSouth: 1.5 })],
];

describe.each(SITES)('parking-cutout ground-floor quality — %s', (_name, inp) => {
  const r = run(inp);
  const c = r.bestCandidate!;

  it('stays VALID in all four strategies, via the fallback, with parking 2/2 and a stacked stair', () => {
    expect(c).not.toBeNull();
    expect(r.candidates).toHaveLength(4);
    for (const x of r.candidates) {
      expect(x.valid).toBe(true);
      expect(x.findings.filter(f => f.severity === 'hard')).toEqual([]);
      expect(x.explanations.some(e => e.startsWith(PARKING_CUTOUT_APPLIED))).toBe(true);
      expect(x.floors[0].parkingStalls).toHaveLength(2);
      expect(x.floors[1].stairs[0].footprint).toEqual(x.floors[0].stairs[0].footprint);
    }
  });

  it('1. dining meets the verified MBH4-ROOM-001 minimum width (pack value, unit-size dependent)', () => {
    const th = room001Thresholds(groundArea(c) >= 75)!;
    const d = room(c, 'dining');
    expect(Math.min(d.rect.w, d.rect.h)).toBeGreaterThanOrEqual(th.width - 1e-6);
    expect(qa(c, 'MBH4-ROOM-001', 'Dining')).toEqual([]);
  });

  it('2. dining↔kitchen share a wall wide enough for a door; no dining/kitchen constraint finding', () => {
    expect(contact(room(c, 'dining'), room(c, 'kitchen'))).toBeGreaterThanOrEqual(DOOR_INT_WIDTH);
    expect(qa(c, 'CONSTRAINT_DIRECT_ACCESS', 'Kitchen')).toEqual([]);
    expect(qa(c, 'CONSTRAINT_PREFER_ADJACENT', 'Dining prefer adjacent to Kitchen')).toEqual([]);
  });

  it('6./7. kitchen↔storage adjacent; guest WC not adjacent to the kitchen', () => {
    expect(contact(room(c, 'kitchen'), room(c, 'storage'))).toBeGreaterThan(0);
    expect(qa(c, 'CONSTRAINT_PREFER_ADJACENT', 'Kitchen prefer adjacent to Storage')).toEqual([]);
    expect(contact(room(c, 'guest-wc'), room(c, 'kitchen'))).toBe(0);
    expect(qa(c, 'CONSTRAINT_PREFER_SEPARATED', 'Guest WC')).toEqual([]);
  });

  it('no ground-floor room beyond the existing proportion ratio; nothing overlaps', () => {
    const ground = new Set(c.floors[0].spaces.map(s => s.label));
    expect(qa(c, 'ROOM_BAD_PROPORTION').filter(f => [...ground].some(l => f.message.includes(`"${l}"`)) && !/Bathroom|Bedroom/.test(f.message))).toEqual([]);
    const sp = c.floors[0].spaces;
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
      const A = sp[i].rect, B = sp[j].rect;
      const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      expect(ox > 1e-3 && oy > 1e-3, `${sp[i].id} × ${sp[j].id}`).toBe(false);
    }
  });

  it('deterministic: repeated generation is identical', () => {
    const again = run(inp).bestCandidate!;
    expect(JSON.stringify(again.floors)).toBe(JSON.stringify(c.floors));
  });
});

describe('12×18 — circulation and residual reduced against the previous fallback plan', () => {
  const c = run(lot(12, 18)).bestCandidate!;
  it('3. ground circulation ratio below the previous 47.0 %', () => {
    expect(circRatio(c)).toBeLessThan(0.465);
  });
  it('4. ground residual below the previous 51.90 m²', () => {
    const fp = c.floors[0].footprint;
    expect(fp.w * fp.h - groundArea(c)).toBeLessThan(51.9 - 0.1);
  });
  it('stair hall and corridor geometry are unchanged (2.57×3.70 hall, full-width 1.50 m corridor)', () => {
    const hall = room(c, 'stair-hall'), corr = room(c, 'corridor');
    expect(hall.rect.w).toBeCloseTo(2.57, 6); expect(hall.rect.h).toBeCloseTo(3.7, 6);
    expect(corr.rect.w).toBeCloseTo(9, 6); expect(corr.rect.h).toBeCloseTo(1.5, 6);
    expect(hall.rect.x).toBeCloseTo(1.5, 6); expect(hall.rect.y).toBeCloseTo(8.5, 6);
  });
});
