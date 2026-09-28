import { configDefaults, defineWorkspace } from 'vitest/config';

/**
 * V1 scope (Rectangle-only production planning, see src/site/v1-scope.ts).
 *
 * These existing suites exercise the DORMANT L-shape / polygon planner through the
 * public pipeline. They run unchanged in the `dormant-geometry` project, whose setup
 * passes the internal opt-in `allowDormantSiteGeometry: true`
 * (test/dormant-geometry.setup.ts). Every other suite runs in the `core` project
 * against the production default, where non-rectangular sites are rejected.
 */
export const DORMANT_GEOMETRY_SUITES = [
  'src/accessibility.test.ts',
  'src/balcony.test.ts',
  'src/dxf/annotation-collisions.test.ts',
  'src/elevator-shaft.test.ts',
  'src/generator/l-shape-adjacency.test.ts',
  'src/generator/l-shape-balance.test.ts',
  'src/generator/l-shape-circulation-regression.test.ts',
  'src/generator/l-shape-entry-foyer.test.ts',
  'src/generator/l-shape-suite.test.ts',
  'src/generator/l-shape-wing-link.test.ts',
  'src/generator/l-shape.test.ts',
  'src/generator/spine-fallback-lshape.test.ts',
  'src/generator/stair-core-connector.test.ts',
  'src/layout/compaction-p17c.test.ts',
  'src/phase10.test.ts',
  'src/phase101.test.ts',
  'src/phase11.test.ts',
  'src/phase11_1.test.ts',
  'src/phase12.test.ts',
  'src/phase13.test.ts',
  'src/phase13_1.test.ts',
  'src/phase13_2.test.ts',
  'src/phase15_7.test.ts',
  'src/quality/metrics-v1-b2.test.ts',
  'src/quality/metrics-v1.test.ts',
  'src/quality/quality-integration.test.ts',
  'src/regression/golden-dxf.test.ts',
  'src/v101-regression.test.ts',
  'src/yard.test.ts',
];

const shared = { environment: 'node' as const, reporters: ['default'], testTimeout: 10_000 };

export default defineWorkspace([
  { test: { ...shared, name: 'core', include: ['src/**/*.test.ts'], exclude: [...configDefaults.exclude, ...DORMANT_GEOMETRY_SUITES] } },
  { test: { ...shared, name: 'dormant-geometry', include: DORMANT_GEOMETRY_SUITES, setupFiles: ['./test/dormant-geometry.setup.ts'] } },
]);
