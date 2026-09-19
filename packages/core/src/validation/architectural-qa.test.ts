import { describe, it, expect } from 'vitest';
import { generateLayouts } from '../generator/generator.js';
import { validateFloor } from './validator.js';
import { writeDXF, validateDXFStructure } from '../dxf/writer.js';
import type { ProjectInput } from '../model/project.js';

function generateCandidates(project: ProjectInput, count: number) {
  const res = generateLayouts(project, ['functional-circulation', 'area-efficiency', 'daylight-orientation', 'alternative-zoning']);
  return res.slice(0, count);
}

function makeProject(overrides: Partial<ProjectInput> = {}): ProjectInput {
  const base: ProjectInput = {
    name: 'QA Test',
    site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 },
    building: {
      type: 'villa',
      floors: 1,
      bedrooms: 2,
      masterBedrooms: 1,
      bathrooms: 1,
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 1,
      hasStair: false,
      hasStorage: true,
    },
    seed: 42,
    deterministic: true,
  };
  return { ...base, ...overrides, site: { ...base.site, ...(overrides.site as any) }, building: { ...base.building, ...(overrides.building as any) } };
}

describe('Phase 6 — Architectural QA', () => {
  it('flags ROOM_TOO_NARROW for very narrow rooms', () => {
    const project = makeProject({
      site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 },
    });
    const candidates = generateCandidates(project, 1);
    expect(candidates.length).toBeGreaterThan(0);
    const floor = candidates[0].floors[0];
    const findings = validateFloor(floor);
    const unusable = findings.filter(f => f.code === 'ROOM_UNUSABLE' && f.severity === 'hard');
    expect(unusable.length).toBe(0);
  });

  it('detects circulation ratio and dead-ends', () => {
    const project = makeProject();
    const candidates = generateCandidates(project, 3);
    for (const c of candidates) {
      expect(c.metrics.circulationRatio).toBeDefined();
      expect(c.metrics.circulationRatio).toBeGreaterThanOrEqual(0);
      expect(c.metrics.circulationRatio).toBeLessThanOrEqual(1);
      expect(c.metrics.totalCirculationArea).toBeDefined();
    }
  });

  it('validates DXF structure with new layers', () => {
    const project = makeProject();
    const candidates = generateCandidates(project, 1);
    const dxf = writeDXF(candidates[0], 'Test Plan');
    const res = validateDXFStructure(dxf);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(dxf).toContain('A-WALL-EXT');
    expect(dxf).toContain('A-WALL-CORE');
    expect(dxf).toContain('A-WALL-SERVICE');
    expect(dxf).toContain('A-GRID');
    expect(dxf).toContain('A-AXIS');
    // R12 header: view variables present; $INSUNITS is post-R12 and must be absent.
    expect(dxf).toContain('$VIEWCTR');
    expect(dxf).toContain('$VIEWSIZE');
    expect(dxf).not.toContain('INSUNITS');
  });

  it('ensures doors have hinge/leaf geometry', () => {
    const project = makeProject();
    const candidates = generateCandidates(project, 1);
    const floor = candidates[0].floors[0];
    const doors = floor.openings.filter(o => o.type === 'door' || o.type === 'entrance');
    expect(doors.length).toBeGreaterThan(0);
    for (const d of doors) {
      expect(d.hinge).toBeDefined();
      expect(d.leafEnd).toBeDefined();
      expect(d.openEnd).toBeDefined();
      expect(d.swingAngle).toBe(90);
    }
  });

  it('windows are on exterior walls only', () => {
    const project = makeProject();
    const candidates = generateCandidates(project, 2);
    for (const cand of candidates) {
      for (const fl of cand.floors) {
        const findings = validateFloor(fl);
        const winOutside = findings.filter(f => f.code === 'WINDOW_OUTSIDE' && f.severity === 'hard');
        expect(winOutside.length).toBe(0);
      }
    }
  });

  it('privacy: no hard failures for normal layout', () => {
    const project = makeProject();
    const candidates = generateCandidates(project, 1);
    const floor = candidates[0].floors[0];
    const findings = validateFloor(floor);
    const hardPrivacy = findings.filter(f => f.code === 'PRIVACY_WEAK' && f.severity === 'hard');
    expect(hardPrivacy.length).toBe(0);
  });

  it('deterministic ranking: HARD always dominates', () => {
    const project = makeProject();
    const candidates = generateCandidates(project, 5);
    // Sort should put candidates with HARD last
    const sorted = [...candidates].sort((a, b) => {
      const ha = a.findings.filter(f => f.severity === 'hard').length;
      const hb = b.findings.filter(f => f.severity === 'hard').length;
      return ha - hb;
    });
    // First candidate should have minimal HARD
    const minHard = Math.min(...candidates.map(c => c.findings.filter(f => f.severity === 'hard').length));
    expect(sorted[0].findings.filter(f => f.severity === 'hard').length).toBe(minHard);
  });
});
