/**
 * Phase 15 M1 — Generalized stress-test matrix (NO production code involved).
 *
 * 560 deterministic cases = 70 sites x 8 programs.
 *
 * Sites (70):
 *   - 56 rectangle sites: widths [8,10,12,14,16,20,25] x lengths [10,12,15,18,22,26,30,34]
 *   -  6 l-shape sites (notch variants incl. access-side and deep notches)
 *   -  8 orthogonal polygon sites (U, T, Z, right-stair, wide-L, narrow-L,
 *     notched rectangle, boot — all simple, orthogonal, <= 8 vertices)
 *
 * Programs (8):
 *   - 5 single-floor (1F): 1BD / 2BD / 3BD / 4BD / 3BD+2MB balcony
 *   - 3 multi-floor: 2F/3BD, 2F/4BD+family, 3F/5BD (villa, stair forced by AGX-02)
 *
 * Determinism: fixed seed per case (input.seed), no randomness anywhere.
 * Every case is generated through the exact public pipeline API
 * (createProject -> generate) — the matrix deliberately covers narrow sites
 * (width 8: buildable ~4 m after default setbacks) and large sites alike.
 */
import type { ProjectInput } from '../model/project.js';
import type { SiteInput } from '../model/site.js';
import type { BuildingInput } from '../model/building.js';

export const STRESS_MATRIX_SIZE = 560;
export const STRESS_DEFAULT_SEED = 42;

export interface StressCase {
  id: string;
  cohort: 'single' | 'multi';
  siteClass: 'rectangle' | 'l-shape' | 'polygon';
  siteId: string;
  programId: string;
  input: ProjectInput;
}

interface SiteDef {
  id: string;
  klass: StressCase['siteClass'];
  site: SiteInput;
}

function rectSites(): SiteDef[] {
  const widths = [8, 10, 12, 14, 16, 20, 25];
  const lengths = [10, 12, 15, 18, 22, 26, 30, 34];
  const out: SiteDef[] = [];
  for (const width of widths) {
    for (const length of lengths) {
      out.push({
        id: `R${width}x${length}`,
        klass: 'rectangle',
        site: { shape: 'rectangle', width, length, accessSide: 'south', streetWidth: 8 },
      });
    }
  }
  return out;
}

function lShapeSites(): SiteDef[] {
  const defs: Array<{ w: number; l: number; nw: number; nl: number; corner: 'ne' | 'nw' | 'se' | 'sw' }> = [
    { w: 16, l: 20, nw: 6, nl: 7, corner: 'nw' }, // moderate notch, away from access
    { w: 18, l: 22, nw: 5, nl: 8, corner: 'ne' }, // asymmetric notch right side
    { w: 20, l: 18, nw: 7, nl: 6, corner: 'sw' }, // notch ON the access side — frontage squeeze
    { w: 14, l: 18, nw: 6, nl: 6, corner: 'se' }, // access-side corner cut
    { w: 22, l: 24, nw: 9, nl: 12, corner: 'nw' }, // deep L — long leg + short leg
    { w: 16, l: 20, nw: 3, nl: 4, corner: 'ne' },  // almost-rectangular asymmetric site
  ];
  return defs.map((d, i) => ({
    id: `L${i + 1}`,
    klass: 'l-shape' as const,
    site: {
      shape: 'l-shape',
      width: d.w,
      length: d.l,
      accessSide: 'south',
      streetWidth: 8,
      lShape: { width: d.w, length: d.l, notchWidth: d.nw, notchLength: d.nl, notchCorner: d.corner },
    },
  }));
}

