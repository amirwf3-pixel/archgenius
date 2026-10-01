/**
 * V1 productization — the form's setbacks reach the engine through the declared
 * SiteInput fields (setbackNorth/South/East/West).
 *
 * The UI used to send an undeclared nested `site.setbacks` object. The buildable
 * geometry accepted it, but the DEF-SETBACK-001 "Applied setbacks N=… S=… E=… W=…"
 * regulation finding reads only the declared fields, so the validation panel reported
 * the engine defaults instead of the user's values. The geometry must be unchanged.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF } from '@archgenius/core';
import type { ProjectInput } from '@archgenius/core';
import { DEFAULT_STATE, buildProjectInput } from './App';
import type { FormState } from './App';
import { formFromProject } from './ProjectManager';
import { tf, faNum } from './i18n';

const FORM: FormState = { ...DEFAULT_STATE, setbackNorth: 2.5, setbackSouth: 3, setbackEast: 2, setbackWest: 1.5 };

function appliedSetbackMessage(input: ProjectInput): string {
  const best = generate(createProject(structuredClone(input)), { allStrategies: true }).bestCandidate!;
  const msg = best.findings.map(f => f.message).find(m => m.includes('DEF-SETBACK-001: Applied setbacks'));
  expect(msg).toBeDefined();
  return msg!;
}

/** The pre-fix input shape: identical values in the legacy nested object. */
function legacyNested(form: FormState): ProjectInput {
  const input: any = structuredClone(buildProjectInput(form));
  const s = input.site;
  s.setbacks = { north: s.setbackNorth, south: s.setbackSouth, east: s.setbackEast, west: s.setbackWest };
  delete s.setbackNorth; delete s.setbackSouth; delete s.setbackEast; delete s.setbackWest;
  return input;
}

describe('form setbacks → engine input', () => {
  it('builds the declared flat setback fields with the form values', () => {
    const site: any = buildProjectInput(FORM).site;
    expect([site.setbackNorth, site.setbackSouth, site.setbackEast, site.setbackWest]).toEqual([2.5, 3, 2, 1.5]);
    expect(site.setbacks).toBeUndefined();
  });

  it('the applied-setbacks finding reports the user values, not the defaults', () => {
    expect(appliedSetbackMessage(buildProjectInput(FORM))).toContain('Applied setbacks N=2.5 S=3 E=2 W=1.5 m.');
  });

  it('geometry and DXF are byte-identical to the legacy nested-setbacks input', () => {
    const now = generate(createProject(buildProjectInput(FORM)), { allStrategies: true });
    const before = generate(createProject(legacyNested(FORM)), { allStrategies: true });
    expect(now.candidates.map(c => c.metadata.strategy)).toEqual(before.candidates.map(c => c.metadata.strategy));
    expect(JSON.stringify(now.candidates.map(c => c.floors))).toBe(JSON.stringify(before.candidates.map(c => c.floors)));
    expect(exportDXF(now.bestCandidate!, 'x').dxf).toBe(exportDXF(before.bestCandidate!, 'x').dxf);
  });

  it('saved projects of either shape restore the setbacks', () => {
    for (const input of [buildProjectInput(FORM), legacyNested(FORM)]) {
      const f = formFromProject({ id: 'p', input, createdAt: 0, updatedAt: 0, schemaVersion: 1 } as any, DEFAULT_STATE);
      expect([f.setbackNorth, f.setbackSouth, f.setbackEast, f.setbackWest]).toEqual([2.5, 3, 2, 1.5]);
    }
  });
});

describe('plan canvas floor caption', () => {
  it('is "floor {current} of {total}" (1-based, like the floor picker)', () => {
    const caption = tf('canvasFloor', { current: faNum(1), total: faNum(3), count: faNum(6) });
    expect(caption.startsWith(`طبقهٔ ${faNum(1)} از ${faNum(3)} — ${faNum(6)} فضا`)).toBe(true);
    expect(caption).not.toMatch(/[{}]/);
  });
});
