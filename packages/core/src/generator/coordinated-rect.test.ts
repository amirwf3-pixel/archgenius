/**
 * P4 — guarded coordinated rectangle planner (GenerateLayoutsOptions.coordinatedRectPlanner).
 * Single-floor rectangle sites without a stair / elevator core only; the variant is adopted
 * per strategy only through adoptCoordinatedRectVariant, otherwise the legacy candidate
 * stands unchanged. Cases are the existing layout benchmark inputs.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, adoptCoordinatedRectVariant } from './generator.js';
import { generate } from '../pipeline.js';
import { benchmarkInputs } from '../regression/layout-cases.js';
import { COORDINATED_RECT_APPLIED, COORDINATED_TARGET_RETRY, COORDINATED_VERTICAL_RETRY, coordinatedRectEligible, frameZoneLayout, framePublicFamily } from '../layout/coordinated-rect.js';
import { deriveBuildingFrame } from '../layout/building-frame.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { PlacedSpec } from '../layout/placer.js';
import type { LayoutCandidate, CandidateStrategy } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Rect } from '../geometry/rect.js';

const S: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const ADOPTED = 'P4: coordinated rectangle planner variant adopted';
const bench = (id: string): ProjectInput => structuredClone(benchmarkInputs().find(b => b.id === id)!.input);
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? undefined : v));
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const gen = (id: string, opts?: Parameters<typeof generateLayouts>[2]) =>
  opts === undefined ? generateLayouts(bench(id), S) : generateLayouts(bench(id), S, opts);
const on = (id: string) => gen(id, { coordinatedRectPlanner: true });
const isAdopted = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(ADOPTED));
const inside = (r: Rect, o: Rect, e = 1e-6) =>
  r.x >= o.x - e && r.y >= o.y - e && r.x + r.w <= o.x + o.w + e && r.y + r.h <= o.y + o.h + e;
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-6 && h > 1e-6 ? w * h : 0;
};
const specsOf = (input: ProjectInput): PlacedSpec[] => {
  const [al] = allocateBuildingProgram(input.building, 1);
  return programForFloor(input.building, 0, true, al).map((s, k) => ({ ...s, placedId: `${s.type}-${k}`, placedLabel: s.type }) as PlacedSpec);
};

describe('P4 coordinated rectangle planner — option off', () => {
  it('omitted / {} / false are byte-identical to legacy (generateLayouts and generate)', () => {
    for (const id of ['rect/b1/42', 'rectE/b1/7', 'rect14/b1/42', 'rect/b2/42']) {
      if (!benchmarkInputs().some(b => b.id === id)) continue;
      const ref = strip(gen(id));
      expect(strip(gen(id, {}))).toBe(ref);
      expect(strip(gen(id, { coordinatedRectPlanner: false }))).toBe(ref);
      expect(strip(gen(id, { coordinatedRectPlanner: undefined }))).toBe(ref);
    }
    const project = () => ({ id: 'p', name: 'p', input: bench('rect/b1/42') }) as any;
    const g0 = generate(project(), { allStrategies: true });
    const g1 = generate(project(), { allStrategies: true, coordinatedRectPlanner: false });
    expect(strip(g1.candidates)).toBe(strip(g0.candidates));
  });

  it('a legacy run carries no P4 explanation', () => {
    for (const c of gen('rect/b1/42')) expect(c.explanations.some(e => e.startsWith('P4'))).toBe(false);
  });
});

describe('P4 coordinated rectangle planner — coordinated path', () => {
  it('a simple single-floor rectangle is laid out through the frame and adopted', () => {
    const cs = on('rect/b1/42');
    const c = byStrategy(cs, 'functional-circulation');
    expect(isAdopted(c)).toBe(true);
    expect(c.valid).toBe(true);
    expect(c.explanations.some(e => e.startsWith(COORDINATED_RECT_APPLIED))).toBe(true);
    // living / dining no further from their programme targets than legacy
    const dev = (x: LayoutCandidate) => x.floors[0].spaces
      .filter(s => s.type === 'living' || s.type === 'dining')
      .reduce((a, s) => a + Math.abs(s.area - s.targetArea) / s.targetArea, 0);
    expect(dev(c)).toBeLessThan(dev(byStrategy(gen('rect/b1/42'), 'functional-circulation')));
  });

  it('an access-rotated site (east) is adopted as well', () => {
    expect(isAdopted(byStrategy(on('rectE/b1/42'), 'functional-circulation'))).toBe(true);
  });

  it('frame zone layout: bands disjoint and inside the slice; family from the frame demand', () => {
    const input = bench('rect/b1/42');
    const specs = specsOf(input);
    expect(coordinatedRectEligible(specs, true)).toBe(true);
    expect(coordinatedRectEligible(specs, false)).toBe(false);
    expect(coordinatedRectEligible([...specs, { ...specs[0], type: 'stair-hall' } as PlacedSpec], true)).toBe(false);
    const slice: Rect = { x: 0, y: 0, w: 14, h: 19 };
    for (const access of ['south', 'north', 'east', 'west'] as const) {
      const frame = deriveBuildingFrame({ slice, access, strategy: 'area-efficiency', floorSpecs: [specs] })!;
      expect(frame).not.toBeNull();
      const z = frameZoneLayout(frame);
      const rects = [...z.corridors, ...z.zones.public, ...z.zones.private, ...z.zones.service];
      for (const r of rects) { expect(inside(r, slice)).toBe(true); expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0); }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBeLessThan(1e-6);
      if (z.entrancePatch) expect(z.corridors).toContain(z.entrancePatch);
      expect(['shallow-band', 'entry-column', 'stacked']).toContain(framePublicFamily(frame));
    }
  });

  it('repeated generation is deterministic', () => {
    for (const id of ['rect/b1/42', 'rectE/b1/7', 'rect14/b1/7']) {
      const a = strip(on(id)), b = strip(on(id)), c = strip(on(id));
      expect(b).toBe(a);
      expect(c).toBe(a);
    }
  });

  it('adopted candidates keep the whole programme', () => {
    for (const id of ['rect/b1/42', 'rectE/b1/42']) {
      const legacy = gen(id);
      for (const c of on(id).filter(isAdopted)) {
        expect(c.findings.some(f => f.code === 'ARCH_PROGRAM_UNPLACED')).toBe(false);
        const req = (c as any).programRequirements[0].byType as Record<string, number>;
        const count = (x: LayoutCandidate, t: string) => x.floors[0].spaces.filter(s => s.type === t).length;
        for (const [t, n] of Object.entries(req)) expect(count(c, t), t).toBeGreaterThanOrEqual(n);
        const l = byStrategy(legacy, c.metadata.strategy);
        for (const t of new Set(l.floors[0].spaces.map(s => s.type))) {
          if (t !== 'corridor') expect(count(c, t), t).toBeGreaterThanOrEqual(count(l, t));
        }
      }
    }
  });

  it('adopted candidates: no overlapping spaces, everything inside the buildable area, no room above 60 m²', () => {
    for (const id of ['rect/b1/42', 'rect/b1/7', 'rectE/b1/42', 'rectE/b1/7']) {
      const cs = on(id).filter(isAdopted);
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        const buildable = (c as any).buildableRects as Rect[];
        expect(buildable).toHaveLength(1);
        const sp = c.floors[0].spaces.filter(s => s.rect);
        for (const s of sp) {
          expect(inside(s.rect, buildable[0], 1e-3), s.id).toBe(true);
          if (!['corridor', 'parking', 'yard'].includes(s.type)) expect(s.area).toBeLessThanOrEqual(60 + 1e-6);
        }
        for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
          expect(overlap(sp[i].rect, sp[j].rect), `${sp[i].id}|${sp[j].id}`).toBeLessThan(1e-4);
        }
      }
    }
  });
});

describe('P4 guard', () => {
  it('a rejected variant leaves the exact legacy candidate (integration)', () => {
    for (const id of ['rect14/b1/42', 'rect14/b1/7', 'rect/b1/42']) {
      const legacy = gen(id), coord = on(id);
      for (const c of coord.filter(x => !isAdopted(x))) {
        expect(strip(c)).toBe(strip(byStrategy(legacy, c.metadata.strategy)));
      }
    }
    // the rect14 first-pass plans are all rejected (or frame-less); the only adoptions are
    // the P9 target-depth retry (coordinated-target.test.ts) and the P10 vertical
    // target-length retry (coordinated-vertical.test.ts)
    expect(on('rect14/b1/42').filter(isAdopted).every(c => c.explanations.some(e =>
      e.startsWith(COORDINATED_TARGET_RETRY) || e.startsWith(COORDINATED_VERTICAL_RETRY)))).toBe(true);
  });

  it('rejects every guard violation and returns the base object unchanged', () => {
    // a real adopted variant and the legacy base it replaced
    const legacy = byStrategy(gen('rect/b1/42'), 'functional-circulation');
    const variantOf = () => {
      const v = byStrategy(on('rect/b1/42'), 'functional-circulation');
      v.explanations = v.explanations.filter(e => !e.startsWith(ADOPTED));
      return v;
    };
    const base = structuredClone(legacy);
    const snap = strip(base);
    expect(adoptCoordinatedRectVariant(base, variantOf())).not.toBe(base); // control: accepted

    const living = (v: LayoutCandidate) => v.floors[0].spaces.find(s => s.type === 'living')!;
    const mutations: [string, (v: LayoutCandidate) => void][] = [
      ['not coordinated', v => { v.explanations = v.explanations.filter(e => !e.startsWith(COORDINATED_RECT_APPLIED)); }],
      ['invalid', v => { v.valid = false; }],
      ['new HARD', v => { v.findings = [...v.findings, { code: 'GEO_OVERLAPPING_ROOMS', severity: 'hard', message: 'x' } as any]; }],
      ['more circulation advisory', v => { v.findings = [...v.findings, { code: 'CIRC_TEST', severity: 'advisory', message: 'x' } as any]; }],
      ['lost programme space', v => { v.floors[0].spaces = v.floors[0].spaces.filter(s => s.type !== 'dining'); }],
      ['room above 60 m²', v => { living(v).area = 61; }],
      ['worse living target', v => { living(v).targetArea = 1; }],
      ['below minimum area', v => { const l = living(v); l.area = (l.minArea ?? 0) - 1; }],
      ['outside buildable', v => { const l = living(v); l.rect = { ...l.rect, x: l.rect.x - 50 }; }],
      ['overlap', v => { const sp = v.floors[0].spaces.filter(s => s.type !== 'corridor'); sp[1].rect = { ...sp[0].rect }; }],
    ];
    for (const [name, mutate] of mutations) {
      const v = variantOf();
      mutate(v);
      expect(adoptCoordinatedRectVariant(base, v), name).toBe(base);
    }
    expect(strip(base)).toBe(snap);
  });
});