function polygonSites(): SiteDef[] {
  // All orthogonal, simple, no self-intersection, 3..8 vertices, area >= 10 m².
  const verts: Array<[number, number][]> = [
    // U opening north (8v)
    [[0, 0], [24, 0], [24, 16], [16, 16], [16, 8], [8, 8], [8, 16], [0, 16]],
    // T with south stem (8v)
    [[10, 0], [16, 0], [16, 8], [24, 8], [24, 16], [0, 16], [0, 8], [10, 8]],
    // Z / stepped (6v)
    [[0, 0], [16, 0], [16, 8], [8, 8], [8, 16], [0, 16]],
    // right-stair ascending east (6v)
    [[0, 0], [8, 0], [8, 8], [16, 8], [16, 16], [0, 16]],
    // wide L, 20x20 minus NE quadrant (6v)
    [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]],
    // narrow asymmetric L (6v)
    [[0, 0], [6, 0], [6, 14], [14, 14], [14, 20], [0, 20]],
    // rectangle notched from east edge — 8v courtyard pocket
    [[0, 0], [20, 0], [20, 7], [14, 7], [14, 13], [20, 13], [20, 20], [0, 20]],
    // boot shape (8v)
    [[0, 0], [10, 0], [10, 4], [18, 4], [18, 16], [12, 16], [12, 10], [0, 10]],
  ];
  return verts.map((v, i) => {
    const xs = v.map(p => p[0]);
    const ys = v.map(p => p[1]);
    const width = Math.max(...xs);
    const length = Math.max(...ys);
    return {
      id: `P${i + 1}`,
      klass: 'polygon' as const,
      site: {
        shape: 'polygon',
        width,
        length,
        accessSide: 'south',
        streetWidth: 8,
        polygon: { vertices: v.map(([x, y]) => ({ x, y })) },
      },
    };
  });
}

export function stressSites(): SiteDef[] {
  return [...rectSites(), ...lShapeSites(), ...polygonSites()];
}

function villa(over: Partial<BuildingInput>): BuildingInput {
  return {
    type: 'villa',
    floors: 1,
    bedrooms: 2,
    masterBedrooms: 1,
    bathrooms: 1,
    wc: 1,
    kitchenType: 'closed',
    parkingSpaces: 0,
    ...over,
  };
}

interface ProgramDef {
  id: string;
  cohort: StressCase['cohort'];
  building: BuildingInput;
}

export function stressPrograms(): ProgramDef[] {
  return [
    { id: 'S0-1bd-open', cohort: 'single', building: villa({ floors: 1, bedrooms: 1, masterBedrooms: 0, bathrooms: 1, wc: 1, kitchenType: 'open', parkingSpaces: 0 }) },
    { id: 'S1-2bd',      cohort: 'single', building: villa({ floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 }) },
    { id: 'S2-3bd',      cohort: 'single', building: villa({ floors: 1, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStorage: true }) },
    { id: 'S3-4bd',      cohort: 'single', building: villa({ floors: 1, bedrooms: 4, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStorage: true }) },
    { id: 'S4-3bd2mb',   cohort: 'single', building: villa({ floors: 1, bedrooms: 3, masterBedrooms: 2, bathrooms: 2, wc: 1, kitchenType: 'semi-open', parkingSpaces: 1, hasStorage: true, hasBalcony: true }) },
    { id: 'U0-2f3bd',    cohort: 'multi',  building: villa({ floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true, hasStorage: true }) },
    { id: 'U1-2f4bd',    cohort: 'multi',  building: villa({ floors: 2, bedrooms: 4, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true, hasStorage: true, hasFamilyRoom: true }) },
    { id: 'U2-3f5bd',    cohort: 'multi',  building: villa({ floors: 3, bedrooms: 5, masterBedrooms: 2, bathrooms: 3, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true, hasStorage: true }) },
  ];
}

/** Build the full deterministic 560-case matrix (site-major order). */
export function buildStressCases(seed = STRESS_DEFAULT_SEED): StressCase[] {
  const cases: StressCase[] = [];
  for (const site of stressSites()) {
    for (const prog of stressPrograms()) {
      cases.push({
        id: `${site.id}--${prog.id}`,
        cohort: prog.cohort,
        siteClass: site.klass,
        siteId: site.id,
        programId: prog.id,
        input: {
          name: `P15-${site.id}-${prog.id}`,
          site: site.site,
          building: { ...prog.building },
          deterministic: true,
          seed,
        },
      });
    }
  }
  if (cases.length !== STRESS_MATRIX_SIZE) {
    throw new Error(`stress matrix drift: expected ${STRESS_MATRIX_SIZE} cases, got ${cases.length}`);
  }
  return cases;
}
