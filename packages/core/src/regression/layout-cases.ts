/**
 * Layout regression harness — case definitions (Task 187).
 *
 * The inputs for the layout benchmark and sweep, frozen in one place so that
 * `scripts/layout-regression.mjs` can feed IDENTICAL inputs to a baseline build and a
 * candidate build. Nothing here changes generator behaviour; it only enumerates inputs.
 *
 * 1. BENCHMARK — 128 candidate rows. A verbatim copy of the Task 135 benchmark in
 *    `src/generator/stair-connector-hard-reduction.test.ts` (SITES × PROGS × seeds
 *    {42, 7} × 4 STRATS, run through `generateLayouts(input, STRATS, CURRENT)`).
 *    `layout-cases.test.ts` checks that this copy still reproduces that test's pinned
 *    baseline (110 valid / 74 HARD).
 *
 * 2. SWEEP — 560 cases. Exactly the Phase 15 stress matrix from `src/stress/matrix.ts`
 *    (`buildStressCases()`, seed 42), run through the public pipeline
 *    (`createProject` → `generate`), the same way `src/stress/stress.ts` does.
 *
 *    HISTORICAL NOTE: earlier ad-hoc sweeps (untracked /tmp scripts, now lost) reported
 *    564 cases. Only the 560 matrix cases can be reproduced from the repository. The
 *    4 extra historical cases are not defined anywhere in the repo, so they are
 *    INTENTIONALLY EXCLUDED rather than reconstructed or invented.
 */
import type { ProjectInput } from '../model/project.js';
import type { CandidateStrategy } from '../model/layout.js';
import type { GenerateLayoutsOptions } from '../generator/generator.js';
import { buildStressCases, STRESS_MATRIX_SIZE } from '../stress/matrix.js';
import { isV1SupportedSite } from '../site/v1-scope.js';

// ------------------------------------------------------------------ benchmark (Task 135)
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B1 = { ...B2, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 };
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };

export const BENCHMARK_SITES: Readonly<Record<string, object>> = {
  rect: RECT,
  rectE: { ...RECT, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 },
  rect14: { ...RECT, width: 14, length: 22 },
  lshape: { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } },
};
export const BENCHMARK_PROGRAMS: Readonly<Record<string, object>> = { b1: B1, b2: B2, b3lift: B3LIFT, b4: B4 };
export const BENCHMARK_SEEDS: readonly number[] = [42, 7];
export const BENCHMARK_STRATEGIES: readonly CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];

/** The Task 135 `CURRENT` option set (20 opt-in options on). */
export const BENCHMARK_OPTIONS: Readonly<GenerateLayoutsOptions> = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true, alignLShapeEntryFoyer: true,
  stackedPairMinArea: true, notchShaftCorridorOverlap: true, lShapeUpperCoreCirculation: true, lShapeRoomQualitySelection: true,
};

export const BENCHMARK_ROW_COUNT = 128;
export const SWEEP_CASE_COUNT = 560;
/** Size reported by the lost historical sweep scripts; NOT reproducible (see header). */
export const HISTORICAL_SWEEP_CASE_COUNT = 564;
export const SWEEP_EXCLUDED_HISTORICAL_CASES = HISTORICAL_SWEEP_CASE_COUNT - SWEEP_CASE_COUNT;

export interface RegressionInput {
  /** Stable case id (benchmark: `site/prog/seed`; sweep: stress-matrix id). */
  id: string;
  input: ProjectInput;
}

/** 32 benchmark inputs (each yields 4 strategy rows → 128 rows), in Task 135 order. */
export function benchmarkInputs(): RegressionInput[] {
  const out: RegressionInput[] = [];
  for (const [sk, site] of Object.entries(BENCHMARK_SITES)) for (const [pk, b] of Object.entries(BENCHMARK_PROGRAMS)) for (const seed of BENCHMARK_SEEDS) {
    out.push({ id: `${sk}/${pk}/${seed}`, input: JSON.parse(JSON.stringify({ site, building: b, seed, deterministic: true, jurisdiction: 'IR' })) });
  }
  return out;
}

/** The 560 stress-matrix inputs, in matrix order. */
export function sweepInputs(): RegressionInput[] {
  const cases = buildStressCases();
  if (cases.length !== STRESS_MATRIX_SIZE || cases.length !== SWEEP_CASE_COUNT) {
    throw new Error(`sweep matrix size ${cases.length} != ${SWEEP_CASE_COUNT}`);
  }
  return cases.map(c => ({ id: c.id, input: JSON.parse(JSON.stringify(c.input)) }));
}

/**
 * V1 production scope (Rectangle-only planning): the subset of `inputs` whose site is a
 * plain rectangle, in the original order. Non-rectangular cases exercise the dormant
 * L-shape / polygon planner and are excluded from V1 comparisons.
 */
export function v1ScopeInputs(inputs: RegressionInput[]): RegressionInput[] {
  return inputs.filter(c => isV1SupportedSite(c.input.site));
}
