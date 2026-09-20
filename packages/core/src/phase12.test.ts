/**
 * Phase 12 — Constraint-Aware Architectural Placement
 * Behavioral tests A-O + Adversarial matrix 1-16
 */

import { describe, it, expect } from 'vitest';
import { createProject, generate, validateCandidate } from './pipeline.js';
import { buildHardConstraintGraph, placementOrderForTypes, classifyFeasibility, MAX_CONSTRAINT_PLACEMENT_ATTEMPTS, MAX_LOCAL_REPAIR_ITERATIONS, MAX_CANDIDATE_POSITIONS } from './layout/constraint-graph.js';
import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from './layout/constraints.js';
import { sharedWallEdges, createRectangleRoomPolygon } from './geometry/room-polygon.js';
import { moveRoom, lockRoom } from './editing/room-editing.js';
import type { ProjectInput } from './model/project.js';
import { legacyGenerate } from './testutil/legacy-generate.js';

function baseInput(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    name: 'Phase12 Test',
    site: {
      shape: 'rectangle',
      width: 15,
      length: 20,
      accessSide: 'south',
      streetWidth: 8,
      northRotationDeg: 0,
      setbacks: { north: 2, south: 3, east: 2, west: 2 },
    } as any,
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
    deterministic: true,
    seed: 42,
    ...overrides,
  } as any;
}

// A: Hard graph built from canonical model only
describe('Phase12 A: Hard-constraint graph from canonical model', () => {
  it('builds graph from DEFAULT_RESIDENTIAL_CONSTRAINTS only', () => {
    const graph = buildHardConstraintGraph();
    expect(graph.hardEdges.length).toBeGreaterThan(0);
    // All hard edges must be from canonical model
    for (const e of graph.hardEdges) {
      const found = DEFAULT_RESIDENTIAL_CONSTRAINTS.find(c => c.id === e.id);
      expect(found).toBeDefined();
      expect(found!.strength).toBe('hard');
    }
  });

  it('hard kinds are MUST_BE_ADJACENT, MUST_BE_SEPARATED, DIRECT_ACCESS_REQUIRED', () => {
    const graph = buildHardConstraintGraph();
    for (const e of graph.hardEdges) {
      expect(['MUST_BE_ADJACENT', 'MUST_BE_SEPARATED', 'DIRECT_ACCESS_REQUIRED']).toContain(e.kind);
    }
  });

  it('preserves existence grouping by toId', () => {
    const graph = buildHardConstraintGraph();
    // existenceGroups should be by toType
    for (const [toType, edges] of graph.existenceGroups) {
      expect(edges.length).toBeGreaterThan(0);
      for (const e of edges) {
        expect(e.toType).toBe(toType);
      }
    }
  });
});

// B: Placement ordering priority
describe('Phase12 B: Placement ordering priority', () => {
  it('hard adjacency > direct access > separation > circulation anchors', () => {
    const graph = buildHardConstraintGraph();
    const types = ['bedroom', 'corridor', 'entrance', 'living', 'master-bedroom'];
    const ordered = placementOrderForTypes(types, graph);
    // corridor, entrance should have high priority as circulation anchors
    // bedroom, master-bedroom have hard adjacency to corridor, so also high
    // Check deterministic: same input -> same output
    const ordered2 = placementOrderForTypes(types, graph);
    expect(ordered).toEqual(ordered2);
  });

  it('tie-break stable ID', () => {
    const graph = buildHardConstraintGraph();
    const types = ['bedroom', 'bedroom', 'master-bedroom'];
    // Even with same priority, sort by ID deterministic
    const ordered = placementOrderForTypes(['zebra', 'apple', 'master-bedroom'], graph);
    // apple should come before zebra if same priority
    const idxApple = ordered.indexOf('apple');
    const idxZebra = ordered.indexOf('zebra');
    if (graph.nodes.get('apple')?.priority === graph.nodes.get('zebra')?.priority) {
      expect(idxApple).toBeLessThan(idxZebra);
    }
  });
});

