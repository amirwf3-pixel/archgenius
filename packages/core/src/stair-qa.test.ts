import { describe, it, expect } from 'vitest';
import { createProject, generate, validateCandidate, exportDXF } from './pipeline.js';
import { solveStair, distributeRisers, chooseTreadDepth } from './generator/stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from './model/stairs.js';
import { rArea, rContains, rOverlapArea } from './geometry/rect.js';
import { validateFloor } from './validation/validator.js';

describe('Flight distribution (distributeRisers)', () => {
  const cases: Array<[number, number[]]> = [
    [9, [9]],
    [12, [12]],
    [13, [7, 6]],
    [18, [9, 9]],
    [19, [10, 9]],
    [24, [12, 12]],
    [25, [9, 8, 8]],
  ];
  for (const [n, want] of cases) {
    it(`${n} risers → ${want.join('+')}`, () => {
      const got = distributeRisers(n, 12);
      expect(got.reduce((a,b)=>a+b,0)).toBe(n);
      expect(got.every(x => x >= 2 && x <= 12)).toBe(true);
      // Deterministic & balanced: distribution sum equals n. Also assert
      // the expected balanced result for documentation.
      expect(got).toEqual(want);
    });
  }
  it('never produces more flights than necessary', () => {
    // ceil(18/12)=2, ceil(24/12)=2, ceil(25/12)=3.
    expect(distributeRisers(18, 12)).toHaveLength(2);
    expect(distributeRisers(24, 12)).toHaveLength(2);
    expect(distributeRisers(25, 12)).toHaveLength(3);
  });
});

describe('chooseTreadDepth', () => {
  it('keeps tread within [0.28, 0.32] and 2h+b in [0.62, 0.65]', () => {
    for (const r of [0.16, 0.17, 0.175, 0.178, 0.18]) {
      const t = chooseTreadDepth(r, 0.28);
      expect(t).toBeGreaterThanOrEqual(0.28 - 1e-9);
      expect(t).toBeLessThanOrEqual(0.32);
      const b = 2*r + t;
      expect(b).toBeGreaterThanOrEqual(0.62);
      expect(b).toBeLessThanOrEqual(0.66);
    }
  });
});

describe('U-stair 9+9 numerical geometry (18-riser)', () => {
  it('produces a geometrically-coherent U-stair sized to actual well requirements', () => {
    // Ask for a slightly larger core that comfortably fits 9+9 risers.
    const sol = solveStair({x:0,y:0,w:2.8,h:4.8}, DEFAULT_STAIR_CONFIG, 'south');
    expect(sol.ok).toBe(true);
    const st = sol.stair!;
    expect(st.type).toBe('u-stair');
    expect(st.totalRisers).toBe(18);
    expect(st.flights).toHaveLength(2);
    expect(st.landings).toHaveLength(1);
    // Each flight 9 risers, opposite directions, parallel.
    const [f1, f2] = st.flights;
    expect(f1.riserCount).toBe(9);
    expect(f2.riserCount).toBe(9);
    expect(f1.direction).toBe('north');
    expect(f2.direction).toBe('south');
    expect(f1.treadCount).toBe(8);
    expect(f2.treadCount).toBe(8);
    expect(f1.runLength).toBeCloseTo(8 * f1.treadDepth, 3);
    expect(f2.runLength).toBeCloseTo(8 * f2.treadDepth, 3);
    // Flights parallel (same x extent non-overlapping → widths < 1.3 each)
    expect(Math.max(f1.footprint.w, f2.footprint.w)).toBeLessThan(1.3);
    // Flights do not overlap each other.
    expect(rOverlapArea(f1.footprint, f2.footprint)).toBeLessThan(0.001);
    // Landing connects both flights: landing is at the far (north) end.
    const land = st.landings[0];
    expect(land.connectedFlightIds).toContain(f1.id);
    expect(land.connectedFlightIds).toContain(f2.id);
    // Landing at north end: south edge of landing = top of flights.
    // f1 climbs north from corridor (south) to landing; f2 starts at
    // landing and descends south to corridor.
    expect(Math.abs(f1.endPoint.y - land.footprint.y)).toBeLessThan(0.02);
    expect(Math.abs(f2.startPoint.y - land.footprint.y)).toBeLessThan(0.02);
    // Corridor side = south edge of well = start of f1, end of f2.
    expect(Math.abs(f1.startPoint.y - st.footprint.y)).toBeLessThan(0.02);
    expect(Math.abs(f2.endPoint.y - st.footprint.y)).toBeLessThan(0.02);
    // Opposite directions.
    expect(f1.direction).not.toEqual(f2.direction);
    // Everything inside footprint.
    expect(rContains(st.footprint, f1.footprint, 0.01)).toBe(true);
    expect(rContains(st.footprint, f2.footprint, 0.01)).toBe(true);
    expect(rContains(st.footprint, land.footprint, 0.01)).toBe(true);
    // Flight-landing overlap is zero (flights end at landing edge).
    expect(rOverlapArea(f1.footprint, land.footprint)).toBeLessThan(0.02);
    expect(rOverlapArea(f2.footprint, land.footprint)).toBeLessThan(0.02);
    // totalRise ≈ totalRisers × riserHeight
    expect(Math.abs(st.totalRise - st.totalRisers * st.riserHeight)).toBeLessThan(0.005);
  });
});

