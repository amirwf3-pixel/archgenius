/**
 * Phase 33-P3 — master-suite adjacency regression test.
 *
 * Evidence base (Phase 32 read-only audit, HEAD 65749b8): the L-shape variant
 * ladder always overflowed the (smaller) master-bathroom to the day wing
 * before the bedroom, so the same-wing suite was inexpressible and the split
 * plan won by ladder order alone — on an EXACT tie of the wing-plan metrics
 * (imbalance 17.25 / residual 17.25, both dim-contract-ok and circulation-ok).
 *
 * The fix adds the suite-preserving variant (bedroom overflows to the day
 * wing, master suite stays together in the far wing, connector twin included)
 * and a deterministic tiebreak that, only on an exact tie of every existing
 * selection metric, prefers the plan satisfying the existing soft p-mb-mbath
 * adjacency constraint.
 *
 * Measured on the fix (deterministic, seed 42): master-bedroom and
 * master-bathroom share a full 5.5 m wall in the far wing, both corridors are
 * circulation-reachable, hard findings 0, and the p-mb-mbath soft finding is
 * gone (soft findings 6 → 3).
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateLayout } from '../pipeline.js';
import type { ProjectInput } from '../model/project.js';

function lInput(): ProjectInput {
  return {
    name: 'P25 L',
    site: {
      shape: 'l-shape', width: 18, length: 22, accessSide: 'south', streetWidth: 8,
      lShape: { width: 18, length: 22, notchWidth: 7, notchLength: 9, notchCorner: 'ne' },
    },
    building: {
      type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
      kitchenType: 'closed', parkingSpaces: 1, hasStorage: false,
    },
    seed: 42,
  };
}

/** Shared-edge length between two axis-aligned rects (0 when separated). */
function sharedEdge(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (xOv < -1e-9 || yOv < -1e-9) return 0;
  if (Math.abs(a.y + a.h - b.y) < 1e-6 || Math.abs(b.y + b.h - a.y) < 1e-6) return Math.max(0, xOv);
  if (Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6) return Math.max(0, yOv);
  return 0;
}

describe('P33-P3: master suite stays in one wing (L-NE-18x22)', () => {
  it('selects the suite-together far-wing plan on the exact metric tie', () => {
    const { bestCandidate } = generate(createProject(lInput()));
    expect(bestCandidate).toBeTruthy();
    const fl = bestCandidate!.floors[0];
    const v = validateLayout(bestCandidate!);
    expect(v.hard).toEqual([]);

    const mbr = fl.spaces.find(s => s.type === 'master-bedroom');
    const mbath = fl.spaces.find(s => s.type === 'master-bathroom');
    expect(mbr).toBeTruthy();
    expect(mbath).toBeTruthy();
    // same wing: same far-wing column, full shared wall (the ensuite adjacency
    // the soft p-mb-mbath constraint asks for)
    expect(mbr!.rect.x).toBeCloseTo(mbath!.rect.x, 6);
    expect(sharedEdge(mbr!.rect, mbath!.rect)).toBeGreaterThanOrEqual(1.0);
    // the suite must not sit in the day wing: it lives east of the bridge strip
    expect(mbr!.rect.x).toBeGreaterThanOrEqual(9);

    // the existing soft p-mb-mbath finding must be satisfied (absent)
    expect(v.soft.some(f => f.code === 'CONSTRAINT_PREFER_ADJACENT' && (f.message ?? '').includes('p-mb-mbath'))).toBe(false);
  });

  it('keeps circulation fully reachable with the suite plan selected', () => {
    const { bestCandidate } = generate(createProject(lInput()));
    const fl = bestCandidate!.floors[0];
    const CIRC = new Set(['corridor', 'entrance', 'foyer', 'stair-hall']);
    const doors = fl.openings.filter(o => o.type === 'door' || o.type === 'entrance');
    const adj = new Map<string, string[]>();
    for (const o of doors) {
      for (const [a, b] of [[o.spaceA, o.spaceB], [o.spaceB, o.spaceA]] as const) {
        if (a && b) adj.set(a, [...(adj.get(a) ?? []), b]);
      }
    }
    const seeds = fl.spaces.filter(s => s.type === 'entrance' || s.type === 'foyer').map(s => s.id);
    const seen = new Set(seeds);
    const q = [...seeds];
    while (q.length) {
      const cur = q.shift()!;
      for (const n of (adj.get(cur) ?? [])) {
        if (seen.has(n)) continue;
        if (!CIRC.has(fl.spaces.find(s => s.id === n)?.type)) continue;
        seen.add(n);
        q.push(n);
      }
    }
    // both corridors (bridge + corridor-link) reachable without leaving circulation
    for (const c of fl.spaces.filter(s => s.type === 'corridor')) {
      expect(seen.has(c.id), `${c.id} circulation-reachable`).toBe(true);
    }
    // master suite reachable through circulation (0 habitable rooms crossed)
    for (const rm of fl.spaces.filter(s => s.type === 'master-bedroom' || s.type === 'master-bathroom')) {
      const doorPartners = (adj.get(rm.id) ?? []).map(id => fl.spaces.find(s => s.id === id)?.type);
      expect(doorPartners.some(t => t && CIRC.has(t)), `${rm.id} opens to circulation`).toBe(true);
    }
  });

  it('keeps the suite furnished and the plan deterministic', () => {
    const r1 = generate(createProject(lInput()));
    const r2 = generate(createProject(lInput()));
    const fl1 = r1.bestCandidate!.floors[0];
    const fl2 = r2.bestCandidate!.floors[0];
    const plan1 = JSON.stringify(fl1.spaces.map(s => [s.id, s.rect]));
    const plan2 = JSON.stringify(fl2.spaces.map(s => [s.id, s.rect]));
    expect(plan1).toBe(plan2);

    const mbr = fl1.spaces.find(s => s.type === 'master-bedroom')!;
    const mbath = fl1.spaces.find(s => s.type === 'master-bathroom')!;
    expect(fl1.furniture.some(f => f.spaceId === mbr.id && f.type.startsWith('bed-'))).toBe(true);
    expect(fl1.furniture.some(f => f.spaceId === mbath.id && f.type === 'toilet')).toBe(true);
  });
});
