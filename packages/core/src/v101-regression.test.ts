/**
 * v1.0.1 patch regression suite (AGX-01 … AGX-08).
 *
 * Covers the defects found by the post-v1.0.0 forensic audit:
 *   AGX-01  rotated U-stair squeezed the actual flight going below the
 *           code minimum while validation/DXF reported the nominal tread.
 *   AGX-02  multi-floor buildings without `hasStair` generated NO stairs
 *           and still validated clean.
 *   AGX-03  negative setbacks pushed the buildable boundary outside the site.
 *   AGX-04  usable CASE-B candidates with HARD geometry findings must never
 *           be labeled valid/compliant (findings stay visible, INVALID status).
 *   AGX-05  stair-halls/stairs placed outside the buildable boundary; failed
 *           stair placement silently disappearing; cross-floor core alignment.
 *   AGX-06  duplicate corridor space ids across floors.
 *   AGX-07  non-integer / negative / NaN seed leaking into candidate ids.
 *   AGX-08  unsupported kitchenType / building.type silently treated as defaults.
 */
import { describe, it, expect } from 'vitest';
import {
  createProject,
  generate,
  validateCandidate,
  exportDXF,
  buildDocumentation,
} from './pipeline.js';
import { buildManifest } from './documentation/manifest.js';
import { solveStair } from './generator/stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from './model/stairs.js';
import { rContains, rOverlapArea } from './geometry/rect.js';
import { rectInsidePolygon } from './geometry/polygon-ops.js';
import type { LayoutCandidate } from './model/layout.js';
import type { ProjectInput } from './model/project.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Exact failing configuration from the audit: the default web project. */
function webDefaultInput(): ProjectInput {
  return {
    name: 'ArchGenius Demo',
    country: 'IR',
    site: {
      shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8,
      setbacks: { north: 2, south: 3, east: 2, west: 2 },
    },
    building: {
      type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
      kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasElevator: false, hasStorage: true,
    },
    deterministic: true,
    seed: 42,
  };
}

function villaInput(overrides: {
  site?: Partial<ProjectInput['site']>;
  building?: Partial<ProjectInput['building']>;
  seed?: number;
} = {}): ProjectInput {
  return {
    name: 'T',
    country: 'IR',
    site: {
      shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8,
      ...(overrides.site ?? {}),
    },
    building: {
      type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
      kitchenType: 'closed', parkingSpaces: 0, hasStair: true,
      ...(overrides.building ?? {}),
    },
    deterministic: true,
    seed: overrides.seed ?? 42,
  };
}

const MIN_TREAD = DEFAULT_STAIR_CONFIG.minTreadDepth; // 0.28 m (MBH4 §4-5-1-7-1)

