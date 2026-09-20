/**
 * Phase 15 M1 — Generalized stress-test runner (report-only; NO production changes).
 *
 * Runs the full 560-case matrix through the public pipeline exactly as a user
 * would (createProject -> generate), then classifies each case HONESTLY using
 * the unmodified validators (validateLayout):
 *
 *   FEASIBLE        — bestCandidate exists AND fresh validation finds 0 HARD findings
 *   HARD_WINNER     — bestCandidate exists but carries >= 1 HARD finding
 *                     (permitted by pre-15 CASE-B semantics; M2 will gate this)
 *   INFEASIBLE_NC   — pipeline returned explicit INFEASIBLE (no geometrically valid candidate)
 *   ERROR           — harness-level throw (must never happen; nonzero exit if it does)
 *
 * For every case it also records a program-capacity diagnostic (buildable area vs
 * sum of program minArea per floor) so that NCs can later be proven "genuine"
 * (demand exceeds physical capacity) rather than placement failures.
 *
 * DXF cohort: up to 126 FEASIBLE cases are selected deterministically (stratified:
 * 42 per site class, then matrix order) and checked for:
 *   - structural validity (validateDXFStructure + parseDxf, both existing verifiers)
 *   - byte determinism: a SECOND full generate() run must produce a byte-identical DXF.
 */
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import { createProject, generate } from '../pipeline.js';
import { validateLayout } from '../validation/validator.js';
import { programForFloor } from '../programming/program.js';
import { computeBuildableGeometry } from '../site/buildable.js';
import { writeDXF, validateDXFStructure } from '../dxf/writer.js';
import { parseDxf } from '../dxf/verify.js';
import { buildStressCases, stressSites, stressPrograms, STRESS_DEFAULT_SEED, STRESS_MATRIX_SIZE } from './matrix.js';

export type StressStatus = 'FEASIBLE' | 'HARD_WINNER' | 'INFEASIBLE_NC' | 'ERROR';

export interface StressCaseReport {
  id: string;
  cohort: 'single' | 'multi';
  siteClass: string;
  status: StressStatus;
  strategy?: string;
  hardCount: number;
  hardCodes: Array<[string, number]>;
  softCount: number;
  ncReason?: string;
  capacity?: {
    buildableArea: number;
    floorMinDemand: number[];
    worstFloorRatio: number; // max demand/area over floors; > 1 ⇒ provably impossible
  };
  dxf?: {
    checked: boolean;
    valid?: boolean;
    deterministic?: boolean;
    bytes?: number;
    structureErrors?: string[];
    parserErrors?: string[];
  };
  error?: string;
}

export interface StressTotals {
  cases: number;
  feasible: number;
  hardWinners: number;
  infeasibleNc: number;
  errors: number;
}

export interface StressReport {
  kind: 'archgenius-phase15-m1-stress';
  version: 1;
  matrix: { sites: number; programs: number; cases: number; seed: number };
  config: { dxfSampleTarget: number; dxfSamplePerSiteClass: number };
  totals: StressTotals;
  byCohort: Record<string, StressTotals>;
  bySiteClass: Record<string, StressTotals>;
  hardCodeHistogram: Array<[string, number]>;
  dxf: { checked: number; valid: number; deterministic: number; failures: string[] };
  ncAudit: Array<{ id: string; worstFloorRatio: number; reason: string }>;
  hardWinnerAudit: Array<{ id: string; hardCount: number; codes: Array<[string, number]> }>;
  cases: StressCaseReport[];
  durationMs: number;
}

