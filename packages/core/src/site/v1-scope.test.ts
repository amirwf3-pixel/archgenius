/**
 * V1 scope — Rectangle is the sole production planning geometry.
 *
 * createProject() / generate() plan rectangle sites through the unchanged pipeline and
 * reject every other site geometry deterministically with UNSUPPORTED_SITE_GEOMETRY —
 * never silently converting it to a rectangle. The dormant L-shape / polygon planner is
 * untouched (engine-level generateLayouts and the internal allowDormantSiteGeometry opt-in).
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, writeDXF } from '../pipeline.js';
import { generateLayouts } from '../generator/generator.js';
import type { ProjectInput } from '../model/project.js';
import type { Project } from '../model/project.js';
import {
  V1_SUPPORTED_SITE_SHAPES, UNSUPPORTED_SITE_GEOMETRY, UnsupportedSiteGeometryError,
  isV1SupportedSite, v1SiteScopeViolation, assertV1SiteScope,
} from './v1-scope.js';

const BUILDING = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const RECT = { shape: 'rectangle', width: 14, length: 22, accessSide: 'south', streetWidth: 8, setbackNorth: 3, setbackSouth: 1.5, setbackEast: 1, setbackWest: 1 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'ne' } } as const;
// A polygon whose vertices happen to form a rectangle is still a polygon site: rejected, not converted.
const RECT_POLYGON = { ...RECT, shape: 'polygon', polygon: { vertices: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 22 }, { x: 0, y: 22 }] } } as const;
const L_POLYGON = { ...RECT, shape: 'polygon', width: 18, length: 22, polygon: { vertices: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 12 }, { x: 10, y: 12 }, { x: 10, y: 22 }, { x: 0, y: 22 }] } } as const;

const input = (site: object): ProjectInput => JSON.parse(JSON.stringify({ site, building: BUILDING, seed: 42, deterministic: true, jurisdiction: 'IR' }));
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? 0 : v));

function rejection(fn: () => unknown): UnsupportedSiteGeometryError {
  try { fn(); } catch (e) { return e as UnsupportedSiteGeometryError; }
  throw new Error('expected a V1 scope rejection');
}

describe('V1 scope — rectangle is the only production geometry', () => {
  it('declares rectangle as the sole supported site shape', () => {
    expect(V1_SUPPORTED_SITE_SHAPES).toEqual(['rectangle']);
    expect(isV1SupportedSite(input(RECT).site)).toBe(true);
    expect(v1SiteScopeViolation(input(RECT).site)).toBeNull();
    for (const s of [LSHAPE, RECT_POLYGON, L_POLYGON]) expect(isV1SupportedSite(input(s).site)).toBe(false);
  });

  it('plans a rectangle through the unchanged pipeline (the internal opt-in changes nothing)', () => {
    const r1 = generate(createProject(input(RECT)), { allStrategies: true });
    expect(r1.bestCandidate).not.toBeNull();
    const r2 = generate(createProject(input(RECT), { allowDormantSiteGeometry: true }), { allStrategies: true, allowDormantSiteGeometry: true });
    expect(strip(r1.candidates)).toBe(strip(r2.candidates));
    const r3 = generate(createProject(input(RECT)), { allStrategies: true });
    expect(strip(r1.candidates)).toBe(strip(r3.candidates));
    const dxf = writeDXF(r1.bestCandidate!);
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toMatch(/\$ACADVER\s*\r?\n\s*1\s*\r?\nAC1009/);
  });

  for (const [name, site] of [['l-shape', LSHAPE], ['polygon (rectangular vertices)', RECT_POLYGON], ['polygon (L outline)', L_POLYGON]] as const) {
    it(`createProject rejects ${name} deterministically with ${UNSUPPORTED_SITE_GEOMETRY}`, () => {
      const e1 = rejection(() => createProject(input(site)));
      const e2 = rejection(() => createProject(input(site)));
      expect(e1).toBeInstanceOf(UnsupportedSiteGeometryError);
      expect(e1.code).toBe(UNSUPPORTED_SITE_GEOMETRY);
      expect(e1.shape).toBe(site.shape);
      expect(e1.message).toMatch(/^UNSUPPORTED_SITE_GEOMETRY: /);
      expect(e1.message).toContain(`"${site.shape}"`);
      expect(e1.message).toBe(e2.message);
    });
  }

  it('generate() rejects a non-rectangular project built without createProject (no silent conversion)', () => {
    const inp = input(LSHAPE);
    const project: Project = { id: 'prj-x', input: inp, candidates: [], createdAt: 0, updatedAt: 0, schemaVersion: createProject(input(RECT)).schemaVersion };
    const e = rejection(() => generate(project, { allStrategies: true }));
    expect(e.code).toBe(UNSUPPORTED_SITE_GEOMETRY);
    expect(inp.site.shape).toBe('l-shape'); // input untouched, never rewritten to rectangle
  });

  it('rejects a rectangle that carries non-rectangular geometry instead of ignoring it', () => {
    const e = rejection(() => createProject(input({ ...RECT, lShape: LSHAPE.lShape })));
    expect(e.code).toBe(UNSUPPORTED_SITE_GEOMETRY);
    expect(e.message).toContain('lShape');
    expect(() => assertV1SiteScope(input({ ...RECT, polygon: RECT_POLYGON.polygon }))).toThrow(UnsupportedSiteGeometryError);
  });

  it('keeps the existing input validation first: malformed geometry still reports its validation error', () => {
    expect(() => createProject(input({ ...RECT, shape: 'circle' }))).toThrow(/site\.shape must be one of/);
    const bad = { ...RECT, shape: 'polygon', polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } };
    expect(() => createProject(input(bad))).toThrow(/at least 3 vertices/);
  });

  it('leaves the dormant L-shape planner intact (engine level and internal opt-in only)', () => {
    const engine = generateLayouts(input(LSHAPE), ['area-efficiency']);
    expect(engine.length).toBe(1);
    const dormant = generate(createProject(input(LSHAPE), { allowDormantSiteGeometry: true }), { allowDormantSiteGeometry: true });
    expect(dormant.project.input.site.shape).toBe('l-shape');
  });
});