/** All stair/flight invariants that must hold for every generated stair. */
function assertStairInvariants(cand: LayoutCandidate) {
  for (const fl of cand.floors) {
    for (const st of fl.stairs ?? []) {
      expect(st.flights.length).toBeGreaterThan(0);
      // total rise consistency
      expect(Math.abs(st.totalRise - st.totalRisers * st.riserHeight)).toBeLessThan(0.005);
      const sumRisers = st.flights.reduce((a, f) => a + f.riserCount, 0);
      expect(sumRisers).toBe(st.totalRisers);
      for (const f of st.flights) {
        // positive dimensions
        expect(f.riserCount).toBeGreaterThanOrEqual(2);
        expect(f.treadCount).toBe(f.riserCount - 1);
        expect(f.riserHeight).toBeGreaterThan(0);
        expect(f.width).toBeGreaterThan(0);
        // AGX-01 core invariant: ACTUAL going never below the configured minimum
        expect(f.treadDepth).toBeGreaterThanOrEqual(MIN_TREAD - 1e-9);
        // run consistency
        expect(Math.abs(f.runLength - f.treadCount * f.treadDepth)).toBeLessThan(0.02);
        // flights inside the stairwell footprint
        expect(rContains(st.footprint, f.footprint, 0.01)).toBe(true);
      }
      // no flight-over-flight plan overlap
      for (let i = 0; i < st.flights.length; i++) {
        for (let j = i + 1; j < st.flights.length; j++) {
          expect(rOverlapArea(st.flights[i].footprint, st.flights[j].footprint)).toBeLessThan(0.005);
        }
      }
      // landing geometry valid and inside the stairwell
      for (const l of st.landings) {
        expect(l.depth).toBeGreaterThan(0);
        expect(rContains(st.footprint, l.footprint, 0.01)).toBe(true);
      }
      if (st.flights.length >= 2) {
        expect(st.landings.length).toBeGreaterThanOrEqual(st.flights.length - 1);
      }
      // AGX-05: stair inside the buildable boundary of its floor
      const buildable = (fl as any).buildableBoundary;
      if (buildable) {
        expect(rectInsidePolygon(st.footprint, buildable, 1e-3)).toBe(true);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AGX-01 — U-stair actual flight going
// ---------------------------------------------------------------------------

describe('AGX-01: U-stair actual flight going (rotated well)', () => {
  it('default web configuration: every flight going ≥ 0.28 m, run/rise consistent, no stair HARD findings', () => {
    const { bestCandidate } = generate(createProject(webDefaultInput()));
    expect(bestCandidate).toBeTruthy();
    assertStairInvariants(bestCandidate!);
    // Both floors have a stair with compliant geometry (previously 0.188 m going).
    for (const fl of bestCandidate!.floors) {
      expect((fl.stairs ?? []).length).toBeGreaterThanOrEqual(1);
      for (const st of fl.stairs) {
        for (const f of st.flights) {
          expect(f.treadDepth).toBeCloseTo(0.28, 3);
        }
      }
    }
    const vr = validateCandidate(bestCandidate!);
    const stairHards = vr.hard.filter(h => /STAIR/i.test(h.code));
    expect(stairHards).toEqual([]);
    // The whole default plan is clean (0 HARD) — verified pre-patch too.
    expect(vr.hard).toEqual([]);
  });

  it('solver: a hall that only fits ROTATED produces a compliant U-stair (not a squeezed one)', () => {
    // 3.9 × 2.9 m hall: u-stair requires 2.81 × 3.845 — only fits rotated.
    const sol = solveStair({ x: 0, y: 0, w: 3.9, h: 2.9 }, DEFAULT_STAIR_CONFIG, 'south');
    expect(sol.ok).toBe(true);
    expect(sol.stair!.type).toBe('u-stair');
    for (const f of sol.stair!.flights) {
      expect(f.treadDepth).toBeGreaterThanOrEqual(MIN_TREAD - 1e-9);
      expect(Math.abs(f.runLength - f.treadCount * f.treadDepth)).toBeLessThan(0.005);
      expect(rContains(sol.stair!.footprint, f.footprint, 0.01)).toBe(true);
    }
    expect(sol.stair!.landings.length).toBe(1);
    expect(rContains(sol.stair!.footprint, sol.stair!.landings[0].footprint, 0.01)).toBe(true);
  });

  it('solver: a hall too small for ANY compliant configuration returns ok=false (deterministic infeasible mechanism)', () => {
    // 2.3 × 3.6 m hall: straight (1.30×5.88), u-stair (2.40×3.64), l-stair
    // (3.54×4.74) — none fits in either orientation. The only way to "fit"
    // would be shrinking the going below 0.28 m, which the solver must never do.
    const sol = solveStair({ x: 0, y: 0, w: 2.3, h: 3.6 }, DEFAULT_STAIR_CONFIG, 'south');
    expect(sol.ok).toBe(false);
    expect(sol.attempts.length).toBeGreaterThan(0);
    for (const a of sol.attempts) expect(typeof a.reason).toBe('string');
    // deterministic
    const sol2 = solveStair({ x: 0, y: 0, w: 2.3, h: 3.6 }, DEFAULT_STAIR_CONFIG, 'south');
    expect(JSON.stringify(sol)).toEqual(JSON.stringify(sol2));
  });

  it('solver: multi-flight straight stair builds SEQUENTIAL flights (no exact overlap)', () => {
    // 1.3 × 6.0 m hall: only a straight 9+9 stair fits. Pre-patch both flights
    // were built at the corridor edge (identical geometry — exact overlap).
    const sol = solveStair({ x: 0, y: 0, w: 1.3, h: 6.0 }, DEFAULT_STAIR_CONFIG, 'south');
    expect(sol.ok).toBe(true);
    const flights = sol.stair!.flights;
    expect(flights.length).toBe(2);
    for (let i = 1; i < flights.length; i++) {
      // each subsequent flight starts past the previous flight's run
      expect(flights[i].startPoint.y).toBeGreaterThan(flights[i - 1].endPoint.y);
    }
    for (let i = 0; i < flights.length; i++) {
      for (let j = i + 1; j < flights.length; j++) {
        expect(rOverlapArea(flights[i].footprint, flights[j].footprint)).toBeLessThan(0.005);
      }
      expect(flights[i].treadDepth).toBeGreaterThanOrEqual(MIN_TREAD - 1e-9);
      expect(rContains(sol.stair!.footprint, flights[i].footprint, 0.01)).toBe(true);
    }
    expect(sol.stair!.landings.length).toBe(1); // intermediate landing between the flights
  });

  it('DXF draws the ACTUAL tread spacing (280 mm) and annotates actual geometry — no 0.22 m clamp', () => {
    const { bestCandidate } = generate(createProject(webDefaultInput()));
    const { dxf, validation } = exportDXF(bestCandidate!, 'demo');
    expect(validation.ok).toBe(true);
    // Tread LINE start points on A-STAIR-TREAD (and per-floor variants).
    const re = /0\r\nLINE\r\n8\r\n((?:A-FLOOR-\d+-)?A-STAIR-TREAD)\r\n10\r\n(-?[\d.]+)\r\n20\r\n(-?[\d.]+)/g;
    const pts: Array<{ layer: string; x: number; y: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(dxf))) pts.push({ layer: m[1], x: +m[2], y: +m[3] });
    expect(pts.length).toBeGreaterThanOrEqual(10);
    // Measure spacing along the run axis (whichever varies) per perpendicular group.
    const groups = new Map<string, number[]>();
    for (const p of pts) {
      // flights run east/west → tread lines vertical → constant y per flight, x varies
      const key = `${p.layer}|y=${p.y.toFixed(0)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p.x);
    }
    const spacings: number[] = [];
    for (const xs of groups.values()) {
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) spacings.push(+(xs[i] - xs[i - 1]).toFixed(1));
    }
    expect(spacings.length).toBeGreaterThan(0);
    for (const s of spacings) {
      // actual going is exactly 280 mm; the old clamp drew 220 mm
      expect(Math.abs(s - 280)).toBeLessThanOrEqual(2.0);
    }
    // Annotation reflects the ACTUAL geometry (riser×tread), not a nominal claim.
    // (ASCII-safe DXF policy: '×' is emitted as 'x' — Phase-A hardening.)
    expect(dxf).toContain('18R @ 18x28');
    // Determinism: byte-identical DXF on repeat generation.
    const again = generate(createProject(webDefaultInput())).bestCandidate!;
    expect(exportDXF(again, 'demo').dxf).toEqual(dxf);
  });

  it('property sweep: every usable candidate across sites/floors/seeds keeps all stair invariants', () => {
    const fixtures: Array<{ label: string; input: ProjectInput }> = [
      { label: '15x20 2F', input: villaInput({ building: { floors: 2 } }) },
      { label: '15x20 3F', input: villaInput({ building: { floors: 3 } }) },
      { label: '15x20 5F', input: villaInput({ building: { floors: 5 } }) },
      { label: '12x20 2F', input: villaInput({ site: { width: 12, length: 20 }, building: { bedrooms: 2 } }) },
      { label: '18x25 2F', input: villaInput({ site: { width: 18, length: 25 }, building: { parkingSpaces: 2, hasStorage: true } }) },
      { label: '10x14 3F', input: villaInput({ site: { width: 10, length: 14 }, building: { floors: 3 } }) },
      {
        label: 'L 15x20 2F',
        input: villaInput({
          site: { shape: 'l-shape', lShape: { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'ne' } } as any,
        }),
      },
    ];
    for (const fx of fixtures) {
      for (const seed of [1, 42]) {
        const { candidates } = generate(createProject({ ...fx.input, seed }), { allStrategies: true });
        for (const cand of candidates) {
          assertStairInvariants(cand);
          // AGX-05: no stair geometry outside the building in any usable candidate
          const vr = validateCandidate(cand);
          expect(vr.hard.filter(h => h.code === 'STAIR_OUTSIDE_BUILDING')).toEqual([]);
          // standard fixtures keep vertically stacked cores
          expect(vr.hard.filter(h => h.code === 'STAIR_CORE_MISALIGNED')).toEqual([]);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AGX-02 — multi-floor stair invariant
// ---------------------------------------------------------------------------

describe('AGX-02: multi-floor buildings always get vertical circulation', () => {
  it('hasStair OMITTED + floors 2/3 → normalized to true; stairs on every non-top floor; no STAIR_MISSING', () => {
    for (const floors of [2, 3]) {
      const input = villaInput({ building: { floors } as any });
      delete (input.building as any).hasStair;
      const prj = createProject(input);
      // normalization happened (only when the caller omitted the field)
      expect((prj.input.building as any).hasStair).toBe(true);
      const { bestCandidate, infeasible } = generate(prj);
      expect(infeasible).toBeNull();
      expect(bestCandidate).toBeTruthy();
      const top = bestCandidate!.floors.length - 1;
      for (const fl of bestCandidate!.floors) {
        if (fl.level < top) expect((fl.stairs ?? []).length).toBeGreaterThanOrEqual(1);
      }
      const vr = validateCandidate(bestCandidate!);
      expect(vr.findings.filter(f => f.code === 'STAIR_MISSING')).toEqual([]);
    }
  });

  it('hasStair OMITTED + floors 1 → stays omitted; single floor needs no stair, no STAIR_MISSING', () => {
    const input = villaInput({ building: { floors: 1 } as any });
    delete (input.building as any).hasStair;
    const prj = createProject(input);
    expect((prj.input.building as any).hasStair).toBeUndefined();
    const { bestCandidate } = generate(prj);
    expect(bestCandidate).toBeTruthy();
    const vr = validateCandidate(bestCandidate!);
    expect(vr.findings.filter(f => f.code === 'STAIR_MISSING')).toEqual([]);
  });

  it('explicit hasStair:false + floors>1 is deterministically rejected (V1 has no elevator generation)', () => {
    const input = villaInput({ building: { floors: 2, hasStair: false } as any });
    expect(() => createProject(input)).toThrowError(/hasStair must be true for floors > 1/);
    const input3 = villaInput({ building: { floors: 3, hasStair: false } as any });
    expect(() => createProject(input3)).toThrowError(/hasStair must be true for floors > 1/);
  });

  it('STAIR_MISSING HARD fires when no stair can be placed (L-shaped site drops the stair-hall)', () => {
    const input = villaInput({
      site: { shape: 'l-shape', lShape: { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'ne' } } as any,
    });
    const { bestCandidate, infeasible } = generate(createProject(input));
    // CASE-B semantics: candidate may remain usable/exportable…
    expect(infeasible).toBeNull();
    expect(bestCandidate).toBeTruthy();
    // …but it is NEVER labeled valid: explicit STAIR_MISSING HARD finding.
    const vr = validateCandidate(bestCandidate!);
    expect(bestCandidate!.valid).toBe(false);
    expect(vr.ok).toBe(false);
    expect(vr.hard.filter(f => f.code === 'STAIR_MISSING').length).toBeGreaterThan(0);
    // deterministic across runs
    const again = generate(createProject(input)).bestCandidate!;
    expect(JSON.stringify(again.findings.map(f => f.code))).toEqual(
      JSON.stringify(bestCandidate!.findings.map(f => f.code)),
    );
  });
});

// ---------------------------------------------------------------------------
// AGX-03 — negative / non-finite setbacks
// ---------------------------------------------------------------------------

describe('AGX-03: setbacks must be finite and >= 0 (buildable stays inside the property)', () => {
  const cases: Array<{ label: string; site: any }> = [
    { label: '-1 object', site: { setbacks: { north: -1, south: 0, east: 0, west: 0 } } },
    { label: '-3 object', site: { setbacks: { north: -3, south: -3, east: -3, west: -3 } } },
    { label: 'mixed positive/negative', site: { setbacks: { north: 2, south: -0.5, east: 1, west: 0 } } },
    { label: 'NaN object', site: { setbacks: { north: NaN, south: 0, east: 0, west: 0 } } },
    { label: 'Infinity object', site: { setbacks: { north: Infinity, south: 0, east: 0, west: 0 } } },
    { label: '-2 field form', site: { setbackNorth: -2 } },
    { label: 'NaN field form', site: { setbackSouth: NaN } },
    { label: 'Infinity field form', site: { setbackEast: Infinity } },
  ];
  for (const c of cases) {
    it(`rejects ${c.label}`, () => {
      expect(() => createProject(villaInput({ site: c.site, building: { floors: 1 } as any })))
        .toThrowError(/setback/);
    });
  }
  it('accepts valid positive setbacks (both forms) and keeps the plan usable', () => {
    const ok1 = generate(createProject(villaInput({ site: { setbacks: { north: 2, south: 3, east: 2, west: 2 } } })));
    expect(ok1.bestCandidate).toBeTruthy();
    const ok2 = generate(createProject(villaInput({ site: { setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 }, building: { floors: 1 } as any })));
    expect(ok2.bestCandidate).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AGX-04 — bestCandidate geometry contract (CASE-B stays INVALID, findings stay)
// ---------------------------------------------------------------------------

describe('AGX-04: usable CASE-B candidates with HARD geometry findings are never labeled valid', () => {
  it('overlapping-rooms fixture: candidate usable, but valid=false, HARD findings preserved, exports honest', () => {
    // Audit fixture: 6×12 site with a minimal program produces a usable best
    // candidate carrying GEO/SITE overlap+containment HARD findings (CASE B).
    const input: ProjectInput = {
      name: 'case-b',
      country: 'IR',
      site: { shape: 'rectangle', width: 6, length: 12, accessSide: 'south', streetWidth: 6 },
      building: {
        type: 'villa', floors: 1, bedrooms: 1, masterBedrooms: 0, bathrooms: 1, wc: 0,
        kitchenType: 'open', parkingSpaces: 0,
      },
      deterministic: true,
      seed: 1,
    };
    const { bestCandidate, infeasible } = generate(createProject(input));
    expect(infeasible).toBeNull();
    expect(bestCandidate).toBeTruthy();
    // The candidate is exportable per the CASE-B contract…
    const vr = validateCandidate(bestCandidate!);
    expect(vr.ok).toBe(false);
    expect(bestCandidate!.valid).toBe(false);
    expect(vr.hard.length).toBeGreaterThan(0);
    // …HARD geometry findings are NOT suppressed (overlap and/or containment).
    const geoHards = vr.hard.filter(h => h.code.startsWith('GEO_') || h.code.startsWith('SITE_'));
    expect(geoHards.length).toBeGreaterThan(0);
    // DXF export is REFUSED (Phase-A hardening): this CASE-B fixture's geometry
    // lies outside the site/buildable envelope, so a DXF would be a misleading
    // apparently-valid CAD file. The refusal itself is the honest behaviour.
    expect(() => exportDXF(bestCandidate!, 'case-b')).toThrowError(/hard site-envelope geometry violations/);
    // Documentation + manifest still work and report the HARD count honestly.
    const prj = createProject(input);
    const doc = buildDocumentation(prj, bestCandidate!);
    const manifest = buildManifest(doc, prj, bestCandidate!);
    expect(manifest.qa.hardCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AGX-05 — stair placement safety
// ---------------------------------------------------------------------------

describe('AGX-05: stair placement safety (10×14 / 15×20 / L-shape, 2 and 3 floors, hasStair=true)', () => {
  it('10×14 (tight hall): no stair outside the buildable boundary; failure is flagged, not silent', () => {
    for (const floors of [2, 3]) {
      const input = villaInput({ site: { width: 10, length: 14 }, building: { floors } });
      const { bestCandidate, infeasible } = generate(createProject(input));
      if (infeasible) continue; // deterministic infeasible is an acceptable outcome
      expect(bestCandidate).toBeTruthy();
      // Every stair footprint is inside the buildable boundary — the audit's
      // x=32.75 m phantom (site was 10 m wide) can no longer occur.
      for (const fl of bestCandidate!.floors) {
        const buildable = (fl as any).buildableBoundary;
        for (const st of fl.stairs ?? []) {
          expect(rectInsidePolygon(st.footprint, buildable, 1e-3)).toBe(true);
        }
      }
      const vr = validateCandidate(bestCandidate!);
      expect(vr.hard.filter(h => h.code === 'STAIR_OUTSIDE_BUILDING')).toEqual([]);
      expect(vr.hard.filter(h => h.code === 'SITE_STAIR_OUTSIDE_BUILDABLE')).toEqual([]);
      // Deterministic: identical findings across runs.
      const again = validateCandidate(generate(createProject(input)).bestCandidate!);
      expect(again.findings.map(f => f.code)).toEqual(vr.findings.map(f => f.code));
    }
  });

  it('15×20: stairs on every floor, cores aligned across floors, no STAIR_MISSING / misalignment', () => {
    for (const floors of [2, 3]) {
      const input = villaInput({ building: { floors } });
      const { bestCandidate } = generate(createProject(input));
      expect(bestCandidate).toBeTruthy();
      assertStairInvariants(bestCandidate!);
      const vr = validateCandidate(bestCandidate!);
      expect(vr.findings.filter(f => f.code === 'STAIR_MISSING')).toEqual([]);
      expect(vr.findings.filter(f => f.code === 'STAIR_CORE_MISALIGNED')).toEqual([]);
      // identical core footprint on every floor (within 1 mm)
      const sigs = bestCandidate!.floors.map(fl =>
        (fl.stairs ?? []).map(s => `${s.footprint.x.toFixed(3)},${s.footprint.y.toFixed(3)},${s.footprint.w.toFixed(3)},${s.footprint.h.toFixed(3)}`).join('|'));
      for (const s of sigs) expect(s).toEqual(sigs[0]);
    }
  });

  it('L-shaped 15×20: when the stair-hall cannot be placed, STAIR_MISSING flags it deterministically', () => {
    for (const floors of [2, 3]) {
      const input = villaInput({
        site: { shape: 'l-shape', lShape: { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'ne' } } as any,
        building: { floors },
      });
      const { bestCandidate, infeasible } = generate(createProject(input));
      if (infeasible) continue;
      expect(bestCandidate).toBeTruthy();
      const vr = validateCandidate(bestCandidate!);
      expect(bestCandidate!.valid).toBe(false);
      expect(vr.hard.filter(f => f.code === 'STAIR_MISSING').length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AGX-06 — globally unique space ids
// ---------------------------------------------------------------------------

describe('AGX-06: space ids are globally unique across floors', () => {
  it('multi-floor candidate has no duplicate space ids (corridor included)', () => {
    const input = villaInput({ building: { floors: 3 } });
    const { bestCandidate } = generate(createProject(input));
    expect(bestCandidate).toBeTruthy();
    const ids = bestCandidate!.floors.flatMap(fl => fl.spaces.map(s => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    // corridor ids are floor-qualified (the placer used to emit 'corridor-0' on every level)
    const corridorIds = bestCandidate!.floors.flatMap(fl => fl.spaces.filter(s => s.type === 'corridor').map(s => s.id));
    expect(corridorIds.length).toBeGreaterThan(0);
    expect(new Set(corridorIds).size).toBe(corridorIds.length);
  });
});

// ---------------------------------------------------------------------------
// AGX-07 — seed validation
// ---------------------------------------------------------------------------

describe('AGX-07: seed must be a non-negative integer (no NaN leaking into ids)', () => {
  for (const seed of [NaN, -5, 1.5, Infinity]) {
    it(`rejects seed ${seed}`, () => {
      expect(() => createProject(villaInput({ seed }))).toThrowError(/seed must be a non-negative integer/);
    });
  }
  it('accepts seed 0 and 42; candidate id carries the numeric seed', () => {
    for (const seed of [0, 42]) {
      const { bestCandidate } = generate(createProject(villaInput({ seed })));
      expect(bestCandidate!.id).toMatch(new RegExp(`-${seed}$`));
      expect(bestCandidate!.id).not.toMatch(/NaN/);
    }
  });
});

// ---------------------------------------------------------------------------
// AGX-08 — enum validation
// ---------------------------------------------------------------------------

describe('AGX-08: unsupported enum values are rejected, not silently defaulted', () => {
  it("rejects kitchenType 'galley'", () => {
    expect(() => createProject(villaInput({ building: { kitchenType: 'galley' } as any })))
      .toThrowError(/kitchenType must be one of closed\/open\/semi-open/);
  });
  it("rejects building.type 'hospital'", () => {
    expect(() => createProject(villaInput({ building: { type: 'hospital' } as any })))
      .toThrowError(/type must be one of villa\/apartment\/apartment-building/);
  });
  it('accepts every documented enum value', () => {
    for (const kitchenType of ['closed', 'open', 'semi-open'] as const) {
      expect(() => createProject(villaInput({ building: { kitchenType } }))).not.toThrow();
    }
    for (const type of ['villa', 'apartment', 'apartment-building'] as const) {
      expect(() => createProject(villaInput({ building: { type } }))).not.toThrow();
    }
  });
});
