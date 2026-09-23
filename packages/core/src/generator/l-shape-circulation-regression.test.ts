/**
 * P35 — L-shape feasibility regression tests (circulation ranking).
 *
 * Evidence base (Phase 34 read-only audit): the Phase 31 circulation-
 * preference connector twins pass the L-stage's own circulation proxy but
 * fail downstream hard rules (MBH4-DYL-001 daylight, CONSTRAINT_DIRECT_
 * ACCESS), and because the wing ladder always returned its best-ranked plan
 * the generator's generic region-planner fallback — which produced valid
 * plans on these sites — never ran. Four L stress cases flipped from
 * feasible to infeasible at commit 65749b8.
 *
 * Fix under test (l-shape.ts only): a conservative downstream mirror
 * (downstreamProxyOk — daylight eligibility, hard direct-access pairs,
 * real room×corridor overlaps, with sub-centimetre placement-rounding gaps
 * tolerated exactly as far as the compaction stage demonstrably closes
 * them) ranks the accepted plans and, when no plan passes, returns null so
 * the caller's fallback planner runs — the same path these sites took
 * before circulation-preference twins existed.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateLayout } from '../pipeline.js';
import { buildStressCases } from '../stress/matrix.js';

const RESTORED_CASE_IDS = [
  'L2--S0-1bd-open',
  'L2--S1-2bd',
  'L3--S1-2bd',
  'L6--S0-1bd-open',
] as const;

function stressCase(id: string) {
  const c = buildStressCases().find(c => c.id === id);
  if (!c) throw new Error(`stress case ${id} not found`);
  return c;
}

describe('P35: L-shape circulation ranking regression', () => {
  for (const id of RESTORED_CASE_IDS) {
    it(`${id}: feasible, zero hard findings, no daylight/direct-access regressions, deterministic`, () => {
      const c = stressCase(id);
      const r1 = generate(createProject(c.input));
      expect(r1.bestCandidate, `${id} must stay feasible`).toBeTruthy();
      const r2 = generate(createProject(c.input));
      const v = validateLayout(r1.bestCandidate!);
      expect(v.hard, `${id} must produce zero hard findings`).toHaveLength(0);
      const dylDa = v.hard.filter(f =>
        f.code === 'MBH4-DYL-001' || f.code === 'CONSTRAINT_DIRECT_ACCESS');
      expect(dylDa).toHaveLength(0);
      // deterministic geometry across runs (seed 42 stress matrix contract)
      const key = (r: typeof r1) => JSON.stringify(r.bestCandidate!.floors[0].spaces.map(s => [s.id, s.rect]));
      expect(key(r2)).toBe(key(r1));
    });
  }

  it('P25 18×22 NE flagship: feasible, zero hard findings, master suite stays on one wing', () => {
    const input = {
      name: 'P25 L',
      site: {
        shape: 'l-shape', width: 18, length: 22, accessSide: 'south', streetWidth: 8,
        lShape: { width: 18, length: 22, notchWidth: 7, notchLength: 9, notchCorner: 'ne' as const },
      },
      building: {
        type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
        kitchenType: 'closed', parkingSpaces: 1, hasStorage: false,
      },
      seed: 42,
    };
    const r = generate(createProject(input));
    expect(r.bestCandidate).toBeTruthy();
    const v = validateLayout(r.bestCandidate!);
    expect(v.hard).toHaveLength(0);
    const fl = r.bestCandidate!.floors[0];
    const mbr = fl.spaces.find(s => s.type === 'master-bedroom');
    const mbath = fl.spaces.find(s => s.type === 'master-bathroom');
    expect(mbr).toBeTruthy();
    expect(mbath).toBeTruthy();
    // same-wing suite (P33 tiebreak preserved): x-aligned pair sharing a
    // full-width wall — 5.5 m on this site
    expect(mbr!.rect.x).toBe(mbath!.rect.x);
    const xOver = Math.max(0, Math.min(mbr!.rect.x + mbr!.rect.w, mbath!.rect.x + mbath!.rect.w)
      - Math.max(mbr!.rect.x, mbath!.rect.x));
    const yOver = Math.max(0, Math.min(mbr!.rect.y + mbr!.rect.h, mbath!.rect.y + mbath!.rect.h)
      - Math.max(mbr!.rect.y, mbath!.rect.y));
    // stacked pair → shared wall = x-overlap on the touching y-edge; side-by-side → y-overlap
    const touchY = Math.abs(mbr!.rect.y + mbr!.rect.h - mbath!.rect.y) < 1e-6
      || Math.abs(mbath!.rect.y + mbath!.rect.h - mbr!.rect.y) < 1e-6;
    const touchX = Math.abs(mbr!.rect.x + mbr!.rect.w - mbath!.rect.x) < 1e-6
      || Math.abs(mbath!.rect.x + mbath!.rect.w - mbr!.rect.x) < 1e-6;
    const sharedWall = touchY ? xOver : touchX ? yOver : 0;
    expect(sharedWall).toBeGreaterThanOrEqual(5);
    // suite adjacency satisfied → the p-mb-mbath soft finding must stay absent
    expect(v.soft.some(f => (f.message ?? '').includes('p-mb-mbath'))).toBe(false);
  });
});