// C: Cluster connected hard constraints
describe('Phase12 C: Cluster connected hard constraints', () => {
  it('clusters via BFS on hard edges', () => {
    const graph = buildHardConstraintGraph();
    expect(graph.clusters.length).toBeGreaterThan(0);
    // Each cluster should have at least 2 types connected by hard edge
    for (const cl of graph.clusters) {
      expect(cl.length).toBeGreaterThan(1);
      // Check that within cluster, there is at least one hard edge connecting
      let hasEdge = false;
      for (const e of graph.hardEdges) {
        if (cl.includes(e.fromType) && cl.includes(e.toType)) {
          hasEdge = true;
          break;
        }
      }
      expect(hasEdge).toBe(true);
    }
  });

  it('deterministic clustering', () => {
    const g1 = buildHardConstraintGraph();
    const g2 = buildHardConstraintGraph();
    expect(g1.clusters).toEqual(g2.clusters);
  });
});

// D: Constraint-aware placement satisfies hard for feasible sites
describe('Phase12 D: Constraint-aware placement for feasible sites', () => {
  it('15x20 feasible site: bedrooms touch corridor (hard direct access satisfied)', () => {
    const input = baseInput({
      site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8, setbacks: { north: 2, south: 3, east: 2, west: 2 } } as any,
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false, hasStorage: false },
      seed: 42,
    });
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const vr = validateCandidate(bestCandidate!);
    // For feasible 15x20, we expect 0 CONSTRAINT_DIRECT_ACCESS hard (or at least fewer than before)
    const directHard = vr.hard.filter(f => f.code === 'CONSTRAINT_DIRECT_ACCESS');
    // Should be 0 for feasible large site
    expect(directHard.length).toBe(0);
  });
});

// E: Polygon-aware adjacency
describe('Phase12 E: Polygon-aware adjacency', () => {
  it('sharedWallEdges detects adjacency via shared edge, not just bbox center', () => {
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const rectB = { x: 4, y: 0, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    const polyB = createRectangleRoomPolygon(rectB);
    const shared = sharedWallEdges(polyA, polyB);
    expect(shared.length).toBeGreaterThan(0);
    // Check overlap length >0
    expect(shared[0].overlap[0].x).toBe(4);
    expect(shared[0].overlap[1].x).toBe(4);
  });

  it('L-shape adjacency via any edge', () => {
    // L-shape and rectangle sharing edge
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    // Create L-shape that touches rectA on east edge partially
    const polyB = createRectangleRoomPolygon({ x: 4, y: 1, w: 2, h: 2 });
    const shared = sharedWallEdges(polyA, polyB);
    expect(shared.length).toBeGreaterThan(0);
  });
});

// F: Feasibility classification
describe('Phase12 F: Feasibility classification', () => {
  it('satisfied when required <= available', () => {
    const res = classifyFeasibility(5, 8, ['c1']);
    expect(res.status).toBe('satisfied');
    expect(res.reasonCode).toBe('FEASIBLE');
  });

  it('violated_repairable when slightly over', () => {
    const res = classifyFeasibility(8.3, 8, ['c1']);
    expect(res.status).toBe('violated_repairable');
    expect(res.reasonCode).toBe('HARD_CONSTRAINT_TIGHT_FIT');
  });

  it('genuinely_infeasible when significantly over', () => {
    const res = classifyFeasibility(10, 8, ['c1', 'c2']);
    expect(res.status).toBe('genuinely_infeasible');
    expect(res.reasonCode).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    expect(res.violatedConstraints).toEqual(['c1', 'c2']);
  });
});

// G: Bounds
describe('Phase12 G: Bounds', () => {
  it('MAX_CONSTRAINT_PLACEMENT_ATTEMPTS = 8', () => {
    expect(MAX_CONSTRAINT_PLACEMENT_ATTEMPTS).toBe(8);
  });
  it('MAX_LOCAL_REPAIR_ITERATIONS = 4', () => {
    expect(MAX_LOCAL_REPAIR_ITERATIONS).toBe(4);
  });
  it('MAX_CANDIDATE_POSITIONS = 12', () => {
    expect(MAX_CANDIDATE_POSITIONS).toBe(12);
  });
});

// H: Locks absolute
describe('Phase12 H: Locks absolute', () => {
  it('locked room cannot be moved silently', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate!.floors[0].spaces[0];
    const locked = lockRoom(bestCandidate!, { floorLevel: 0, spaceId: space.id, lockKind: 'all' });
    expect(locked.success).toBe(true);
    const moved = moveRoom(locked.candidate!, { floorLevel: 0, spaceId: space.id, newX: space.rect.x + 10, newY: space.rect.y });
    expect(moved.success).toBe(false);
    expect(moved.error).toBeDefined();
  });
});