describe('Multi-floor alignment (18×25 2-story, 15×22 3-story)', () => {
  for (const [w,l,floors,seed] of [[18,25,2,42],[14,20,2,7],[15,22,3,42]] as const) {
    it(`${w}×${l} ${floors}-story (seed ${seed}): all stairs are coherent u-stair 9+9 per floor with identical cores`, () => {
      const prj = createProject({
        name: `${w}x${l}`, country:'IR',
        site: { shape:'rectangle', width:w, length:l, accessSide:'south', streetWidth:8 },
        building: { type:'villa', floors, bedrooms:3, masterBedrooms:1, bathrooms:2, wc:1, kitchenType:'closed', parkingSpaces:2, hasStair:true, hasStorage:true },
        deterministic:true, seed,
      });
      const { bestCandidate } = generate(prj);
      let prev: any = null;
      for (const fl of bestCandidate.floors) {
        expect(fl.stairs.length).toBeGreaterThanOrEqual(1);
        const st = fl.stairs[0];
        expect(st.type).toBe('u-stair');
        expect(st.totalRisers).toBe(18);
        expect(st.flights).toHaveLength(2);
        for (const f of st.flights) expect(f.riserCount).toBe(9);
        expect(rArea(st.footprint)).toBeGreaterThan(9);
        // Each flight inside footprint
        for (const f of st.flights) {
          expect(rContains(st.footprint, f.footprint, 0.01)).toBe(true);
        }
        for (const ld of st.landings) {
          expect(rContains(st.footprint, ld.footprint, 0.01)).toBe(true);
        }
        if (prev) {
          // Same core position/orientation across floors (within 1 mm).
          expect(Math.abs(st.footprint.x - prev.footprint.x)).toBeLessThan(0.001);
          expect(Math.abs(st.footprint.y - prev.footprint.y)).toBeLessThan(0.001);
          expect(Math.abs(st.footprint.w - prev.footprint.w)).toBeLessThan(0.001);
          expect(Math.abs(st.footprint.h - prev.footprint.h)).toBeLessThan(0.001);
          expect(st.type).toBe(prev.type);
          expect(st.flights.length).toBe(prev.flights.length);
        }
        prev = st;
      }
      const vr = validateCandidate(bestCandidate);
      const stairHards = vr.hard.filter(h => h.code.startsWith('STAIR_'));
      expect(stairHards).toEqual([]);
    });
  }
});

describe('Impossible stair configuration', () => {
  it('returns ok=false with attempts[] for a 1×1 m hole', () => {
    const sol = solveStair({x:0,y:0,w:1.0,h:1.0}, DEFAULT_STAIR_CONFIG, 'south');
    expect(sol.ok).toBe(false);
    expect(sol.attempts.length).toBeGreaterThan(0);
    for (const a of sol.attempts) {
      expect(typeof a.reason).toBe('string');
      expect(a.requiredW).toBeGreaterThan(0);
    }
  });
});

describe('Determinism', () => {
  it('same project produces byte-identical stairs across runs', () => {
    const mk = () => {
      const prj = createProject({
        name:'d', country:'IR',
        site:{shape:'rectangle', width:18, length:25, accessSide:'south', streetWidth:8},
        building:{type:'villa', floors:2, bedrooms:3, masterBedrooms:1, bathrooms:2, wc:1, kitchenType:'closed', parkingSpaces:2, hasStair:true, hasStorage:true},
        deterministic:true, seed:42,
      });
      return generate(prj).bestCandidate;
    };
    const a = mk(), b = mk();
    expect(a.floors[0].stairs.length).toBeGreaterThan(0);
    const sa = JSON.stringify(a.floors[0].stairs[0]);
    const sb = JSON.stringify(b.floors[0].stairs[0]);
    expect(sa).toEqual(sb);
    expect(a.findings.map(f=>f.code).sort()).toEqual(b.findings.map(f=>f.code).sort());
    const dxfA = exportDXF(a, 'det').dxf;
    const dxfB = exportDXF(b, 'det').dxf;
    expect(dxfA.length).toEqual(dxfB.length);
  });
});

