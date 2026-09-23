/**
 * Phase 29-B — DXF annotation collision + AutoCAD R12 profile regression tests.
 *
 * Evidence base (Phase 29 read-only audit, HEAD 5726db3): dimension/annotation
 * TEXT was placed with zero collision awareness — 9 real text-on-text overlaps
 * on L-NE-18x22 and 12 on RECT-15x24 (opening-width dim text exactly coincident
 * with room chain-dim text on wall-centered windows; room dims drawn inside
 * neighbouring rooms/corridors over labels; small-plan legend rows slicing
 * through the title lines). The P29-B writer guard suppresses the
 * discretionary text (dimension value / legend row) and keeps lines, ticks and
 * immovable annotation.
 *
 * These tests pin the fixed behavior:
 *   1. zero rotation-aware TEXT bbox collisions in the two representative
 *      exports (mirror-layer duplicates deduplicated),
 *   2. byte-identical determinism of plan and DXF per input/seed,
 *   3. the frozen AutoCAD 2027 profile: HEADER = [$ACADVER → AC1009] only,
 *      no VPORT table, no *ACTIVE, no R13+ header variables.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateLayout, writeDXF } from '../pipeline.js';
import { annotationTextRect, validateDXFStructure } from './writer.js';
import type { ProjectInput } from '../model/project.js';

interface Ent { type: string; codes: Record<number, string> }

function entities(dxf: string): Ent[] {
  const lines = dxf.split(/\r?\n/);
  const out: Ent[] = [];
  let sec = '';
  let cur: Ent | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const value = lines[i + 1];
    if (code === 0 && value === 'SECTION') { cur = null; continue; }
    if (code === 2 && cur === null && sec === '') { sec = value; continue; }
    if (code === 0 && value === 'ENDSEC') { sec = ''; continue; }
    if (sec !== 'ENTITIES') continue;
    if (code === 0) { if (cur) out.push(cur); cur = { type: value, codes: {} }; continue; }
    if (cur) cur.codes[code] = value;
  }
  if (cur) out.push(cur);
  return out;
}

const VILLA = {
  type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
  kitchenType: 'closed', parkingSpaces: 1, hasStorage: false,
} as const;

function rectInput(): ProjectInput {
  return {
    name: 'rect-final',
    site: { shape: 'rectangle', width: 15, length: 24, accessSide: 'south', streetWidth: 6 },
    building: { ...VILLA },
    seed: 42,
  } as ProjectInput;
}

function lInput(): ProjectInput {
  return {
    name: 'P25 L',
    site: {
      shape: 'l-shape', width: 18, length: 22, accessSide: 'south', streetWidth: 8,
      lShape: { width: 18, length: 22, notchWidth: 7, notchLength: 9, notchCorner: 'ne' },
    },
    building: { ...VILLA },
    seed: 42,
  } as ProjectInput;
}

/** TEXT entities deduplicated across the by-design floor mirror layers
 * (A-FLOOR-0-A-X repeats A-X at identical geometry — counted once). */
