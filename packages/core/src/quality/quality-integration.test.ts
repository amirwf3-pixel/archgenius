/**
 * Phase 5.1c — Quality V1 integration / regression layer (tests only).
 *
 * Quality V1 is NOT wired into ranking, the generator, the manifest, the UI or DXF.
 * This layer proves, on canonical generated projects, that:
 *   - computeQualityMetricsV1 is deterministic (same candidate, and fresh regeneration);
 *   - it never mutates the candidate or the generate() result;
 *   - every metric number is finite and every MetricValue is in [0,1] or null,
 *     with value === num/den whenever it is non-null;
 *   - rectangle, L-shape, single-floor, multi-floor and elevator cases all execute;
 *   - stair/elevator geometry and DXF output are byte-identical to HEAD 75216a7
 *     (digests below were computed from a pristine `git archive HEAD` build and
 *     cross-checked against the working tree before being pinned);
 *   - the DXF R12 header still declares $ACADVER = AC1009.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import { createProject, generate } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { computeQualityMetricsV1, type QualityMetricsV1 } from './metrics-v1.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const RECT = { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8, setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } };
const BUILDING = { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true };

interface Case {
  site: object;
  extra: object;
  floors: number;
  stairs: number;
  elevators: number;
  /** sha256 of JSON floors.map({level, stairs, elevators}) at HEAD 75216a7 */
  geo: string;
  /** sha256 of writeDXF(candidate) at HEAD 75216a7 */
  dxf: string;
}

const CASES: Record<string, Case> = {
  'rect-2f': { site: RECT, extra: {}, floors: 2, stairs: 2, elevators: 0,
    geo: '833cf96c5241e39042e74c852132973041d0032abb9cfcae66a8431e5a0b2679', dxf: '5e4f494ecead038ef9834e240c21b5238612e962c3b366152291b9df75bad7be' },
  'lshape-2f': { site: LSHAPE, extra: {}, floors: 2, stairs: 2, elevators: 0,
    geo: '32909b16fc0ccf40d8d9a9a79006e17925985fad6644613b2aec262e0cbf8b77', dxf: 'f714e35467bd121872f9e33b450c97c5bd7bc8a30df6332efdfed18a73689219' },
  'rect-1f': { site: RECT, extra: { floors: 1 }, floors: 1, stairs: 0, elevators: 0,
    geo: 'ceb4f6d84a300c46699a4771300b683ec02bdb462930a3830b3a1f912615c856', dxf: '0311a1ea9e414619dddca5ca9170ec4413dd90ba4bce34249d65caf05a549dbe' },
  'rect-3f': { site: RECT, extra: { floors: 3, bedrooms: 3 }, floors: 3, stairs: 3, elevators: 0,
    geo: '096e683d3372243704defcb093eaf6c627af05e0a81c665c1723ac737f6d0e81', dxf: '1608b6c42ebb59bab3b3fb5700d55a5034f14ecbd70aa375398d0a51f78eb3ef' },
  'rect-3f-lift': { site: RECT, extra: { floors: 3, bedrooms: 3, hasElevator: true }, floors: 3, stairs: 3, elevators: 3,
    geo: '97f892ef675fb326ccb510fb07f5d5bd721cc93b03a5472787388212546cca3a', dxf: 'fc7bd8edd145ca9ad5719023ecf73a670dbb8faf47d25dc6b7673ec6ae92437b' },
  'lshape-2f-lift': { site: LSHAPE, extra: { hasElevator: true }, floors: 2, stairs: 2, elevators: 2,
    geo: 'ba9c66720c502685eee8e7361f1c917a046bf952482a47065abdf23bc59d0d45', dxf: 'cdbac679763f0c261f35741bc556f1b65022676631ddaab80213843c4122569e' },
};

const inputOf = (c: Case): ProjectInput =>
  ({ name: 'qi', site: c.site, building: { ...BUILDING, ...c.extra }, country: 'IR', deterministic: true, seed: 42 } as unknown as ProjectInput);

/** generate() result with wall-clock fields masked (project.id, createdAt, updatedAt, generatedAt). */
function maskedResult(input: ProjectInput): { json: string; best: LayoutCandidate; all: LayoutCandidate[] } {
  const res = generate(createProject(input), {});
  const json = JSON.stringify(res, (k, v) => (k === 'id' && typeof v === 'string' && v.startsWith('prj-') ? '<id>'
    : k === 'createdAt' || k === 'updatedAt' || k === 'generatedAt' ? 0 : v));
  return { json, best: res.candidates[0], all: res.candidates };
}

const stairElevatorGeometry = (c: LayoutCandidate) =>
  JSON.stringify(c.floors.map(f => ({ level: f.level, stairs: f.stairs, elevators: f.elevators })));