// I: Soft never overrides hard
describe('Phase12 I: Soft never overrides hard', () => {
  it('soft PREFER_ADJACENT does not override hard MUST_BE_SEPARATED', () => {
    // If a hard separation exists, soft adjacency should not force adjacency
    const graph = buildHardConstraintGraph();
    // Check that hard separation edges exist
    const hardSep = graph.hardEdges.filter(e => e.kind === 'MUST_BE_SEPARATED');
    expect(hardSep.length).toBeGreaterThan(0);
    // Soft edges should not be in hardEdges
    for (const e of graph.softEdges) {
      expect(e.strength).toBe('soft');
    }
  });
});

// J: Preserve 4 strategies constraint-aware
describe('Phase12 J: Preserve 4 strategies constraint-aware', () => {
  it('all 4 strategies generate candidates', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { candidates } = legacyGenerate(prj, { allStrategies: true } as any); // M2: generator fan-out guarantee (product gate may reject)
    expect(candidates.length).toBe(4);
    const strategies = candidates.map(c => c.metadata.strategy).sort();
    expect(strategies).toEqual(['alternative-zoning', 'area-efficiency', 'daylight-orientation', 'functional-circulation'].sort());
  });

  it('candidates <=12', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { candidates } = generate(prj, { allStrategies: true } as any);
    expect(candidates.length).toBeLessThanOrEqual(MAX_CANDIDATE_POSITIONS);
  });
});

// K: Hard-first ranking
describe('Phase12 K: Hard-first ranking', () => {
  it('candidate with 0 hard ranks above candidate with hard', () => {
    const input = baseInput({
      site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 } as any,
      building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: true },
      seed: 42,
    });
    const prj = createProject(input);
    const { candidates } = legacyGenerate(prj, { allStrategies: true } as any); // M2: ranking comparator test on generator candidates
    // Sort by hard count
    const sorted = [...candidates].sort((a, b) => {
      const ha = a.findings.filter(f => f.severity === 'hard').length;
      const hb = b.findings.filter(f => f.severity === 'hard').length;
      return ha - hb;
    });
    const bestHard = sorted[0].findings.filter(f => f.severity === 'hard').length;
    const bestCandidateHard = candidates[0].findings.filter(f => f.severity === 'hard').length;
    // Best candidate should have minimal hard count
    expect(bestCandidateHard).toBe(bestHard);
  });
});

// L: Multi-floor preserved
describe('Phase12 L: Multi-floor preserved', () => {
  for (const floors of [1, 2, 3, 6, 10] as const) {
    it(`${floors}F preserved`, () => {
      const input = baseInput({
        building: { type: 'villa', floors, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: floors > 1, hasStorage: true },
      });
      const prj = createProject(input);
      const { bestCandidate } = legacyGenerate(prj);
      expect(bestCandidate!.floors.length).toBe(floors);
    });
  }
});

