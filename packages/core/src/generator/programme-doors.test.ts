/**
 * Phase 5.2 — opt-in programme door completion (openings stage 3b).
 *
 * Unit fixtures build real walls with generateWalls() and run placeOpenings()
 * twice — legacy call vs. opt-in call — so every "skip" / "rollback" case is
 * asserted as output IDENTICAL to the legacy path, not merely "no door".
 * Integration cases prove the pipeline default stays byte-identical (result
 * JSON and DXF) and the opt-in path is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { generateWalls } from './walls.js';
import { placeOpenings, programmeDoorRequirements } from './openings.js';
import type { ProgrammeDoorRequirement } from './openings.js';
import { generateLayouts } from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF, validateDXFStructure } from '../dxf/writer.js';
import { computeQualityMetricsV1 } from '../quality/metrics-v1.js';
import { validateLayout } from '../validation/validator.js';
import type { Floor } from '../model/floor.js';
import type { Space, PrivacyBand } from '../model/space.js';
import type { Opening } from '../model/opening.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function sp(id: string, type: string, privacy: PrivacyBand, x: number, y: number, w: number, h: number): Space {
  return {
    id, type, label: id, privacy, zone: privacy === 'service' ? 'circulation' : privacy,
    polygon: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
    rect: { x, y, w, h }, area: w * h, targetArea: w * h, minArea: 0,
    wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 1,
  } as unknown as Space;
}

/**
 * Ground floor without entrance/foyer: the corridors are the reachability seeds
 * (same seed rule as the Phase 25 repair). Spaces are cloned so runs are independent.
 */
function mkFloor(spaces: Space[], level = 0): Floor {
  const cloned = spaces.map(s => JSON.parse(JSON.stringify(s)) as Space);
  return {
    level, floorHeight: 3, elevation: 3 * level, footprint: { x: 0, y: 0, w: 10, h: 10 },
    spaces: cloned, walls: generateWalls(cloned, level), openings: [], stairs: [], elevators: [],
    furniture: [], parkingStalls: [],
  } as unknown as Floor;
}

const MB_MBA: ProgrammeDoorRequirement[] = [{ sourceType: 'master-bedroom', targetType: 'master-bathroom' }];

/**
 * Suite fixture: a horizontal corridor (y 0..1.2) under a master bedroom (x 0..4);
 * the "partner" room sits at x 4..4+pw, served by a vertical corridor on its east
 * side, so stage 2 gives BOTH rooms their own corridor door and the shared
 * MB | partner wall (x = 4, 4 m long) carries no door in the legacy output.
 */
function suite(opts: { pw?: number; partnerType?: string; partnerPrivacy?: PrivacyBand; partnerY0?: number } = {}): Space[] {
  const pw = opts.pw ?? 2.0;
  const y0 = opts.partnerY0 ?? 1.2;
  return [
    sp('c-h', 'corridor', 'service', 0, 0, 4 + pw + 1.2, 1.2),
    sp('mb', 'master-bedroom', 'private', 0, 1.2, 4, 4),
    sp('px', opts.partnerType ?? 'master-bathroom', opts.partnerPrivacy ?? 'private', 4, y0, pw, 5.2 - y0),
    sp('c-v', 'corridor', 'service', 4 + pw, 1.2, 1.2, 4),
  ];
}

function run(spaces: Space[], reqs?: ProgrammeDoorRequirement[], level = 0): { floor: Floor; openings: Opening[] } {
  const floor = mkFloor(spaces, level);
  const { openings } = reqs === undefined
    ? placeOpenings(floor, 'south')
    : placeOpenings(floor, 'south', { programmeDoorRequirements: reqs });
  floor.openings = openings;
  return { floor, openings };
}

const doors = (os: Opening[]) => os.filter(o => o.type !== 'window');
const joins = (os: Opening[], a: string, b: string) =>
  doors(os).filter(o => (o.spaceA === a && o.spaceB === b) || (o.spaceA === b && o.spaceB === a));
