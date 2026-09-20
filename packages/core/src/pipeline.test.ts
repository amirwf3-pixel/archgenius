import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF, validateCandidate } from './pipeline.js';
import type { ProjectInput } from './model/project.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

function baseInput(): ProjectInput {
  return {
    name: 'Test Villa',
    site: {
      shape: 'rectangle',
      width: 15,
      length: 20,
      accessSide: 'south',
      streetWidth: 8,
      northRotationDeg: 0,
    },
    building: {
      type: 'villa',
      floors: 1,
      bedrooms: 2,
      masterBedrooms: 1,
      bathrooms: 2,
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 2,
      hasStair: false,
      hasElevator: false,
      hasBalcony: false,
      hasStorage: true,
      hasYard: false,
    },
    deterministic: true,
    seed: 42,
  };
}

describe('End-to-end pipeline', () => {
  it('creates a project and generates at least one candidate', () => {
    const prj = createProject(baseInput());
    expect(prj.id).toBeTruthy();
    const { candidates } = generate(prj);
    expect(candidates.length).toBe(1);
  });

  it('produces no overlapping rooms (geometrically valid)', () => {
    const prj = createProject(baseInput());
    const { candidates } = generate(prj);
    const c = candidates[0];
    const vr = validateCandidate(c);
    for (const h of vr.hard) {
      // Print for debugging
      // eslint-disable-next-line no-console
      console.log('HARD:', h.code, h.message);
    }
    // Tolerate no HARD geometric issues.
    const hardGeo = vr.hard.filter(f => f.code.startsWith('GEO_'));
    expect(hardGeo).toEqual([]);
  });

  it('produces rooms for all expected spaces', () => {
    const prj = createProject(baseInput());
    const { candidates } = generate(prj);
    const c = candidates[0];
    const types = new Set(c.floors[0].spaces.map(s => s.type));
    expect(types.has('corridor')).toBe(true);
    expect(types.has('kitchen')).toBe(true);
    expect(types.has('living')).toBe(true);
    expect(types.has('master-bedroom')).toBe(true);
  });

  it('places an entrance door and at least one window on ground floor', () => {
    const prj = createProject(baseInput());
    const { candidates } = generate(prj);
    const open = candidates[0].floors[0].openings;
    expect(open.some(o => o.type === 'entrance')).toBe(true);
    expect(open.some(o => o.type === 'door')).toBe(true);
    expect(open.some(o => o.type === 'window')).toBe(true);
  });

  it('generates valid DXF with required layers', () => {
    const prj = createProject(baseInput());
    const { candidates } = generate(prj);
    const { dxf, validation } = exportDXF(candidates[0], prj.input.name);
    expect(typeof dxf).toBe('string');
    expect(dxf.length).toBeGreaterThan(2000);
    expect(validation.ok).toBe(true);
    expect(dxf).toContain('A-WALL-EXT');
    expect(dxf).toContain('A-WALL-INT');
    expect(dxf).toContain('A-DOOR');
    expect(dxf).toContain('A-WINDOW');
    expect(dxf).toContain('A-ROOM');
    expect(dxf).toContain('A-DIMS');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
    // Save for inspection.
    writeFileSync(join('/home/user/archgenius', 'test-output-villa.dxf'), dxf, 'utf8');
  });

  it('works for a 3-bedroom apartment', () => {
    const inp = baseInput();
    inp.building.bedrooms = 3;
    inp.building.masterBedrooms = 1;
    inp.building.bathrooms = 2;
    inp.site.width = 18; inp.site.length = 25;
    const prj = createProject(inp);
    const { candidates } = generate(prj);
    expect(candidates.length).toBe(1);
    const vr = validateCandidate(candidates[0]);
    const hardGeo = vr.hard.filter(f => f.code.startsWith('GEO_'));
    expect(hardGeo).toEqual([]);
    const { dxf } = exportDXF(candidates[0], '3-bed-villa');
    expect(dxf.length).toBeGreaterThan(2000);
  });

  it('2-story villa with stair — Phase 15 M2 honest gate: usable winner is HARD-clean, else explicit INFEASIBLE', () => {
    const inp = baseInput();
    inp.building.floors = 2;
    inp.building.hasStair = true;
    inp.building.bedrooms = 3;
    inp.building.masterBedrooms = 1;
    inp.site.width = 18; inp.site.length = 25;
    const prj = createProject(inp);
    const res = generate(prj);
    if (!res.bestCandidate) {
      // Honest INFEASIBLE — never a hard-dirty winner (the pre-M2 CASE-B exposure is closed).
      expect(res.infeasible).not.toBeNull();
      expect(['HARD_CONSTRAINT_INFEASIBLE_DIMENSION', 'HARD_RULE_VIOLATION']).toContain(res.infeasible!.code);
      expect(res.candidates).toEqual([]);
      expect(prj.selectedCandidateId).toBeUndefined();
      expect(res.infeasible!.diagnosticCandidates.length).toBeGreaterThan(0);
      const diag = res.infeasible!.diagnosticCandidates[0];
      expect(diag.floors.length).toBe(2);
      expect(diag.floors[0].stairs.length).toBeGreaterThanOrEqual(1);
      expect(() => exportDXF(diag as any, '2-story-villa')).toThrow(/diagnostic-only/);
      return;
    }
    // Usable winner: structurally sound AND zero HARD findings (gate guarantee, re-checked here).
    expect(res.bestCandidate.floors.length).toBe(2);
    expect(res.bestCandidate.floors[0].stairs.length).toBeGreaterThanOrEqual(1);
    const vr = validateCandidate(res.bestCandidate);
    expect(vr.hard).toEqual([]);
    const { dxf, validation } = exportDXF(res.bestCandidate, '2-story-villa');
    expect(validation.ok).toBe(true);
    writeFileSync(join('/home/user/archgenius', 'test-output-2story.dxf'), dxf, 'utf8');
  });

  it('rejects invalid input (bad dimensions)', () => {
    const bad = baseInput();
    bad.site.width = 0.5; // too small
    expect(() => createProject(bad)).toThrow(/Invalid project input/);
  });
});