function distinctTexts(dxf: string): Array<{ layer: string; txt: string; x: number; y: number; h: number; j: number; rot: number }> {
  const seen = new Set<string>();
  const out: Array<{ layer: string; txt: string; x: number; y: number; h: number; j: number; rot: number }> = [];
  for (const e of entities(dxf)) {
    if (e.type !== 'TEXT') continue;
    const layer = (e.codes[8] ?? '').replace(/^A-FLOOR-\d+-/, '');
    const x = Number(e.codes[10]) / 1000, y = Number(e.codes[20]) / 1000;
    const h = Number(e.codes[40]) / 1000;
    const txt = e.codes[1] ?? '';
    const j = Number(e.codes[72] ?? 0);
    const rot = Number(e.codes[50] ?? 0);
    const k = `${layer}|${txt}|${x.toFixed(3)}|${y.toFixed(3)}|${h.toFixed(3)}|${j}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ layer, txt, x, y, h, j, rot });
  }
  return out;
}

describe('P29-B: exported DXF annotation TEXT collisions', () => {
  for (const [label, input] of [['RECT-15x24', rectInput()], ['L-NE-18x22', lInput()]] as const) {
    it(`${label}: zero rotation-aware annotation text collisions (mirror layers deduplicated)`, () => {
      const { bestCandidate } = generate(createProject(input));
      expect(bestCandidate).toBeTruthy();
      const dxf = writeDXF(bestCandidate!, input.name);
      expect(validateDXFStructure(dxf).ok).toBe(true);
      const texts = distinctTexts(dxf);
      expect(texts.length).toBeGreaterThan(30);
      const rects = texts.map(t => ({
        t, rect: annotationTextRect(t.x, t.y, t.txt, t.h, t.j, t.rot),
      }));
      const collisions: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let k = i + 1; k < rects.length; k++) {
          const a = rects[i], b = rects[k];
          const ox = Math.min(a.rect[2], b.rect[2]) - Math.max(a.rect[0], b.rect[0]);
          const oy = Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
          if (ox > 0.005 && oy > 0.005) {
            collisions.push(`"${a.t.txt}" (${a.t.layer}) × "${b.t.txt}" (${b.t.layer}) at (${a.t.x.toFixed(2)},${a.t.y.toFixed(2)})`);
          }
        }
      }
      expect(collisions, collisions.join('\n')).toEqual([]);
    });
  }

  it('dimension lines/ticks survive while only the colliding TEXT is suppressed (opening vs room dim strip)', () => {
    // Evidence (audit): window-0-11 (w 1.515 m, centered on bedroom-0-009's
    // left edge) sat exactly on the room chain-dim text slot. The opening
    // width TEXT must yield; the room dim TEXT, both dim lines and ticks stay.
    // P31-P1 re-pin: the circulation-connected row plan moved the west-edge
    // windows — window-0-15 (w 1.26 m, bedroom row west edge, y 17.74) now
    // occupies the same colliding slot, with the identical kept '3.03 m' room
    // dim text and the same x=1.68 opening-width dim lines.
    const { bestCandidate } = generate(createProject(lInput()));
    const fl = bestCandidate!.floors[0];
    const win = fl.openings.find(o => o.type === 'window' && Math.abs(o.center.y - 17.74) < 0.05);
    expect(win).toBeTruthy();
    const dxf = writeDXF(bestCandidate!, 'P25 L');
    const texts = distinctTexts(dxf).map(t => t.txt);
    expect(texts).not.toContain(`${win!.width.toFixed(2)} m`); // suppressed opening text
    expect(texts).toContain('3.03 m');                          // kept room dim text
    const ents = entities(dxf);
    // opening-width dim line at x = 2 - 0.32 = 1.68 m (mirror layers → 2 copies)
    const owDimLines = ents.filter(e => e.type === 'LINE'
      && /^A-(FLOOR-0-A-)?DIMS$/.test(e.codes[8] ?? '')
      && Math.abs(Number(e.codes[10]) / 1000 - 1.68) < 0.01
      && Math.abs(Number(e.codes[11]) / 1000 - 1.68) < 0.01);
    expect(owDimLines.length).toBeGreaterThanOrEqual(2);
  });
});

describe('P29-B: determinism (same input/seed → identical plan and DXF)', () => {
  for (const [label, input] of [['RECT-15x24', rectInput()], ['L-NE-18x22', lInput()]] as const) {
    it(`${label}: identical rooms and byte-identical DXF across runs`, () => {
      const r1 = generate(createProject(input));
      const r2 = generate(createProject(input));
      const plan1 = JSON.stringify(r1.bestCandidate!.floors[0].spaces.map(s => [s.id, s.rect]));
      const plan2 = JSON.stringify(r2.bestCandidate!.floors[0].spaces.map(s => [s.id, s.rect]));
      expect(plan1).toBe(plan2);
      const dxf1 = writeDXF(r1.bestCandidate!, input.name);
      const dxf2 = writeDXF(r2.bestCandidate!, input.name);
      const dxf3 = writeDXF(r1.bestCandidate!, input.name);
      expect(dxf1).toBe(dxf2);
      expect(dxf1).toBe(dxf3);
    });
  }
});

describe('P29-B: frozen AutoCAD 2027 R12 profile on the representative exports', () => {
  function headerVars(dxf: string): Array<[string, string]> {
    const lines = dxf.split(/\r?\n/);
    const vars: Array<[string, string]> = [];
    let sec = '';
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number(lines[i]);
      const value = lines[i + 1];
      if (code === 0 && value === 'SECTION') { sec = ''; continue; }
      if (code === 2 && sec === '') { sec = value; continue; }
      if (code === 0 && value === 'ENDSEC') { sec = ''; continue; }
      if (sec === 'HEADER' && code === 9) {
        const val = lines[i + 3] ?? '';
        vars.push([value, String(val).trim()]);
      }
    }
    return vars;
  }

  function tableNames(dxf: string): string[] {
    const lines = dxf.split(/\r?\n/);
    const names: string[] = [];
    let sec = '';
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number(lines[i]);
      const value = lines[i + 1];
      if (code === 0 && value === 'SECTION') { sec = ''; continue; }
      if (code === 2 && sec === '') { sec = value; continue; }
      if (code === 0 && value === 'ENDSEC') { sec = ''; continue; }
      if (sec === 'TABLES' && code === 2 && lines[i - 2] === 'TABLE') names.push(value);
    }
    return names;
  }

  for (const [label, input] of [['RECT-15x24', rectInput()], ['L-NE-18x22', lInput()]] as const) {
    it(`${label}: AC1009, HEADER = [$ACADVER] only, no VPORT/*ACTIVE, R12-clean structure`, () => {
      const { bestCandidate } = generate(createProject(input));
      const dxf = writeDXF(bestCandidate!, input.name);
      expect(validateDXFStructure(dxf).ok).toBe(true);
      // Phase 28-E/H0 evidence: the minimal header is the proven-openable profile.
      expect(headerVars(dxf).map(v => v[0])).toEqual(['$ACADVER']);
      expect(headerVars(dxf)[0][1]).toBe('AC1009');
      const tables = tableNames(dxf);
      expect(tables).not.toContain('VPORT');
      expect(dxf).not.toContain('*ACTIVE');
      expect(dxf.startsWith('0\r\nSECTION\r\n')).toBe(true);
      expect(dxf.endsWith('0\r\nEOF\r\n')).toBe(true);
      const types = new Set(entities(dxf).map(e => e.type));
      for (const t of types) expect(['LINE', 'ARC', 'TEXT', 'POLYLINE', 'VERTEX', 'SEQEND']).toContain(t);
    });
  }

  it('L-NE-18x22: valid geometry, no room overlaps, no circulation regressions', () => {
    const { bestCandidate } = generate(createProject(lInput()));
    const fl = bestCandidate!.floors[0];
    const vr = validateLayout(bestCandidate!);
    expect(vr.hard).toEqual([]);
    // explicit pairwise room-overlap check (touching edges are legal)
    for (let i = 0; i < fl.spaces.length; i++) {
      for (let k = i + 1; k < fl.spaces.length; k++) {
        const a = fl.spaces[i].rect, b = fl.spaces[k].rect;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox <= 0.01 || oy <= 0.01, `rooms ${fl.spaces[i].id} × ${fl.spaces[k].id} overlap`).toBe(true);
      }
    }
    const circHard = vr.hard.filter(f => f.code.startsWith('CIRC'));
    expect(circHard).toEqual([]);
  });
});