/** Legacy vs opt-in: openings AND wall opening lists must be identical. */
function expectIdentical(spaces: Space[], reqs: ProgrammeDoorRequirement[], level = 0) {
  const legacy = run(spaces, undefined, level);
  const opt = run(spaces, reqs, level);
  expect(opt.openings).toEqual(legacy.openings);
  expect(opt.floor.walls).toEqual(legacy.floor.walls);
  return { legacy, opt };
}

// ---------------------------------------------------------------------------
// programmeDoorRequirements — derived from the existing programme specs only
// ---------------------------------------------------------------------------

describe('Phase 5.2 programmeDoorRequirements (programme specs are the only source)', () => {
  it('keeps adjacent+doorRequired entries, drops same-type / non-door / non-adjacent, dedups and sorts', () => {
    const specs = [
      { type: 'kitchen', adjacencies: [{ spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true }, { spaceType: 'utility', adjacent: true, weight: 1 }] },
      { type: 'master-bedroom', adjacencies: [{ spaceType: 'master-bathroom', adjacent: true, weight: 3, doorRequired: true }, { spaceType: 'corridor', adjacent: true, weight: 3, doorRequired: true }] },
      { type: 'dining', adjacencies: [{ spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true }] },
      { type: 'dining', adjacencies: [{ spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true }] },
      { type: 'corridor', adjacencies: [{ spaceType: 'corridor', adjacent: true, weight: 3, doorRequired: true }] },
      { type: 'living', adjacencies: [{ spaceType: 'bedroom', adjacent: false, weight: 2, doorRequired: true }] },
      { type: 'foyer' },
    ] as any;
    expect(programmeDoorRequirements(specs)).toEqual([
      { sourceType: 'dining', targetType: 'kitchen' },
      { sourceType: 'master-bedroom', targetType: 'corridor' },
      { sourceType: 'master-bedroom', targetType: 'master-bathroom' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Stage 3b unit behaviour
// ---------------------------------------------------------------------------

describe('Phase 5.2 stage 3b — programme door completion (unit fixtures)', () => {
  it('legacy fixture really lacks the door (precondition)', () => {
    const { openings } = run(suite());
    expect(joins(openings, 'mb', 'c-h')).toHaveLength(1);
    expect(joins(openings, 'px', 'c-h').length + joins(openings, 'px', 'c-v').length).toBe(1);
    expect(joins(openings, 'mb', 'px')).toHaveLength(0);
  });

  it('adds exactly one direct door on the existing shared wall and never removes existing doors', () => {
    const legacy = run(suite());
    const opt = run(suite(), MB_MBA);
    const added = joins(opt.openings, 'mb', 'px');
    expect(added).toHaveLength(1);
    expect(doors(opt.openings)).toHaveLength(doors(legacy.openings).length + 1);
    // every legacy door survives unchanged (same id, wall and geometry)
    for (const d of doors(legacy.openings)) expect(opt.openings).toContainEqual(d);
    // the door sits on the MB|partner wall, is a bath-width door, swinging INTO the wet room
    const wall = opt.floor.walls.find(w => w.id === added[0].wallId)!;
    expect([...wall.spaceIds].sort()).toEqual(['mb', 'px']);
    expect(wall.openingIds).toContain(added[0].id);
    expect(added[0].width).toBeCloseTo(0.8, 9);
    expect(added[0].normal.x).toBeGreaterThan(0); // mb is west of px: into px = +x
  });

  it('skips when the requirement is already satisfied (partner reachable only via the bedroom)', () => {
    // No vertical corridor and a short horizontal corridor: stage 2 gives the
    // bathroom its primary door onto the master bedroom already.
    const spaces = [
      sp('c-h', 'corridor', 'service', 0, 0, 4, 1.2),
      sp('mb', 'master-bedroom', 'private', 0, 1.2, 4, 4),
      sp('px', 'master-bathroom', 'private', 4, 1.2, 2, 4),
    ];
    const { opt } = expectIdentical(spaces, MB_MBA);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(1);
  });

  it('skips when the shared wall is too short for a door', () => {
    // shared MB|partner segment is 0.8 m: bath door 0.8 + minimum margins does not fit
    const { opt } = expectIdentical(suite({ partnerY0: 4.4 }), MB_MBA);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0);
  });

  it('respects privacyTransitionAllowed (private → public is not a direct door)', () => {
    const { opt } = expectIdentical(suite({ partnerPrivacy: 'public' }), MB_MBA);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0);
  });

  it('never adds a door to an elevator hall (unsuitable space + shaftPairOk)', () => {
    const reqs: ProgrammeDoorRequirement[] = [
      { sourceType: 'master-bedroom', targetType: 'elevator-hall' },
      { sourceType: 'elevator-hall', targetType: 'master-bedroom' },
    ];
    // Same privacy band as the bedroom so privacyTransitionAllowed would PASS:
    // only the shaft guards (unsuitable elevator-hall + shaftPairOk) stop the door.
    const { opt } = expectIdentical(suite({ partnerType: 'elevator-hall', partnerPrivacy: 'private' }), reqs);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0);
    // the shaft keeps only its corridor landing door(s)
    for (const d of doors(opt.openings).filter(o => o.spaceA === 'px' || o.spaceB === 'px')) {
      const other = d.spaceA === 'px' ? d.spaceB : d.spaceA;
      expect(['c-h', 'c-v']).toContain(other);
    }
  });

  it('ignores same-type requirements', () => {
    const reqs: ProgrammeDoorRequirement[] = [{ sourceType: 'master-bedroom', targetType: 'master-bedroom' }];
    const { opt } = expectIdentical(suite({ partnerType: 'master-bedroom' }), reqs);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0);
  });

  it('rolls back completely when the new door swing clashes (0.6 m room < 0.8 m leaf)', () => {
    // Same topology as the success case, but the partner is only 0.6 m deep in
    // the swing direction: the leaf would cross the far wall and the corridor
    // door's swing → the door is removed, ids/occupancy restored, output identical.
    const { opt } = expectIdentical(suite({ pw: 0.6 }), MB_MBA);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0);
    // contrast: the identical topology with a 2 m partner does get the door
    expect(joins(run(suite({ pw: 2.0 }), MB_MBA).openings, 'mb', 'px')).toHaveLength(1);
  });

  // ---- Through-room guard (option-on side effect fix) ----
  // Exact topology of the reported side effect: the master bedroom has NO corridor
  // wall; the master bathroom opens to the corridor; a bedroom sits between.
  //   y 5.2..9.2 : master-bedroom (0..6)
  //   y 1.2..5.2 : bedroom (0..4) | master-bathroom (4..6)
  //   y 0..1.2   : corridor (0..8)
  const ENSUITE_CASE = [
    sp('c-h', 'corridor', 'service', 0, 0, 8, 1.2),
    sp('b', 'bedroom', 'private', 0, 1.2, 4, 4),
    sp('px', 'master-bathroom', 'private', 4, 1.2, 2, 4),
    sp('mb', 'master-bedroom', 'private', 0, 5.2, 6, 4),
  ];

  it('through-room guard: legacy precondition — bath opens to the corridor, repair reaches the master bedroom via the bedroom', () => {
    const { openings } = run(ENSUITE_CASE);
    expect(joins(openings, 'px', 'c-h')).toHaveLength(1);
    expect(joins(openings, 'mb', 'c-h')).toHaveLength(0);
    expect(joins(openings, 'mb', 'b')).toHaveLength(1); // Phase 25 repair door
    expect(joins(openings, 'mb', 'px')).toHaveLength(0);
  });

  it('through-room guard: never makes the master bathroom the passage between corridor and master bedroom', () => {
    const { opt } = expectIdentical(ENSUITE_CASE, MB_MBA);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0); // no corridor→bath→bedroom path created
    expect(joins(opt.openings, 'mb', 'b')).toHaveLength(1);  // later repair is NOT suppressed
    // the bathroom keeps exactly its one legacy door (it is not a through-room)
    expect(doors(opt.openings).filter(o => o.spaceA === 'px' || o.spaceB === 'px')).toHaveLength(1);
  });

  it('through-room guard: the same pair IS completed once the master bedroom has its own corridor access', () => {
    const reachable = [...ENSUITE_CASE.slice(0, 3), sp('mb', 'master-bedroom', 'private', 0, 5.2, 6, 4),
      sp('c-n', 'corridor', 'service', 0, 9.2, 8, 1.2), sp('c-e', 'corridor', 'service', 6, 1.2, 2, 8)];
    const legacy = run(reachable), opt = run(reachable, MB_MBA);
    expect(joins(legacy.openings, 'mb', 'px')).toHaveLength(0);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(1);
    for (const d of doors(legacy.openings)) expect(opt.openings).toContainEqual(d);
  });

  it('through-room guard: never joins two separate door-graph components', () => {
    // mb reaches corridor c-h, px reaches corridor c-v; the corridors do not touch.
    // A mb|px door would MERGE the two components (new reachability) → skipped.
    const split = [
      sp('c-h', 'corridor', 'service', 0, 0, 4, 1.2),
      sp('mb', 'master-bedroom', 'private', 0, 1.2, 4, 4),
      sp('px', 'master-bathroom', 'private', 4, 1.2, 2, 4),
      sp('c-v', 'corridor', 'service', 6, 1.2, 1.2, 4),
    ];
    const { opt } = expectIdentical(split, MB_MBA);
    expect(joins(opt.openings, 'mb', 'c-h')).toHaveLength(1);
    expect(joins(opt.openings, 'px', 'c-v')).toHaveLength(1);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(0);
  });

  it('through-room guard: upper floor whose rooms already share a component is still completed', () => {
    // level 1 (no entry seeds on this floor): both rooms reach the linked corridors
    const opt = run(suite(), MB_MBA, 1);
    expect(joins(opt.openings, 'mb', 'px')).toHaveLength(1);
  });

  it('empty requirement list is identical to the legacy call', () => {
    expectIdentical(suite(), []);
  });

  it('is deterministic', () => {
    const a = run(suite(), MB_MBA), b = run(suite(), MB_MBA);
    expect(a.openings).toEqual(b.openings);
    expect(a.floor.walls).toEqual(b.floor.walls);
  });
});

// ---------------------------------------------------------------------------
// Integration: pipeline default, determinism, DXF
// ---------------------------------------------------------------------------

const RECT = { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8, setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const INPUT: any = {
  site: RECT,
  building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 },
  seed: 42, deterministic: true, jurisdiction: 'IR',
};
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const mask = (k: string, v: unknown) =>
  (k === 'createdAt' || k === 'updatedAt' || k === 'generatedAt') ? 0
    : (typeof v === 'string' && /^prj-/.test(v) ? 'prj-X' : v);
const masked = (x: unknown) => JSON.stringify(x, mask);
const dxfsOf = (cands: any[]) => cands.map(c => writeDXF(c));

describe('Phase 5.2 integration — default OFF, byte-identical; opt-in deterministic', () => {
  it('generate(): option omitted === false (result JSON and every DXF byte-identical)', () => {
    const omitted = generate(createProject(INPUT), { allStrategies: true });
    const off = generate(createProject(INPUT), { allStrategies: true, programmeDoorCompletion: false });
    expect(masked(off)).toBe(masked(omitted));
    expect(dxfsOf(off.project.candidates)).toEqual(dxfsOf(omitted.project.candidates));
  });

  it('generateLayouts(): omitted === {} === { programmeDoorCompletion: false }', () => {
    const a = generateLayouts(INPUT, [...STRATS]);
    const b = generateLayouts(INPUT, [...STRATS], {});
    const c = generateLayouts(INPUT, [...STRATS], { programmeDoorCompletion: false });
    expect(masked(b)).toBe(masked(a));
    expect(masked(c)).toBe(masked(a));
    expect(dxfsOf(c)).toEqual(dxfsOf(a));
  });

  it('opt-in output is deterministic (result JSON and DXF)', () => {
    const x = generate(createProject(INPUT), { allStrategies: true, programmeDoorCompletion: true });
    const y = generate(createProject(INPUT), { allStrategies: true, programmeDoorCompletion: true });
    expect(masked(y)).toBe(masked(x));
    expect(dxfsOf(y.project.candidates)).toEqual(dxfsOf(x.project.candidates));
  });

  it('opt-in adds programme doors without touching room geometry, new HARD findings or DXF structure', () => {
    const off = generateLayouts(INPUT, [...STRATS]);
    const on = generateLayouts(INPUT, [...STRATS], { programmeDoorCompletion: true });
    let gained = 0;
    for (const st of STRATS) {
      const a = off.find(c => c.metadata.strategy === st)!, c = on.find(x => x.metadata.strategy === st)!;
      // room geometry is unchanged; only openings may differ
      expect(JSON.stringify(c.floors.map(f => f.spaces.map(s => [s.id, s.rect]))))
        .toBe(JSON.stringify(a.floors.map(f => f.spaces.map(s => [s.id, s.rect]))));
      const qa = computeQualityMetricsV1(a, INPUT), qc = computeQualityMetricsV1(c, INPUT);
      qa.floors.forEach((fa, i) => {
        const ia = fa.adjacency.instances, ic = qc.floors[i].adjacency.instances;
        ia.forEach((inst, j) => {
          if (inst.doorSatisfied === true) expect(ic[j].doorSatisfied).toBe(true); // never worse
          if (inst.doorSatisfied === false && ic[j].doorSatisfied === true) gained++;
        });
      });
      const hard = (cand: any) => validateLayout(cand).findings.filter(f => f.severity === 'hard').length;
      expect(hard(c)).toBeLessThanOrEqual(hard(a));
      const dxf = writeDXF(c);
      expect(validateDXFStructure(dxf).ok).toBe(true);
      expect(dxf.length).toBeGreaterThan(1000);
      // frozen header profile: $ACADVER = AC1009 is the only header variable
      const header = dxf.slice(0, dxf.indexOf('ENDSEC'));
      expect(header.match(/\$[A-Z]+/g)).toEqual(['$ACADVER']);
      expect(header).toContain('AC1009');
    }
    expect(gained).toBeGreaterThan(0);
  });

  it('through-room regression (14×22, 3 floors + lift): opt-in removes no legacy door and adds no through-room finding', () => {
    for (const seed of [42, 7]) {
      const input: any = { ...INPUT, seed, site: { ...RECT, width: 14, length: 22 },
        building: { ...INPUT.building, bedrooms: 3, hasElevator: true, floors: 3 } };
      const off = generateLayouts(input, [...STRATS]);
      const on = generateLayouts(input, [...STRATS], { programmeDoorCompletion: true });
      const pairKey = (o: Opening) => [o.spaceA, o.spaceB].sort().join('|');
      for (const st of STRATS) {
        const a = off.find(c => c.metadata.strategy === st)!, c = on.find(x => x.metadata.strategy === st)!;
        a.floors.forEach((fa, i) => {
          const onPairs = new Set(doors(c.floors[i].openings).map(pairKey));
          for (const d of doors(fa.openings)) expect(onPairs.has(pairKey(d))).toBe(true);
        });
        const through = (cand: any) => validateLayout(cand).findings.filter(f => f.code === 'CIRC_ROOM_THROUGH_ROOM').length;
        expect(through(c)).toBeLessThanOrEqual(through(a));
        const hardCodes = (cand: any) => validateLayout(cand).findings.filter(f => f.severity === 'hard').map(f => f.code).sort();
        expect(hardCodes(c)).toEqual(hardCodes(a));
      }
    }
  });
});