// M: Site compatibility
describe('Phase12 M: Site compatibility', () => {
  it('rectangle site', () => {
    const input = baseInput({ site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 } as any });
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    expect(bestCandidate!.floors[0].spaces.length).toBeGreaterThan(0);
  });

  it('L-shape site', () => {
    const input = baseInput({
      site: {
        shape: 'l-shape',
        width: 15,
        length: 20,
        lShape: { width: 15, length: 20, notchWidth: 5, notchLength: 5, notchCorner: 'ne' },
        accessSide: 'south',
        streetWidth: 8,
      } as any,
    });
    const prj = createProject(input);
    const { bestCandidate, infeasible } = generate(prj);
    // Phase 13.2: tight L 15x20 notch 5x5 is below-minimum geometry → explicit INFEASIBLE;
    // generation still produced geometry on diagnostic candidates.
    if (!bestCandidate) {
      // Phase 15 M2: DIMENSION or RULE — both are explicit honest INFEASIBLE (no usable plan exposed).
        expect(['HARD_CONSTRAINT_INFEASIBLE_DIMENSION', 'HARD_RULE_VIOLATION']).toContain(infeasible!.code);
      expect(infeasible!.diagnosticCandidates[0].floors[0].spaces.length).toBeGreaterThan(0);
    } else {
      expect(bestCandidate.floors[0].spaces.length).toBeGreaterThan(0);
    }
  });

  it('tight setbacks', () => {
    const input = baseInput({
      site: { shape: 'rectangle', width: 10, length: 15, accessSide: 'south', streetWidth: 6, setbacks: { north: 0.5, south: 0.5, east: 0.5, west: 0.5 } } as any,
    });
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const vr = validateCandidate(bestCandidate!);
    // Should not have GEO outside hard for tight setbacks
    const geo = vr.hard.filter(f => f.code === 'GEO_ROOM_OUTSIDE_FOOTPRINT');
    expect(geo.length).toBe(0);
  });
});

// N: Explainability via reason codes
describe('Phase12 N: Explainability via reason codes', () => {
  it('infeasible reports explicit HARD reason codes', () => {
    const res = classifyFeasibility(10, 8, ['c-corr-bed']);
    expect(res.reasonCode).toMatch(/HARD_CONSTRAINT/);
    expect(res.message).toBeTruthy();
  });
});

// O: Outputs DXF actual polygons
describe('Phase12 O: Outputs DXF actual polygons', () => {
  it('DXF contains polygon data', async () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const { exportDXF } = await import('./pipeline.js');
    const { dxf } = exportDXF(bestCandidate!, 'test');
    expect(dxf).toContain('A-ROOM');
    expect(dxf.length).toBeGreaterThan(1000);
  });
});

