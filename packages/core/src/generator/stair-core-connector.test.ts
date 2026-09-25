/**
 * Phase 5.4B — opt-in `connectStairCore` (upper-floor stair-core corridor connector).
 *
 * An upper-floor stair hall with no corridor contact is joined to the corridor
 * network through the smallest clean empty gap (both sides ≥ 1.1 m, inside the
 * buildable geometry, overlapping nothing), preferring the stair entry side. The
 * anchor never moves; no clean gap → geometry unchanged. The generator adopts the
 * variant only through the validator-guarded comparison. OFF is byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  generateLayouts, findStairCoreConnector, adoptStairCoreConnectorVariant, STAIR_CONNECTOR_MIN_W,
} from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { rectInsidePolygon } from '../geometry/index.js';
import type { Rect } from '../geometry/rect.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

const sp = (type: string, x: number, y: number, w: number, h: number) => ({ type, rect: { x, y, w, h } });
const always = () => true;

describe('Phase 5.4B findStairCoreConnector (pure geometry)', () => {
  const hall: Rect = { x: 5, y: 0, w: 2.5, h: 4.2 };

  it('isolated hall beside a corridor: smallest clean gap connector, ≥ 1.1 m both ways', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 2, 0, 1.5, 12), sp('bedroom', 3.5, 4.2, 4, 4)];
    const c = findStairCoreConnector(hall, spaces, always, null)!;
    expect(c).not.toBeNull();
    expect(c.side).toBe('west');
    expect(c.rect).toEqual({ x: 3.5, y: 0, w: 1.5, h: 1.5 });
    expect(Math.min(c.rect.w, c.rect.h)).toBeGreaterThanOrEqual(STAIR_CONNECTOR_MIN_W);
  });

  it('prefers the stair entry side over a smaller gap elsewhere', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 3.5 - 1.5, 0, 1.5, 12), sp('corridor', 5, 4.2 + 2.0, 2.5, 1.5)];
    expect(findStairCoreConnector(hall, spaces, always, null)!.side).toBe('west'); // 1.5×1.5 < 2.0×1.5
    const c = findStairCoreConnector(hall, spaces, always, 'north')!;
    expect(c.side).toBe('north');
    expect(c.rect).toEqual({ x: 5, y: 4.2, w: 1.5, h: 2.0 });
  });

  it('narrow gap (< 1.1 m along travel) is rejected, never filled with a sliver', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 3.4 - 1.5 + 1.0, 0, 1.5, 12)]; // gap 0.6 m
    expect(findStairCoreConnector(hall, spaces, always, null)).toBeNull();
  });

  it('cross overlap < 1.1 m is rejected', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 2, 3.4, 1.5, 6)]; // overlap 0.8 m
    expect(findStairCoreConnector(hall, spaces, always, null)).toBeNull();
  });

  it('boxed-in anchor (gap occupied by rooms) → null', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 2, 0, 1.5, 12), sp('bathroom', 3.5, 0, 1.5, 4.2)];
    expect(findStairCoreConnector(hall, spaces, always, null)).toBeNull();
  });

  it('hall already on a corridor (no gap) → null', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 3.5, 0, 1.5, 12)];
    expect(findStairCoreConnector(hall, spaces, always, null)).toBeNull();
  });

  it('outside the buildable geometry → null; deterministic', () => {
    const spaces = [sp('stair-hall', 5, 0, 2.5, 4.2), sp('corridor', 2, 0, 1.5, 12)];
    expect(findStairCoreConnector(hall, spaces, () => false, null)).toBeNull();
    expect(findStairCoreConnector(hall, spaces, always, 'west')).toEqual(findStairCoreConnector(hall, spaces, always, 'west'));
  });
});

const B = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
// Generic fixtures (arbitrary / decimal dimensions, not benchmark geometry).
const L_INPUT = {
  site: { shape: 'l-shape', width: 20.5, length: 26.3, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
    lShape: { width: 20.5, length: 26.3, notchWidth: 4.2, notchLength: 6.1, notchCorner: 'north-east' } },
  building: B, seed: 3, deterministic: true, jurisdiction: 'IR',
};
const RECT_INPUT = {
  site: { shape: 'rectangle', width: 16.6, length: 20.61, streetWidth: 6.19, accessSide: 'east', setbackNorth: 3.32, setbackSouth: 1.54, setbackEast: 0.2, setbackWest: 2.19 },
  building: { ...B, bedrooms: 1, floors: 3, hasStorage: true }, seed: 98, deterministic: true, jurisdiction: 'IR',
};
const ELEV_INPUT = {
  site: { shape: 'rectangle', width: 13.7, length: 20.76, streetWidth: 8.98, accessSide: 'east', setbackNorth: 1.32, setbackSouth: 2.8, setbackEast: 0.96, setbackWest: 0.96 },
  building: { ...B, bedrooms: 1, bathrooms: 2, hasElevator: true }, seed: 52, deterministic: true, jurisdiction: 'IR',
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const cand = (inp: object, strategy: string, opts: object) => generateLayouts(clone(inp) as never, [strategy as never], opts)[0];
const WATCH = /^CIRC|DIRECT_ACCESS|INACCESSIBLE|DAYLIGHT|DYL/;
const guardedCounts = (c: LayoutCandidate) => {
  const m = new Map<string, number>();
  for (const f of c.findings) if (f.severity === 'hard' || WATCH.test(f.code)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
  return m;
};
const noAdded = (base: LayoutCandidate, v: LayoutCandidate) => {
  const b = guardedCounts(base);
  for (const [k, n] of guardedCounts(v)) expect(n, k).toBeLessThanOrEqual(b.get(k) ?? 0);
};
const nCode = (c: LayoutCandidate, code: string | RegExp) => c.findings.filter(f => typeof code === 'string' ? f.code === code : code.test(f.code)).length;
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-3 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-3;

function expectConnected(inp: object, strategy: string) {
  const off = cand(inp, strategy, {});
  const on = cand(inp, strategy, { connectStairCore: true });
  expect(on.explanations.some(e => e.startsWith('Phase 5.4B: stair-core connector variant adopted'))).toBe(true);
  expect(nCode(on, 'CONSTRAINT_MUST_ADJACENT')).toBeLessThan(nCode(off, 'CONSTRAINT_MUST_ADJACENT'));
  expect(nCode(on, 'CIRC_INACCESSIBLE_SPACE')).toBeLessThan(nCode(off, 'CIRC_INACCESSIBLE_SPACE'));
  noAdded(off, on);
  expect(on.valid || !off.valid).toBe(true);
  expect(nCode(on, /^(STAIR_|ELEV_)/)).toBeLessThanOrEqual(nCode(off, /^(STAIR_|ELEV_)/));
  const boundary = (on as never as { buildableBoundary: { x: number; y: number }[] }).buildableBoundary;
  let connectors = 0;
  on.floors.forEach((fl, i) => {
    const conn = fl.spaces.filter(s => s.label === 'Stair connector');
    connectors += conn.length;
    for (const c of conn) {
      expect(fl.level).toBeGreaterThan(0);
      expect(Math.min(c.rect.w, c.rect.h)).toBeGreaterThanOrEqual(STAIR_CONNECTOR_MIN_W - 1e-9);
      expect(rectInsidePolygon(c.rect, boundary, 1e-3)).toBe(true);
      for (const o of fl.spaces) if (o !== c) expect(overlap(c.rect, o.rect), o.id).toBe(false);
      const hall = fl.spaces.find(s => s.type === 'stair-hall')!;
      expect(JSON.stringify(hall.rect)).toBe(JSON.stringify(off.floors[i].spaces.find(s => s.type === 'stair-hall')!.rect)); // anchor never moves
    }
  });
  expect(connectors).toBeGreaterThan(0);
  return { off, on };
}

describe('Phase 5.4B connectStairCore — generator / pipeline', () => {
  it('L-shape isolated upper-floor stair hall is connected (guarded, inside, no overlap, anchor fixed)', () => {
    expectConnected(L_INPUT, 'alternative-zoning');
  });

  it('rectangular isolated upper-floor stair hall is connected', () => {
    expectConnected(RECT_INPUT, 'daylight-orientation');
  });

  it('elevator building: no added STAIR_/ELEV_ findings, never overlaps the shaft', () => {
    const { on } = expectConnected(ELEV_INPUT, 'daylight-orientation');
    for (const fl of on.floors) {
      const shaft = fl.spaces.find(s => s.type === 'elevator-hall');
      for (const c of fl.spaces.filter(s => s.label === 'Stair connector')) if (shaft) expect(overlap(c.rect, shaft.rect)).toBe(false);
    }
  });

  it('no isolated hall / no clean connector: identical to legacy', () => {
    for (const [inp, st] of [[L_INPUT, 'area-efficiency'], [RECT_INPUT, 'area-efficiency'], [L_INPUT, 'daylight-orientation']] as const) {
      const off = cand(inp, st, {});
      const on = cand(inp, st, { connectStairCore: true });
      expect(JSON.stringify(on.floors)).toBe(JSON.stringify(off.floors));
      expect(on.findings.map(f => f.code)).toEqual(off.findings.map(f => f.code));
    }
  });

  it('adoptStairCoreConnectorVariant: needs strictly fewer MUST_ADJACENT AND INACCESSIBLE, nothing added', () => {
    const f = (code: string, severity: Finding['severity'] = 'hard') => ({ code, severity, message: '' }) as Finding;
    const mk = (valid: boolean, findings: Finding[], tag: string) =>
      ({ valid, findings, floors: [{ tag }], explanations: [] }) as unknown as LayoutCandidate;
    const iso = [f('CONSTRAINT_MUST_ADJACENT'), f('CIRC_INACCESSIBLE_SPACE'), f('CIRC_INACCESSIBLE_SPACE')];
    const base = mk(false, iso, 'a');
    expect(adoptStairCoreConnectorVariant(base, mk(true, [], 'b')).floors).toEqual([{ tag: 'b' }]);
    // MUST fixed but INACCESSIBLE not reduced → rejected
    expect(adoptStairCoreConnectorVariant(base, mk(false, iso.slice(1), 'b'))).toBe(base);
    // INACCESSIBLE reduced but MUST not → rejected
    expect(adoptStairCoreConnectorVariant(base, mk(false, iso.slice(0, 2), 'b'))).toBe(base);
    // added HARD / watched finding → rejected
    expect(adoptStairCoreConnectorVariant(base, mk(false, [f('CIRC_ROOM_THROUGH_ROOM')], 'b'))).toBe(base);
    expect(adoptStairCoreConnectorVariant(base, mk(false, [f('CIRC_CORRIDOR_TOO_NARROW')], 'b'))).toBe(base);
    expect(adoptStairCoreConnectorVariant(base, mk(false, [f('ROOM_DAYLIGHT_QUALITY', 'soft')], 'b'))).toBe(base);
    // lost validity → rejected; identical floors → base
    const validBase = mk(true, [f('CONSTRAINT_MUST_ADJACENT', 'soft')], 'a');
    expect(adoptStairCoreConnectorVariant(validBase, mk(false, [], 'b'))).toBe(validBase);
    expect(adoptStairCoreConnectorVariant(base, mk(true, [], 'a'))).toBe(base);
  });

  it('opt-in generation is deterministic', () => {
    const a = cand(L_INPUT, 'alternative-zoning', { connectStairCore: true });
    const b = cand(L_INPUT, 'alternative-zoning', { connectStairCore: true });
    expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it('interactions: each existing option + connectStairCore never adds findings over that option alone', () => {
    const others = [
      { preferDiningKitchenAdjacency: true },
      { preferLShapeProgrammeAdjacency: true },
      { galleryDaylightAware: true },
      { programmeDoorCompletion: true },
      { preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true, galleryDaylightAware: true, programmeDoorCompletion: true },
    ];
    for (const [inp, st] of [[L_INPUT, 'alternative-zoning'], [RECT_INPUT, 'daylight-orientation']] as const) {
      for (const o of others) {
        const alone = cand(inp, st, o);
        const both = cand(inp, st, { ...o, connectStairCore: true });
        noAdded(alone, both);
        expect(both.valid || !alone.valid).toBe(true);
        expect(nCode(both, 'CONSTRAINT_MUST_ADJACENT')).toBeLessThanOrEqual(nCode(alone, 'CONSTRAINT_MUST_ADJACENT'));
        expect(JSON.stringify(cand(inp, st, { ...o, connectStairCore: true }).floors)).toBe(JSON.stringify(both.floors));
      }
    }
  });

  it('pipeline default (omitted / false) is byte-identical DXF', () => {
    for (const inp of [L_INPUT, RECT_INPUT]) {
      const omit = generate(createProject(clone(inp) as never)).candidates;
      const off = generate(createProject(clone(inp) as never), { connectStairCore: false }).candidates;
      expect(off.length).toBe(omit.length);
      off.forEach((c, i) => expect(writeDXF(c)).toBe(writeDXF(omit[i])));
    }
  });
});