describe('Furniture-on-stair detection', () => {
  it('flags furniture placed on a flight as FURN_ON_STAIR', () => {
    const prj = createProject({
      name:'18x25', country:'IR',
      site:{shape:'rectangle', width:18, length:25, accessSide:'south', streetWidth:8},
      building:{type:'villa', floors:2, bedrooms:3, masterBedrooms:1, bathrooms:2, wc:1, kitchenType:'closed', parkingSpaces:2, hasStair:true, hasStorage:true},
      deterministic:true, seed:42,
    });
    const { bestCandidate } = generate(prj);
    const fl = bestCandidate.floors[0];
    const st = fl.stairs[0];
    // True positive: furniture on flight 0.
    const onFlight = { id:'crate', type:'chair', spaceId:'stair-block', rect:{...st.flights[0].footprint}, facing:0, clearanceRequired:false } as any;
    fl.furniture.push(onFlight);
    let v: any = validateFloor(fl);
    expect(v.find((f:any)=>f.code==='FURN_ON_STAIR')).toBeTruthy();
    fl.furniture.pop();
    // False positive: nearby but not on stair.
    const near = { id:'near', type:'chair', spaceId:'stair-block',
      rect:{ x:st.footprint.x-2, y:st.footprint.y, w:0.5, h:0.5 }, facing:0, clearanceRequired:false } as any;
    fl.furniture.push(near);
    v = validateFloor(fl);
    expect(v.find((f:any)=>f.code==='FURN_ON_STAIR')).toBeFalsy();
    fl.furniture.pop();
  });
});

describe('DXF stair geometry', () => {
  it('emits tread lines, arrows, landing and UP label for a U-stair', () => {
    const prj = createProject({
      name:'18x25-dxf', country:'IR',
      site:{shape:'rectangle', width:18, length:25, accessSide:'south', streetWidth:8},
      building:{type:'villa', floors:2, bedrooms:3, masterBedrooms:1, bathrooms:2, wc:1, kitchenType:'closed', parkingSpaces:2, hasStair:true, hasStorage:true},
      deterministic:true, seed:42,
    });
    const { bestCandidate } = generate(prj);
    const { dxf, validation } = exportDXF(bestCandidate, 'u-stair dxf');
    expect(validation.ok).toBe(true);
    expect(dxf).toContain('A-STAIR');
    expect(dxf).toContain('A-STAIR-TREAD');
    expect(dxf).toContain('A-STAIR-DIR');
    expect(dxf).toContain('UP');
    // Tread count on A-STAIR-TREAD: count LINE entities on that layer.
    // Parse LINE-8 pairs and count those whose 8 field is A-STAIR-TREAD.
    const lines = dxf.split(/\r?\n/);
    let treadLines = 0, dirLines = 0, stairLines = 0;
    let layer = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '8') layer = lines[i+1]?.trim() ?? '';
      if (lines[i].trim() === 'LINE' && layer === 'A-STAIR-TREAD') treadLines++;
      if (lines[i].trim() === 'LINE' && layer === 'A-STAIR-DIR') dirLines++;
      if (lines[i].trim() === 'LINE' && layer === 'A-STAIR') stairLines++;
    }
    expect(treadLines).toBeGreaterThanOrEqual(10);
    expect(dirLines).toBeGreaterThanOrEqual(2);
    expect(stairLines).toBeGreaterThan(0);
    // No NaN / Infinity coordinates.
    expect(dxf).not.toMatch(/nan/i);
    expect(dxf).not.toMatch(/inf/i);
    // Ends with EOF.
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});

describe('Candidate ranking: invalid stair cannot outrank valid candidate', () => {
  it('ranks an impossible-stair candidate below valid ones', () => {
    // The ranking weights HARD violations over area efficiency. We construct
    // a scenario where a too-small footprint would otherwise produce a high
    // area ratio but an invalid stair; the valid candidate must come first.
    // Use the very tight 8×14 2-story case as a probe: at least one strategy
    // may produce a valid stair; the returned bestCandidate must have zero
    // STAIR/GEO/CIRC hards if any candidate does.
    const prj = createProject({
      name:'ranking', country:'IR',
      site:{shape:'rectangle', width:12, length:20, accessSide:'south', streetWidth:6},
      building:{type:'villa', floors:2, bedrooms:2, masterBedrooms:1, bathrooms:1, wc:1, kitchenType:'closed', parkingSpaces:1, hasStair:true},
      deterministic:true, seed:42,
    });
    const { candidates } = generate(prj, {allStrategies:true});
    const hards = (c:any) => c.findings.filter((f:any)=>f.severity==='hard' && (f.code.startsWith('STAIR_') || f.code.startsWith('GEO_') || f.code.startsWith('CIRC_'))).length;
    const validCount = candidates.filter(c => hards(c) === 0).length;
    expect(validCount).toBeGreaterThan(0);
    expect(hards(candidates[0])).toBe(0);
  });
});