/** Recursively checks every number is finite and every MetricValue obeys the null/[0,1] contract. */
function auditMetrics(node: unknown, path: string, out: string[], stats: { metrics: number; nulls: number; numbers: number }): void {
  if (typeof node === 'number') {
    stats.numbers++;
    if (!Number.isFinite(node)) out.push(`${path}: non-finite ${node}`);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((v, i) => auditMetrics(v, `${path}[${i}]`, out, stats)); return; }
  const o = node as Record<string, unknown>;
  if ('value' in o && 'num' in o && 'den' in o && 'basis' in o) {
    stats.metrics++;
    const { value, num, den, basis } = o as { value: number | null; num: number; den: number; basis: string };
    if (!Number.isFinite(num) || !Number.isFinite(den)) out.push(`${path}: num/den not finite`);
    if (den < 0) out.push(`${path}: negative den`);
    if (basis !== 'GEOMETRIC' && basis !== 'PROGRAM') out.push(`${path}: bad basis ${basis}`);
    if (value === null) {
      stats.nulls++;
      if (den > 0) out.push(`${path}: null value with den ${den}`);
    } else {
      if (!Number.isFinite(value) || value < 0 || value > 1) out.push(`${path}: value ${value} outside [0,1]`);
      if (!(den > 0)) out.push(`${path}: value without positive den`);
      else if (value !== num / den) out.push(`${path}: value ${value} !== num/den ${num / den}`);
    }
  }
  for (const [k, v] of Object.entries(o)) auditMetrics(v, `${path}.${k}`, out, stats);
}

describe('Quality V1 integration — canonical generated projects', () => {
  for (const [name, c] of Object.entries(CASES)) {
    describe(name, () => {
      const input = inputOf(c);

      it('generates the expected structure and computes quality for every floor', () => {
        const { best } = maskedResult(input);
        expect(best.valid).toBe(true);
        expect(best.floors).toHaveLength(c.floors);
        expect(best.floors.reduce((a, f) => a + f.stairs.length, 0)).toBe(c.stairs);
        expect(best.floors.reduce((a, f) => a + f.elevators.length, 0)).toBe(c.elevators);
        const q = computeQualityMetricsV1(best, input);
        expect(q.version).toBe(1);
        expect(q.floors.map(f => f.level)).toEqual(best.floors.map(f => f.level));
        expect(q.vertical.floorCount).toBe(c.floors);
        expect(q.vertical.pairs).toHaveLength(Math.max(0, c.floors - 1));
      });

      it('is deterministic for the same candidate and across independent regeneration', () => {
        const a = maskedResult(input).best;
        const q1 = JSON.stringify(computeQualityMetricsV1(a, input));
        expect(JSON.stringify(computeQualityMetricsV1(a, input))).toBe(q1);
        expect(JSON.stringify(computeQualityMetricsV1(maskedResult(input).best, input))).toBe(q1);
      });

      it('does not mutate any candidate nor the generate() result', () => {
        const r = maskedResult(input);
        const before = r.json;
        const perCandidate = r.all.map(x => JSON.stringify(x));
        for (const cand of r.all) computeQualityMetricsV1(cand, input);
        expect(r.all.map(x => JSON.stringify(x))).toEqual(perCandidate);
        // generating again with quality computed in between yields the identical (masked) result
        expect(maskedResult(input).json).toBe(before);
      });

      it('every number is finite; every MetricValue is null or in [0,1] with value === num/den', () => {
        const r = maskedResult(input);
        for (const cand of r.all) {
          const q: QualityMetricsV1 = computeQualityMetricsV1(cand, input);
          const problems: string[] = [];
          const stats = { metrics: 0, nulls: 0, numbers: 0 };
          auditMetrics(q, name, problems, stats);
          expect(problems).toEqual([]);
          expect(stats.metrics).toBeGreaterThan(0);
          expect(stats.numbers).toBeGreaterThan(0);
        }
      });

      it('stair/elevator geometry is byte-identical to HEAD 75216a7 and unaffected by quality computation', () => {
        const { best } = maskedResult(input);
        const before = stairElevatorGeometry(best);
        expect(sha(before)).toBe(c.geo);
        computeQualityMetricsV1(best, input);
        expect(stairElevatorGeometry(best)).toBe(before);
      });

      it('DXF output is byte-identical to HEAD 75216a7 before and after quality computation; header is AC1009', () => {
        const { best } = maskedResult(input);
        const dxf = writeDXF(best);
        expect(sha(dxf)).toBe(c.dxf);
        expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
        expect(dxf.length).toBeGreaterThan(1000); // never blank
        computeQualityMetricsV1(best, input);
        expect(sha(writeDXF(best))).toBe(c.dxf);
      });
    });
  }
});

describe('Quality V1 integration — cross-case expectations', () => {
  it('elevator cases report measured lift alignment; non-elevator cases report null', () => {
    for (const [name, c] of Object.entries(CASES)) {
      const input = inputOf(c);
      const q = computeQualityMetricsV1(maskedResult(input).best, input);
      if (c.elevators > 0) {
        expect(q.vertical.liftAlign.value, name).not.toBeNull();
        expect(q.vertical.pairs.every(p => p.liftExactStack === true), name).toBe(true);
      } else {
        expect(q.vertical.liftAlign.value, name).toBeNull();
      }
      if (c.floors === 1) {
        expect(q.vertical.stairAlign.value, name).toBeNull();
        expect(q.vertical.pairs, name).toEqual([]);
      }
    }
  });

  it('L-shape envelopes use the real polygon (never larger than the footprint rect)', () => {
    for (const name of ['lshape-2f', 'lshape-2f-lift']) {
      const input = inputOf(CASES[name]);
      const q = computeQualityMetricsV1(maskedResult(input).best, input);
      for (const f of q.floors) {
        expect(f.residual.envelopeSource).toBe('buildableBoundary∩footprint');
        expect(f.residual.envelopeArea).toBeLessThanOrEqual(f.residual.footprintRectArea + 1e-9);
      }
    }
  });
});
