/**
 * Dormant-geometry test project setup (V1 scope, see src/site/v1-scope.ts).
 *
 * ArchGenius V1 production planning is Rectangle-only: createProject() / generate()
 * reject L-shape and polygon sites with UNSUPPORTED_SITE_GEOMETRY. The L-shape / polygon
 * planner is kept DORMANT for a future phase, and its existing regression suites (listed
 * in vitest.workspace.ts) keep running UNCHANGED against it: in this project only, the
 * pipeline entry points are called with the internal opt-in
 * `allowDormantSiteGeometry: true`. Nothing else is altered — rectangle inputs are
 * unaffected by the flag, and the production default (rejection) is covered by the
 * regular `core` project.
 */
import { vi } from 'vitest';

vi.mock('../src/pipeline.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pipeline.ts')>();
  return {
    ...actual,
    createProject: (input: Parameters<typeof actual.createProject>[0], opts: Parameters<typeof actual.createProject>[1] = {}) =>
      actual.createProject(input, { ...opts, allowDormantSiteGeometry: true }),
    generate: (project: Parameters<typeof actual.generate>[0], opts: Parameters<typeof actual.generate>[1] = {}) =>
      actual.generate(project, { ...opts, allowDormantSiteGeometry: true }),
  };
});