function histOfHard(cand: LayoutCandidate): { hardCount: number; codes: Array<[string, number]>; softCount: number } {
  const vr = validateLayout(cand);
  const hist = new Map<string, number>();
  for (const f of vr.hard) {
    const code = String(f.code);
    hist.set(code, (hist.get(code) ?? 0) + 1);
  }
  const codes = [...hist.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { hardCount: vr.hard.length, codes, softCount: vr.soft.length };
}

interface CapacityInfo { buildableArea: number; floorMinDemand: number[] }

function capacityFor(input: ProjectInput, cache: Map<string, number>): CapacityInfo {
  const siteKey = JSON.stringify(input.site);
  let buildableArea = cache.get(siteKey);
  if (buildableArea === undefined) {
    buildableArea = computeBuildableGeometry(input.site).buildableArea;
    cache.set(siteKey, buildableArea);
  }
  const floors = Math.max(1, input.building.floors);
  const isOnlyFloor = floors === 1;
  const floorMinDemand: number[] = [];
  for (let level = 0; level < floors; level++) {
    const specs = programForFloor(input.building, level, isOnlyFloor);
    floorMinDemand.push(specs.reduce((s, sp) => s + (sp.minArea ?? 0), 0));
  }
  return { buildableArea, floorMinDemand };
}

function bump(t: StressTotals, status: StressStatus): void {
  t.cases++;
  if (status === 'FEASIBLE') t.feasible++;
  else if (status === 'HARD_WINNER') t.hardWinners++;
  else if (status === 'INFEASIBLE_NC') t.infeasibleNc++;
  else t.errors++;
}

function emptyTotals(): StressTotals {
  return { cases: 0, feasible: 0, hardWinners: 0, infeasibleNc: 0, errors: 0 };
}

export interface RunStressOptions {
  /** DXF byte-validity + cross-run determinism sample size (default 126). */
  dxfSampleTarget?: number;
  /** Deterministic seed for every case (default 42). */
  seed?: number;
}

/** Stratified deterministic sample: up to cap per site class, then matrix order. */
function selectDxfSample(reports: StressCaseReport[], feasibleIdx: number[], target: number, perClass: number): number[] {
  const byClass = new Map<string, number[]>();
  for (const i of feasibleIdx) {
    const cls = reports[i].siteClass;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(i);
  }
  const picked: number[] = [];
  const classOrder = [...byClass.keys()].sort();
  // Pass 1: per-class round-robin, cap `perClass` each.
  const taken: Record<string, number> = {};
  for (;;) {
    let progressed = false;
    for (const cls of classOrder) {
      if (picked.length >= target) return picked;
      taken[cls] = taken[cls] ?? 0;
      if (taken[cls] >= perClass) continue;
      const list = byClass.get(cls)!;
      if (taken[cls] < list.length) {
        picked.push(list[taken[cls]]);
        taken[cls]++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  // Pass 2: fill from remaining feasible cases in matrix order.
  for (const i of feasibleIdx) {
    if (picked.length >= target) break;
    if (!picked.includes(i)) picked.push(i);
  }
  return picked;
}

export function runStress(opts: RunStressOptions = {}): StressReport {
  const seed = opts.seed ?? STRESS_DEFAULT_SEED;
  const dxfTarget = opts.dxfSampleTarget ?? 126;
  const started = Date.now();

  const cases = buildStressCases(seed);
  const reports: StressCaseReport[] = [];
  const totals = emptyTotals();
  const byCohort: Record<string, StressTotals> = { single: emptyTotals(), multi: emptyTotals() };
  const bySiteClass: Record<string, StressTotals> = {
    rectangle: emptyTotals(),
    'l-shape': emptyTotals(),
    polygon: emptyTotals(),
  };
  const hardHist = new Map<string, number>();
  const ncAudit: StressReport['ncAudit'] = [];
  const hardWinnerAudit: StressReport['hardWinnerAudit'] = [];
  const capCache = new Map<string, number>();
  /** Winner retained (only for sampled cases) to run the DXF determinism pass. */
  const winners = new Map<number, LayoutCandidate>();
  const inputs = new Map<number, ProjectInput>();
  const feasibleIdx: number[] = [];

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const rep: StressCaseReport = {
      id: c.id, cohort: c.cohort, siteClass: c.siteClass,
      status: 'ERROR', hardCount: 0, hardCodes: [], softCount: 0,
    };
    try {
      const prj = createProject(c.input);
      const res = generate(prj);
      rep.capacity = (() => {
        const cap = capacityFor(c.input, capCache);
        const worst = Math.max(...cap.floorMinDemand.map(d => cap.buildableArea > 0 ? d / cap.buildableArea : Infinity));
        return { ...cap, worstFloorRatio: Math.round(worst * 1000) / 1000 };
      })();
      if (!res.bestCandidate) {
        rep.status = 'INFEASIBLE_NC';
        const infeasible = res.infeasible;
        rep.ncReason = infeasible
          ? infeasible.attempts.map(a => `${a.strategy}:${a.reason}`).join(' | ')
          : 'no candidate';
        ncAudit.push({ id: c.id, worstFloorRatio: rep.capacity.worstFloorRatio, reason: rep.ncReason.slice(0, 220) });
      } else {
        const { hardCount, codes, softCount } = histOfHard(res.bestCandidate);
        rep.hardCount = hardCount;
        rep.hardCodes = codes;
        rep.softCount = softCount;
        rep.strategy = res.bestCandidate.metadata.strategy;
        if (hardCount === 0) {
          rep.status = 'FEASIBLE';
          feasibleIdx.push(ci);
          winners.set(ci, res.bestCandidate);
          inputs.set(ci, c.input);
        } else {
          rep.status = 'HARD_WINNER';
          for (const [code, n] of codes) hardHist.set(code, (hardHist.get(code) ?? 0) + n);
          hardWinnerAudit.push({ id: c.id, hardCount, codes });
        }
      }
    } catch (e: any) {
      rep.status = 'ERROR';
      rep.error = String(e?.message ?? e).slice(0, 400);
    }
    bump(totals, rep.status);
    bump(byCohort[rep.cohort], rep.status);
    bump(bySiteClass[rep.siteClass], rep.status);
    reports.push(rep);
  }

  // ---- DXF sample: structure validity + cross-run byte determinism ----
  const dxfFailures: string[] = [];
  let dxfChecked = 0, dxfValid = 0, dxfDet = 0;
  const sample = selectDxfSample(reports, feasibleIdx, dxfTarget, Math.ceil(dxfTarget / 3)).sort((a, b) => a - b);
  for (const ci of sample) {
    const rep = reports[ci];
    const cand = winners.get(ci)!;
    try {
      const dxfA = writeDXF(cand, `P15-${rep.id}`);
      const struct = validateDXFStructure(dxfA);
      const parsed = parseDxf(dxfA);
      // second full, independent generation pass — same input, same seed
      const res2 = generate(createProject(inputs.get(ci)!));
      const cand2 = res2.bestCandidate;
      const dxfB = cand2 ? writeDXF(cand2, `P15-${rep.id}`) : '';
      const deterministic = !!cand2 && dxfA === dxfB;
      const valid = struct.ok && parsed.errors.length === 0;
      rep.dxf = {
        checked: true,
        valid,
        deterministic,
        bytes: dxfA.length,
        structureErrors: struct.errors.slice(0, 8),
        parserErrors: parsed.errors.slice(0, 8),
      };
      dxfChecked++;
      if (valid) dxfValid++;
      if (deterministic) dxfDet++;
      if (!valid || !deterministic) dxfFailures.push(rep.id);
    } catch (e: any) {
      rep.dxf = { checked: true, valid: false, deterministic: false, structureErrors: [String(e?.message ?? e).slice(0, 300)] };
      dxfChecked++;
      dxfFailures.push(rep.id);
    }
  }

  return {
    kind: 'archgenius-phase15-m1-stress',
    version: 1,
    matrix: { sites: stressSites().length, programs: stressPrograms().length, cases: STRESS_MATRIX_SIZE, seed },
    config: { dxfSampleTarget: dxfTarget, dxfSamplePerSiteClass: Math.ceil(dxfTarget / 3) },
    totals,
    byCohort,
    bySiteClass,
    hardCodeHistogram: [...hardHist.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    dxf: { checked: dxfChecked, valid: dxfValid, deterministic: dxfDet, failures: dxfFailures },
    ncAudit,
    hardWinnerAudit,
    cases: reports,
    durationMs: Date.now() - started,
  };
}