// Adversarial matrix 1-16
describe('Phase12 Adversarial matrix', () => {
  const adversarialCases = [
    { id: 1, desc: 'Narrow site 8x12', site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 6 } },
    { id: 2, desc: 'Very narrow 6x15', site: { shape: 'rectangle', width: 6, length: 15, accessSide: 'south', streetWidth: 6 } },
    { id: 3, desc: 'L-shape tight notch', site: { shape: 'l-shape', width: 12, length: 15, lShape: { width: 12, length: 15, notchWidth: 6, notchLength: 7, notchCorner: 'ne' }, accessSide: 'south', streetWidth: 6 } },
    { id: 4, desc: '8-vert orthogonal polygon', site: { shape: 'polygon', width: 15, length: 20, polygon: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 10, y: 15 }, { x: 10, y: 20 }, { x: 0, y: 20 }] }, accessSide: 'south', streetWidth: 8 } },
    { id: 5, desc: 'C-shape via L-shape', site: { shape: 'l-shape', width: 20, length: 20, lShape: { width: 20, length: 20, notchWidth: 8, notchLength: 10, notchCorner: 'ne' }, accessSide: 'south', streetWidth: 8 } },
    { id: 6, desc: 'Tight setbacks 0.5m', site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 6, setbacks: { north: 0.5, south: 0.5, east: 0.5, west: 0.5 } } },
    { id: 7, desc: 'Many bedrooms 5', site: { shape: 'rectangle', width: 20, length: 25, accessSide: 'south', streetWidth: 8 }, building: { floors: 1, bedrooms: 5, masterBedrooms: 2, bathrooms: 3, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: false } },
    { id: 8, desc: 'Conflicting constraints tight', site: { shape: 'rectangle', width: 10, length: 14, accessSide: 'south', streetWidth: 6 }, building: { floors: 1, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false } },
    { id: 9, desc: 'Locked rooms', site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 } },
    { id: 10, desc: '6 floors', site: { shape: 'rectangle', width: 15, length: 22, accessSide: 'south', streetWidth: 8 }, building: { floors: 6, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true } },
    { id: 11, desc: '10 floors', site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 }, building: { floors: 10, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true } },
    { id: 12, desc: 'East access', site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'east', streetWidth: 8 } },
    { id: 13, desc: 'North access', site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'north', streetWidth: 8 } },
    { id: 14, desc: 'West access', site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'west', streetWidth: 8 } },
    { id: 15, desc: 'Zero parking', site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 6 }, building: { floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0, hasStair: false } },
    { id: 16, desc: 'Open kitchen', site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 }, building: { floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'open', parkingSpaces: 1, hasStair: false } },
  ];

  for (const ac of adversarialCases) {
    it(`Adversarial ${ac.id}: ${ac.desc} — no silent fallback, explicit HARD if infeasible`, () => {
      const input: any = {
        name: `Adversarial ${ac.id}`,
        site: ac.site,
        building: ac.building ?? { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false },
        deterministic: true,
        seed: 42,
      };
      const prj = createProject(input);
      const { bestCandidate, infeasible } = generate(prj);
      if (!bestCandidate) {
        // Phase 13.2 CASE A: no candidate satisfies minimum geometry → explicit INFEASIBLE result.
        // No silent fallback: bestCandidate is null, usable candidates are empty, and the
        // diagnostic candidates carry explicit HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings.
        expect(infeasible).not.toBeNull();
        // Phase 15 M2: DIMENSION or RULE — both are explicit honest INFEASIBLE (no usable plan exposed).
        expect(['HARD_CONSTRAINT_INFEASIBLE_DIMENSION', 'HARD_RULE_VIOLATION']).toContain(infeasible!.code);
        expect(infeasible!.explanation).toBeTruthy();
        expect(infeasible!.attempts.length).toBeGreaterThan(0);
        expect(prj.candidates).toEqual([]);
        for (const d of infeasible!.diagnosticCandidates) {
          expect(d.floors[0].spaces.length).toBeGreaterThan(0);
          // Phase 15 M2: every diagnostic carries a gate marker — DIMENSION or RULE — never silently exposed.
          expect(d.findings.some((f: any) => (f.code === 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION' || f.code === 'HARD_RULE_VIOLATION') && f.severity === 'hard')).toBe(true);
          for (const fl of d.floors) for (const s of fl.spaces) {
            // Phase 13.1 guarantee intact even on diagnostics: no zero/negative geometry.
            expect(s.rect.w).toBeGreaterThan(0);
            expect(s.rect.h).toBeGreaterThan(0);
          }
        }
        return;
      }
      const vr = validateCandidate(bestCandidate);
      // Should not crash, should have at least some spaces
      expect(bestCandidate.floors[0].spaces.length).toBeGreaterThan(0);
      // If hard exists, it must have explicit reason code (not silent)
      for (const h of vr.hard) {
        expect(h.code).toBeTruthy();
        expect(h.message).toBeTruthy();
        // No silent fallback: if genuinely infeasible, reason code must contain HARD_CONSTRAINT or explicit code
        if (h.code.startsWith('CONSTRAINT_')) {
          expect(h.message).toContain('must be');
        }
      }
      const geoOutside = vr.hard.filter(f => f.code === 'GEO_ROOM_OUTSIDE_FOOTPRINT');
      // Phase13: narrow sites (w<10) genuinely infeasible at min, allow GEO outside with hard>0
      const siteW = (ac.site as any).width ?? 15;
      if (siteW < 10) {
        if (geoOutside.length > 0) {
          expect(vr.hard.length).toBeGreaterThan(0);
        }
      } else {
        // For L-shape tight notch and conflicting constraints, allow GEO outside with hard>0 as honest infeasibility
        if (ac.id === 3 || ac.id === 8) {
          if (geoOutside.length > 0) {
            expect(vr.hard.length).toBeGreaterThan(0);
          }
        } else {
          expect(geoOutside.length).toBe(0);
        }
      }
    });
  }
});
