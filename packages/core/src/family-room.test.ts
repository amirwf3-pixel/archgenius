/**
 * Task 160/161 — bounded family-room placement (`building.hasFamilyRoom === true`).
 *
 * Root cause (Task 159): on an upper floor the family room is the public band's only
 * room, and splitBinary handed it the WHOLE band (~80–250 m² for a 12 m² program).
 * Fix: the Task 152 bounded host-edge placement now also sizes a family room from its
 * own program (target 12 m², min 8 m², minWidth 2.6 m); FAMILY_ROOM_OVERSIZED (HARD)
 * enforces the existing M4 cap max(1.1·min, 1.75·target) = 21 m².
 *
 * Accepted consequence (Task 161 decision): candidates that were ALREADY HARD-invalid may
 * report different HARD findings (the oversized room was hiding disconnected upper-floor
 * circulation). Candidates that were HARD-free must stay HARD-free — pinned below.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createProject, generate, generateLayouts, exportDXF, validateCandidate, validateLayout } from './pipeline.js';
import { buildStressCases } from './stress/matrix.js';
import { getTypicalArea } from './programming/program.js';
import { validateFamilyRooms } from './validation/family-room.js';
import { balconyAreaCap } from './validation/balcony.js';
import type { ProjectInput } from './model/project.js';
import type { LayoutCandidate } from './model/layout.js';

const STRATEGIES = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const sb = (n: number, s: number, e: number, w: number) => ({ setbackNorth: n, setbackSouth: s, setbackEast: e, setbackWest: w });
const R = (w: number, l: number, accessSide = 'south', set = sb(2, 3, 2, 2)) => ({ shape: 'rectangle', width: w, length: l, accessSide, streetWidth: 8, ...set });
const villa = (o: Record<string, unknown>) => ({ type: 'villa', masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', hasElevator: false, hasStorage: true, ...o });
const mk = (site: any, building: any, fam: boolean | undefined): ProjectInput => {
  const b: any = { ...building };
  if (fam !== undefined) b.hasFamilyRoom = fam;
  return { name: 'fam-t160', site, building: b, deterministic: true, seed: 42 } as unknown as ProjectInput;
};

const CASES: Record<string, [any, any]> = {
  'rect-2F-18x28': [R(18, 28), villa({ floors: 2, bedrooms: 3, parkingSpaces: 2, hasStair: true })],
  'rect-2F-22x32': [R(22, 32), villa({ floors: 2, bedrooms: 4, parkingSpaces: 2, hasStair: true })],
  'rect-3F-18x28': [R(18, 28), villa({ floors: 3, bedrooms: 3, parkingSpaces: 1, hasStair: true })],
  'rect-3F-20x30': [R(20, 30), villa({ floors: 3, bedrooms: 4, parkingSpaces: 2, hasStair: true })],
  'narrow-2F-13x30': [R(13, 30, 'south', sb(3, 1.5, 1.5, 1.5)), villa({ floors: 2, bedrooms: 2, bathrooms: 1, parkingSpaces: 1, hasStair: true })],
  'dec-2F-17.5x28.3-S': [R(17.5, 28.3, 'south', sb(2.25, 1.75, 1.5, 2.6)), villa({ floors: 2, bedrooms: 2, bathrooms: 1, parkingSpaces: 1, hasStair: true })],
  'dec-2F-28.3x17.5-E': [R(28.3, 17.5, 'east', sb(2.25, 1.75, 1.5, 2.6)), villa({ floors: 2, bedrooms: 2, bathrooms: 1, parkingSpaces: 1, hasStair: true })],
};

const PROG = getTypicalArea('family-room');
const CAP = balconyAreaCap(PROG.target, PROG.min);
const famOf = (c: LayoutCandidate) => c.floors.flatMap(f => f.spaces.filter(s => s.type === 'family-room').map(s => ({ f, s })));
const layouts = (input: ProjectInput) => generateLayouts(JSON.parse(JSON.stringify(input)), [...STRATEGIES]);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Task 160: program and cap are the existing ones', () => {
  it('family room target 12 / min 8 / minWidth 2.6; M4 cap 21 m²', () => {
    expect(PROG.target).toBe(12);
    expect(PROG.min).toBe(8);
    expect(PROG.minWidth).toBe(2.6);
    expect(CAP).toBeCloseTo(21, 9);
  });
});

describe('Task 160: bounded family room on multi-floor rectangular sites', () => {
  for (const [name, [site, building]] of Object.entries(CASES)) {
    it(`${name}: one program-sized family room per strategy, upper floor, door + daylight window, within cap`, () => {
      for (const c of layouts(mk(site, building, true))) {
        const fams = famOf(c);
        expect(fams.length, c.metadata.strategy).toBe(1);
        const { f, s } = fams[0];
        expect(f.level).toBe(1); // the first bedroom floor (existing allocation)
        expect(s.area).toBeGreaterThanOrEqual(PROG.min - 1e-6);
        expect(s.area).toBeLessThanOrEqual(CAP + 1e-6);
        expect(s.area).toBeGreaterThan(11.9);
        expect(s.area).toBeLessThan(12.1);
        expect(Math.min(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual(PROG.minWidth - 1e-6);
        expect(f.openings.some(o => o.type === 'door' && (o.spaceA === s.id || o.spaceB === s.id))).toBe(true);
        expect(f.openings.some(o => o.type === 'window' && (o.spaceA === s.id || o.spaceB === s.id))).toBe(true);
        const fs = validateCandidate(c).findings;
        expect(fs.filter(x => x.code === 'FAMILY_ROOM_OVERSIZED')).toEqual([]);
      }
    });
  }

  it('the rest of the family floor is unchanged versus family OFF (rect-2F-18x28 functional-circulation)', () => {
    const [site, building] = CASES['rect-2F-18x28'];
    const on = layouts(mk(site, building, true)).find(c => c.metadata.strategy === 'functional-circulation')!;
    const off = layouts(mk(site, building, false)).find(c => c.metadata.strategy === 'functional-circulation')!;
    const key = (xs: Array<{ type: string; rect: unknown }>) => xs.map(x => x.type + JSON.stringify(x.rect)).sort();
    expect(key(on.floors[1].spaces.filter(s => s.type !== 'family-room'))).toEqual(key(off.floors[1].spaces));
    expect(key(on.floors[0].spaces)).toEqual(key(off.floors[0].spaces));
  });
});

describe('Task 160: no family room above the 21 m² cap anywhere', () => {
  it('probe cases + every existing stress scenario with a family room (all strategies)', () => {
    const inputs: ProjectInput[] = [
      ...Object.values(CASES).map(([site, building]) => mk(site, building, true)),
      ...buildStressCases().filter(c => c.input.building.hasFamilyRoom === true).map(c => c.input),
    ];
    expect(inputs.length).toBeGreaterThan(70);
    let seen = 0;
    for (const input of inputs) {
      for (const c of layouts(input)) {
        for (const { s } of famOf(c)) { seen++; expect(s.area).toBeLessThanOrEqual(CAP + 1e-6); }
        expect(validateFamilyRooms(c)).toEqual([]);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
});

describe('Task 161: no previously HARD-free candidate becomes HARD', () => {
  // Every (case, strategy) that was HARD-free at HEAD 6b06535 (pre-fix), across the probe
  // cases and all existing stress scenarios with a family room. Computed once against the
  // pre-fix build; pinned here so the fix can never turn a clean candidate invalid.
  const PRE_FIX_HARD_FREE = [
    'rect-2F-18x28|functional-circulation', 'rect-2F-18x28|alternative-zoning',
    'rect-2F-22x32|area-efficiency', 'rect-2F-22x32|functional-circulation', 'rect-2F-22x32|alternative-zoning',
    'narrow-2F-13x30|daylight-orientation', 'narrow-2F-13x30|functional-circulation', 'narrow-2F-13x30|alternative-zoning',
    'dec-2F-17.5x28.3-S|functional-circulation', 'dec-2F-17.5x28.3-S|alternative-zoning',
    'dec-2F-28.3x17.5-E|functional-circulation', 'dec-2F-28.3x17.5-E|alternative-zoning',
    'R14x26--U1-2f4bd|daylight-orientation', 'R14x30--U1-2f4bd|daylight-orientation', 'R14x34--U1-2f4bd|daylight-orientation',
    'R16x26--U1-2f4bd|daylight-orientation', 'R16x30--U1-2f4bd|daylight-orientation', 'R16x34--U1-2f4bd|daylight-orientation',
    'R25x22--U1-2f4bd|functional-circulation', 'R25x22--U1-2f4bd|alternative-zoning',
    'R25x26--U1-2f4bd|alternative-zoning', 'R25x26--U1-2f4bd|functional-circulation',
    'R25x30--U1-2f4bd|functional-circulation', 'R25x30--U1-2f4bd|alternative-zoning',
    'R25x34--U1-2f4bd|area-efficiency', 'R25x34--U1-2f4bd|functional-circulation', 'R25x34--U1-2f4bd|alternative-zoning',
  ];
  it(`all ${PRE_FIX_HARD_FREE.length} pre-fix HARD-free candidates are still HARD-free`, () => {
    const stress = new Map(buildStressCases().map(c => [c.id, c.input]));
    const inputOf = (id: string): ProjectInput => {
      const p = CASES[id];
      return p ? mk(p[0], p[1], true) : stress.get(id)!;
    };
    const regressed: string[] = [];
    for (const key of PRE_FIX_HARD_FREE) {
      const [id, strategy] = key.split('|');
      const input = inputOf(id);
      expect(input, id).toBeDefined();
      const c = generateLayouts(JSON.parse(JSON.stringify(input)), [strategy as any])[0];
      const hard = validateLayout(c).hard;
      if (hard.length) regressed.push(`${key}: ${hard.map(h => h.code).join(',')}`);
    }
    expect(regressed).toEqual([]);
  });
});

describe('Task 160: family room OFF is unchanged', () => {
  // Default web-UI input (App.tsx DEFAULT_STATE → buildProjectInput); DXF sha256 pinned
  // before Task 160 (same values as the web balcony/yard guards).
  const uiInput = (fam: boolean | undefined): ProjectInput => mk(
    { shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8, northRotationDeg: 0,
      setbacks: { north: 2, south: 3, east: 2, west: 2 }, jurisdiction: 'Tehran-Municipality-Default', city: 'Tehran', parkingLayout: 'auto' },
    { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2,
      hasStair: true, hasElevator: false, hasStorage: true, hasBalcony: false, hasYard: false },
    fam);
  it('hasFamilyRoom false / omitted: default plans + DXF byte-identical to the pre-fix pins', () => {
    for (const fam of [false, undefined]) {
      const r = generate(createProject(uiInput(fam)), { allStrategies: true });
      expect(r.candidates.map(c => `${c.metadata.strategy}:${sha(exportDXF(c, 'ویلای نمونه').dxf)}`)).toEqual([
        'functional-circulation:bd7df1bf3cc6a9a0a26fd5262637ec9b9c01985136caef95e2407bf1c90848d0',
        'alternative-zoning:089d28d8dd529a610bf346acfbc425a4845322486a4b197bec6c42b541c3ce17',
      ]);
      for (const c of r.candidates) expect(famOf(c)).toEqual([]);
    }
  });
});

describe('Task 160: impossible placement → honest INFEASIBLE', () => {
  it('R10x10 (existing stress site): no bounded spot → ARCH_PROGRAM_UNPLACED family-room, INFEASIBLE, deterministic', () => {
    const input = buildStressCases().find(c => c.id === 'R10x10--U1-2f4bd')!.input;
    const a = generate(createProject(JSON.parse(JSON.stringify(input))), { allStrategies: true });
    const b = generate(createProject(JSON.parse(JSON.stringify(input))), { allStrategies: true });
    expect(a.bestCandidate).toBeNull();
    expect(a.candidates).toEqual([]);
    expect(['HARD_RULE_VIOLATION', 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION']).toContain(a.infeasible!.code); // the two documented INFEASIBLE codes
    expect(b.infeasible!.code).toBe(a.infeasible!.code);
    expect(b.infeasible!.explanation).toBe(a.infeasible!.explanation);
    expect(a.infeasible!.diagnosticCandidates.length).toBe(4);
    for (const d of a.infeasible!.diagnosticCandidates) {
      expect(famOf(d)).toEqual([]); // never an unbounded filler
      expect(d.findings.some(f => f.code === 'ARCH_PROGRAM_UNPLACED' && /'family-room'/.test(f.message))).toBe(true);
    }
  });
});

describe('Task 160: FAMILY_ROOM_OVERSIZED gate', () => {
  const base = layouts(mk(CASES['rect-2F-18x28'][0], CASES['rect-2F-18x28'][1], true)).find(c => c.metadata.strategy === 'functional-circulation')!;
  it('a family room above 21 m² is a HARD finding; at the cap it is not', () => {
    const c = structuredClone(base) as LayoutCandidate;
    const s = famOf(c)[0].s;
    s.area = 108.8;
    const fs = validateFamilyRooms(c);
    expect(fs.length).toBe(1);
    expect(fs[0].code).toBe('FAMILY_ROOM_OVERSIZED');
    expect(fs[0].severity).toBe('hard');
    expect(fs[0].message).toBe(`Floor 1: family room '${s.id}' area 108.80 m² exceeds the program cap 21.00 m² (target 12 m²)`);
    expect(validateCandidate(c).hard.some(f => f.code === 'FAMILY_ROOM_OVERSIZED')).toBe(true);
    s.area = 21.0;
    expect(validateFamilyRooms(c)).toEqual([]);
  });
});

describe('Task 160: determinism + DXF profile', () => {
  it('repeated generation is byte-identical (plans + DXF) and keeps AC1009', () => {
    for (const name of ['rect-2F-18x28', 'rect-3F-20x30', 'dec-2F-28.3x17.5-E']) {
      const [site, building] = CASES[name];
      const fp = () => layouts(mk(site, building, true)).map(c => JSON.stringify(c.floors) + sha(exportDXF(c, 'x').dxf)).join('|');
      expect(fp()).toBe(fp());
    }
    const r = generate(createProject(mk(CASES['rect-2F-18x28'][0], CASES['rect-2F-18x28'][1], true)), { allStrategies: true });
    expect(r.bestCandidate).not.toBeNull();
    const dxf = exportDXF(r.bestCandidate!, 'x').dxf;
    expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    expect((dxf.match(/\$ACADVER/g) ?? []).length).toBe(1);
  });
});
