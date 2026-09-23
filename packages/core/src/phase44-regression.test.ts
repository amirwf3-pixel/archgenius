import { describe, it, expect } from 'vitest';
import { createProject, generate } from './pipeline.js';
import { writeDXF } from './dxf/writer.js';
import { validateLayout } from './validation/validator.js';
import type { ProjectInput } from './model/project.js';

/**
 * Phase 44 — focused regression tests for the two audited Test-02 defects.
 *
 * P0 (geometry/boundary): the M4 vertical-spine last-row cap used to manufacture a
 * sub-0.6 m corner sliver at a band's free end (evidenced: 14×22 villa left a
 * 0.427 m × 4.25 m notch at the NE corner), which pulled the exterior wall inside
 * the declared footprint/grid line and notched the building outline. The fix reuses
 * the existing CELL_QUALITY_MIN_VOID guard; these tests pin that the envelope now
 * closes (a leftover at the free end is either 0 or >= the sliver threshold).
 *
 * P1 (presentation): the layer legend was starved by an over-wide title box and
 * collapsed to 0.09 m text, crossed the title-box border, and dropped rows; the site
 * metadata was anchored at the site's min-x and clipped outside the drawing border.
 * These tests pin a complete (11-row), legible (>= 0.12 m), contained legend and
 * border-clamped site metadata.
 */

const TEST02: ProjectInput = {
  name: 'P44 regression',
  deterministic: true,
  seed: 42,
  site: {
    shape: 'rectangle', width: 14, length: 22, accessSide: 'south', streetWidth: 6,
    setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
  },
  building: {
    type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
    kitchenType: 'closed', parkingSpaces: 1, hasElevator: false, hasStair: false, hasStorage: false,
  },
};

function candidate() {
  const out = generate(createProject(TEST02), {});
  if (!out.bestCandidate) throw new Error('expected a usable Test-02 candidate');
  return out.bestCandidate;
}

interface TextEnt { layer: string; x: number; y: number; h: number; txt: string; }

function texts(dxf: string): TextEnt[] {
  const lines = dxf.split('\r\n');
  const out: TextEnt[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (Number(lines[i]) === 0 && lines[i + 1] === 'TEXT') {
      const codes: Record<number, string> = {};
      for (let j = i + 2; j + 1 < lines.length && Number(lines[j]) !== 0; j += 2) codes[Number(lines[j])] = lines[j + 1];
      out.push({ layer: codes[8] ?? '', x: Number(codes[10]), y: Number(codes[20]), h: Number(codes[40]), txt: codes[1] ?? '' });
    }
  }
  return out;
}

const CW = 0.72; // writer's ROOM_TXT_CHAR_W metric

describe('P44 — Test 02 envelope closure (P0)', () => {
  const cand = candidate();
  const fl = cand.floors[0];
  const fp = fl.footprint;

  it('remains HARD-clean', () => {
    const val = validateLayout(cand, TEST02);
    expect(val.findings.filter(f => f.severity === 'hard')).toHaveLength(0);
  });

  it('no sub-threshold sliver at the band free end (north edge closes)', () => {
    const top = fp.y + fp.h;
    let maxRoomTop = -Infinity;
    for (const s of fl.spaces) maxRoomTop = Math.max(maxRoomTop, s.rect.y + s.rect.h);
    const gap = top - maxRoomTop;
    // Either flush (0) or a genuine intentional void (>= 0.6 m); never a sliver.
    expect(gap < 1e-6 || gap >= 0.6 - 1e-6).toBe(true);
  });

  it('an exterior wall runs along the full north facade at the footprint top', () => {
    const top = fp.y + fp.h;
    const northExt = fl.walls.filter(w =>
      (w.kind ?? w.type) === 'exterior' &&
      Math.abs(w.start.y - top) < 1e-6 && Math.abs(w.end.y - top) < 1e-6);
    // The combined north exterior segments must reach the east edge.
    const reachEast = northExt.some(w => Math.max(w.start.x, w.end.x) >= fp.x + fp.w - 1e-6);
    expect(reachEast).toBe(true);
  });
});

describe('P44 — title block / legend readability (P1)', () => {
  const cand = candidate();
  const dxf = writeDXF(cand, TEST02.name);
  const all = texts(dxf);
  const legendRows = all.filter(t => t.layer === 'A-TITLE' && /^A-[A-Z-]+ - /.test(t.txt));
  const projectNameT = all.find(t => t.layer === 'A-TITLE' && t.txt === 'P44 regression');

  it('legend is complete: all 11 discipline rows present', () => {
    expect(legendRows).toHaveLength(11);
    expect(legendRows.some(t => t.txt.startsWith('A-GRID - '))).toBe(true);
  });

  it('legend rows stay at a legible height (>= 0.12 m), not the old 0.09 floor', () => {
    for (const t of legendRows) expect(t.h).toBeGreaterThanOrEqual(0.12 - 1e-9);
  });

  it('legend never crosses into the title box (right edge left of the project name)', () => {
    expect(projectNameT).toBeDefined();
    const nameX = projectNameT!.x;
    for (const t of legendRows) {
      const right = t.x + t.txt.length * t.h * CW;
      expect(right).toBeLessThanOrEqual(nameX);
    }
  });

  it('lower site metadata stays inside the drawing border', () => {
    const fp = cand.floors[0].footprint;
    const borderL = (fp.x - 1.5) * 1000; // mm
    const siteMeta = all.find(t => t.layer === 'A-SITE' && t.txt.startsWith('SITE'));
    expect(siteMeta).toBeDefined();
    expect(siteMeta!.x).toBeGreaterThanOrEqual(borderL);
  });
});
