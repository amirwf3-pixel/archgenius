#!/usr/bin/env node
/**
 * Layout regression harness (Task 187) — compares a BASELINE build against a CANDIDATE
 * build using identical inputs, seeds and options, over:
 *
 *   • BENCHMARK — 128 rows: the Task 135 benchmark (src/generator/stair-connector-hard-
 *     reduction.test.ts), i.e. 32 inputs × 4 strategies via
 *     generateLayouts(input, STRATS, CURRENT), plus the pipeline best candidate
 *     (generate(createProject(input), { ...CURRENT, allStrategies: true })).
 *   • SWEEP — 560 cases: the Phase 15 stress matrix (src/stress/matrix.ts), each run via
 *     generateLayouts(input, STRATS, { upperFloorFrontPrivate: true }) (the options that
 *     generate() passes by default) for per-strategy rows, plus
 *     generate(createProject(input), { allStrategies: true }) for status / best candidate.
 *
 *   The historical ad-hoc sweep (lost /tmp scripts) reported 564 cases; only the 560
 *   matrix cases are reproducible from the repository. The 4 missing cases are
 *   intentionally EXCLUDED — never reconstructed or invented.
 *
 * Inputs come from the WORKING TREE build (packages/core/dist/regression/layout-cases.js),
 * are serialised once, and a deep clone of the same JSON is fed to both builds.
 *
 * Per row / case it records: validity, HARD count, HARD code counts, snapshot + geometry
 * hashes (metadata.generatedAt zeroed), parking stalls (placed / requested), stair
 * footprints + stair-hall rects per floor and core alignment across floors, and for the
 * best candidate an R12 DXF check ($ACADVER AC1009, validateDXFStructure) + DXF hash.
 * Every build is evaluated TWICE; any difference between the two runs is a determinism
 * failure.
 *
 * Flags (exit code 1): valid→invalid, HARD increase, new HARD code, parking stall loss,
 * stair loss / core-alignment loss, missing row, FEASIBLE→INFEASIBLE, best-candidate HARD
 * increase / parking loss / stair loss, non-R12 DXF, non-determinism.
 * Reported but not flagged: changed rows, best-candidate identity/geometry changes and
 * improvements.
 *
 * Usage (from the repo root, after `npm run build`):
 *   node packages/core/scripts/layout-regression.mjs --baseline <ref> --candidate <ref>
 *        [--suite bench|sweep|all] [--out <report.json>]
 *   Refs are git commits (built into $TMPDIR/archgenius-layout-regression/<sha>, reused if
 *   present); pass a path to an existing `packages/core/dist` directory instead with
 *   --baseline-dist / --candidate-dist.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, '..');
const ROOT = resolve(CORE, '..', '..');

// ------------------------------------------------------------------------------ args
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
  args[a.slice(2)] = process.argv[++i];
}
const suite = args.suite ?? 'all';
if (!['bench', 'sweep', 'all'].includes(suite)) throw new Error('--suite must be bench|sweep|all');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

function buildRef(ref) {
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  const dir = join(tmpdir(), 'archgenius-layout-regression', sha);
  const dist = join(dir, 'packages', 'core', 'dist');
  if (existsSync(join(dist, 'pipeline.js'))) return { ref, sha, dist };
  mkdirSync(dir, { recursive: true });
  execFileSync('sh', ['-c', `git archive ${sha} packages/core tsconfig.base.json | tar -x -C "${dir}"`], { cwd: ROOT, stdio: 'inherit' });
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(dir, 'packages', 'core', 'tsconfig.json')], { stdio: 'inherit' });
  return { ref, sha, dist };
}
function resolveBuild(kind) {
  if (args[`${kind}-dist`]) return { ref: args[`${kind}-dist`], sha: null, dist: resolve(args[`${kind}-dist`]) };
  if (!args[kind]) throw new Error(`--${kind} <ref> (or --${kind}-dist <dir>) is required`);
  return buildRef(args[kind]);
}

// ------------------------------------------------------------------------------ helpers
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const clone = x => JSON.parse(JSON.stringify(x));
const r3 = v => Math.round(v * 1000) / 1000;
const rectKey = r => r ? [r3(r.x), r3(r.y), r3(r.w), r3(r.h)].join(',') : null;
const snapshot = c => JSON.stringify({ ...c, metadata: { ...c.metadata, generatedAt: 0 } });

function hardCodes(c) {
  const m = {};
  for (const f of c.findings) if (f.severity === 'hard') m[f.code] = (m[f.code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
}
function stairInfo(c) {
  const floors = c.floors.map(f => ({
    level: f.level,
    stairs: f.stairs.map(s => rectKey(s.footprint)).sort(),
    halls: f.spaces.filter(s => s.type === 'stair-hall').map(s => rectKey(s.rect)).sort(),
  }));
  const withStair = floors.filter(f => f.stairs.length > 0);
  const key = f => JSON.stringify([f.stairs, f.halls]);
  return {
    hasStair: withStair.length > 0,
    stairFloors: withStair.length,
    // Core alignment: every floor carrying a stair has the same stair footprint(s) and stair hall(s).
    coreAligned: withStair.length > 0 && withStair.every(f => key(f) === key(withStair[0])),
    floors,
  };
}
function candidateRecord(c) {
  const g0 = c.floors[0];
  const st = stairInfo(c);
  return {
    candId: c.id,
    strategy: c.metadata.strategy,
    valid: c.valid,
    hard: c.findings.filter(f => f.severity === 'hard').length,
    hardCodes: hardCodes(c),
    snapHash: sha(snapshot(c)),
    geomHash: sha(JSON.stringify(c.floors)),
    stalls: g0?.parkingStalls.length ?? 0,
    stallRects: (g0?.parkingStalls ?? []).map(s => rectKey(s.rect)),
    parkingRequested: g0?.parkingRequested ?? null,
    hasStair: st.hasStair,
    stairFloors: st.stairFloors,
    coreAligned: st.coreAligned,
    stairGeom: st.floors,
  };
}

// ------------------------------------------------------------------------------ evaluation
async function loadBuild(dist) {
  const u = p => pathToFileURL(join(dist, p)).href;
  const pipeline = await import(u('pipeline.js'));
  const writer = await import(u('dxf/writer.js'));
  return { ...pipeline, validateDXFStructure: writer.validateDXFStructure };
}

function bestRecord(api, res) {
  const b = res.bestCandidate;
  if (!b) return { status: 'INFEASIBLE', infeasibleCode: res.infeasible?.code ?? null };
  const dxf = api.writeDXF(b, 'ArchGenius Plan');
  const v = api.validateDXFStructure(dxf);
  return {
    status: 'FEASIBLE',
    ...candidateRecord(b),
    dxf: {
      acadver: /\$ACADVER\r?\n\s*1\r?\nAC1009\r?\n/.test(dxf) ? 'AC1009' : 'OTHER',
      structureOk: v.ok === true && v.errors.length === 0,
      hash: sha(dxf),
      bytes: dxf.length,
    },
  };
}

function evaluate(api, cases, sets) {
  const out = {};
  if (sets.bench) {
    const rows = [], best = [];
    for (const c of sets.bench.inputs) {
      for (const k of api.generateLayouts(clone(c.input), [...sets.bench.strategies], { ...sets.bench.options })) {
        rows.push({ id: `${c.id}/${k.metadata.strategy}`, ...candidateRecord(k) });
      }
      const res = api.generate(api.createProject(clone(c.input)), { ...sets.bench.options, allStrategies: true });
      best.push({ id: c.id, ...bestRecord(api, res) });
    }
    out.bench = { rows, best };
  }
  if (sets.sweep) {
    const rows = [], best = [];
    for (const c of sets.sweep.inputs) {
      for (const k of api.generateLayouts(clone(c.input), [...sets.sweep.strategies], { upperFloorFrontPrivate: true })) {
        rows.push({ id: `${c.id}/${k.metadata.strategy}`, ...candidateRecord(k) });
      }
      const res = api.generate(api.createProject(clone(c.input)), { allStrategies: true });
      best.push({ id: c.id, ...bestRecord(api, res) });
    }
    out.sweep = { rows, best };
  }
  return out;
}

// ------------------------------------------------------------------------------ comparison
function totals(rows, best) {
  const hc = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.hardCodes)) hc[k] = (hc[k] ?? 0) + n;
  const perStrategy = {};
  for (const r of rows) {
    const s = (perStrategy[r.strategy] ??= { rows: 0, valid: 0, hard: 0 });
    s.rows++; if (r.valid) s.valid++; s.hard += r.hard;
  }
  const feas = best.filter(b => b.status === 'FEASIBLE');
  return {
    rows: rows.length,
    valid: rows.filter(r => r.valid).length,
    hard: rows.reduce((s, r) => s + r.hard, 0),
    perStrategy,
    hardCodes: Object.fromEntries(Object.entries(hc).sort(([a], [b]) => a.localeCompare(b))),
    stalls: rows.reduce((s, r) => s + r.stalls, 0),
    cases: best.length,
    feasible: feas.length,
    infeasible: best.length - feas.length,
    bestStalls: feas.reduce((s, b) => s + b.stalls, 0),
    bestDxfAC1009: feas.filter(b => b.dxf.acadver === 'AC1009' && b.dxf.structureOk).length,
  };
}

function compare(base, cand) {
  const regressions = [], improvements = [], changes = [];
  const reg = (kind, id, detail) => regressions.push({ kind, id, detail });
  const bRows = new Map(base.rows.map(r => [r.id, r]));
  const cRows = new Map(cand.rows.map(r => [r.id, r]));
  for (const [id, b] of bRows) {
    const c = cRows.get(id);
    if (!c) { reg('missing-row', id, 'row absent in candidate'); continue; }
    if (b.snapHash !== c.snapHash) changes.push(id);
    if (b.valid && !c.valid) reg('valid→invalid', id, '');
    if (!b.valid && c.valid) improvements.push({ kind: 'invalid→valid', id });
    if (c.hard > b.hard) reg('hard-increase', id, `${b.hard}→${c.hard}`);
    if (c.hard < b.hard) improvements.push({ kind: 'hard-decrease', id, detail: `${b.hard}→${c.hard}` });
    const nc = Object.keys(c.hardCodes).filter(k => !(k in b.hardCodes));
    if (nc.length) reg('new-hard-code', id, nc.join(','));
    for (const [k, n] of Object.entries(c.hardCodes)) if (k in b.hardCodes && n > b.hardCodes[k]) reg('hard-code-increase', id, `${k} ${b.hardCodes[k]}→${n}`);
    if (c.stalls < b.stalls) reg('parking-loss', id, `${b.stalls}→${c.stalls}`);
    if (b.hasStair && !c.hasStair) reg('stair-loss', id, '');
    if (c.stairFloors < b.stairFloors) reg('stair-floor-loss', id, `${b.stairFloors}→${c.stairFloors}`);
    if (b.coreAligned && !c.coreAligned) reg('core-alignment-loss', id, '');
  }
  for (const id of cRows.keys()) if (!bRows.has(id)) changes.push(`${id} (new row)`);

  const bBest = new Map(base.best.map(r => [r.id, r]));
  const bestChanges = [];
  let dxfIdentical = 0;
  for (const c of cand.best) {
    const b = bBest.get(c.id);
    if (!b) { reg('missing-case', c.id, ''); continue; }
    if (c.status === 'FEASIBLE' && c.dxf.acadver !== 'AC1009') reg('dxf-not-r12', c.id, c.dxf.acadver);
    if (c.status === 'FEASIBLE' && !c.dxf.structureOk) reg('dxf-structure', c.id, '');
    if (b.status === 'FEASIBLE' && c.status !== 'FEASIBLE') { reg('best:feasible→infeasible', c.id, c.infeasibleCode ?? ''); continue; }
    if (b.status !== 'FEASIBLE' && c.status === 'FEASIBLE') { improvements.push({ kind: 'best:infeasible→feasible', id: c.id, detail: c.strategy }); continue; }
    if (b.status !== 'FEASIBLE') { if (b.infeasibleCode !== c.infeasibleCode) bestChanges.push({ id: c.id, detail: `infeasible ${b.infeasibleCode}→${c.infeasibleCode}` }); continue; }
    if (c.hard > b.hard) reg('best:hard-increase', c.id, `${b.hard}→${c.hard}`);
    if (c.stalls < b.stalls) reg('best:parking-loss', c.id, `${b.stalls}→${c.stalls}`);
    if (b.hasStair && !c.hasStair) reg('best:stair-loss', c.id, '');
    if (b.coreAligned && !c.coreAligned) reg('best:core-alignment-loss', c.id, '');
    if (b.dxf.hash === c.dxf.hash) dxfIdentical++;
    if (b.strategy !== c.strategy || b.geomHash !== c.geomHash) {
      bestChanges.push({ id: c.id, detail: `${b.strategy}/${b.geomHash} → ${c.strategy}/${c.geomHash}` });
    }
  }
  return { regressions, improvements, changedRows: changes, bestChanges, bestDxfIdentical: dxfIdentical };
}

function determinism(a, b) {
  const diff = [];
  for (const key of ['rows', 'best']) {
    const x = a[key], y = b[key];
    if (x.length !== y.length) { diff.push(`${key}: length ${x.length}≠${y.length}`); continue; }
    for (let i = 0; i < x.length; i++) if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) diff.push(`${key}: ${x[i].id}`);
  }
  return diff;
}

// ------------------------------------------------------------------------------ main
const casesModule = join(CORE, 'dist', 'regression', 'layout-cases.js');
if (!existsSync(casesModule)) throw new Error(`${casesModule} missing — run \`npm run build\` first`);
const cases = await import(pathToFileURL(casesModule).href);
const sets = {};
if (suite !== 'sweep') sets.bench = { inputs: clone(cases.benchmarkInputs()), strategies: [...cases.BENCHMARK_STRATEGIES], options: { ...cases.BENCHMARK_OPTIONS } };
if (suite !== 'bench') sets.sweep = { inputs: clone(cases.sweepInputs()), strategies: [...cases.BENCHMARK_STRATEGIES] };
const inputHash = sha(JSON.stringify(sets));

const baseline = resolveBuild('baseline');
const candidate = resolveBuild('candidate');
const report = {
  kind: 'archgenius-layout-regression', version: 1,
  baseline: { ref: baseline.ref, sha: baseline.sha }, candidate: { ref: candidate.ref, sha: candidate.sha },
  inputHash,
  caseSet: {
    benchmarkRows: sets.bench ? sets.bench.inputs.length * sets.bench.strategies.length : 0,
    sweepCases: sets.sweep ? sets.sweep.inputs.length : 0,
    historicalSweepCases: cases.HISTORICAL_SWEEP_CASE_COUNT,
    excludedHistoricalSweepCases: cases.SWEEP_EXCLUDED_HISTORICAL_CASES,
    note: 'Historical sweep reported 564 cases; only the 560 stress-matrix cases are reproducible from the repository; the 4 missing cases are intentionally excluded.',
  },
  suites: {},
};

const results = {};
for (const [name, b] of [['baseline', baseline], ['candidate', candidate]]) {
  const api = await loadBuild(b.dist);
  const t0 = Date.now();
  const run1 = evaluate(api, cases, clone(sets));
  const run2 = evaluate(api, cases, clone(sets));
  results[name] = { run1, run2, ms: Date.now() - t0 };
  console.error(`[layout-regression] ${name} ${b.sha ?? b.ref} evaluated twice in ${Math.round((Date.now() - t0) / 1000)} s`);
}

let failed = false;
for (const s of Object.keys(sets)) {
  const B = results.baseline.run1[s], C = results.candidate.run1[s];
  const detB = determinism(B, results.baseline.run2[s]);
  const detC = determinism(C, results.candidate.run2[s]);
  const cmp = compare(B, C);
  const suiteReport = {
    totals: { baseline: totals(B.rows, B.best), candidate: totals(C.rows, C.best) },
    determinism: { baseline: detB.length === 0, candidate: detC.length === 0, baselineDiffs: detB, candidateDiffs: detC },
    ...cmp,
    baselineRows: B.rows, candidateRows: C.rows, baselineBest: B.best, candidateBest: C.best,
  };
  report.suites[s] = suiteReport;
  if (cmp.regressions.length || detB.length || detC.length) failed = true;

  const tb = suiteReport.totals.baseline, tc = suiteReport.totals.candidate;
  console.log(`\n=== ${s.toUpperCase()} (${tb.rows} rows, ${tb.cases} cases; inputHash ${inputHash})`);
  console.log(`rows valid        ${tb.valid} → ${tc.valid}`);
  console.log(`rows HARD         ${tb.hard} → ${tc.hard}`);
  for (const k of Object.keys(tb.perStrategy)) {
    const x = tb.perStrategy[k], y = tc.perStrategy[k] ?? { valid: 0, hard: 0 };
    console.log(`  ${k.padEnd(24)} valid ${x.valid}→${y.valid}  HARD ${x.hard}→${y.hard}`);
  }
  const codes = [...new Set([...Object.keys(tb.hardCodes), ...Object.keys(tc.hardCodes)])].sort();
  console.log(`HARD codes        ${codes.map(k => `${k} ${tb.hardCodes[k] ?? 0}→${tc.hardCodes[k] ?? 0}`).join('; ') || '(none)'}`);
  console.log(`row stalls        ${tb.stalls} → ${tc.stalls}`);
  console.log(`best feasible     ${tb.feasible} → ${tc.feasible} (infeasible ${tb.infeasible} → ${tc.infeasible})`);
  console.log(`best stalls       ${tb.bestStalls} → ${tc.bestStalls}`);
  console.log(`best DXF R12 ok   ${tb.bestDxfAC1009}/${tb.feasible} → ${tc.bestDxfAC1009}/${tc.feasible}; byte-identical best DXF ${cmp.bestDxfIdentical}`);
  console.log(`determinism       baseline ${detB.length === 0 ? 'OK' : `FAIL (${detB.length})`}, candidate ${detC.length === 0 ? 'OK' : `FAIL (${detC.length})`}`);
  console.log(`changed rows      ${cmp.changedRows.length}${cmp.changedRows.length ? ': ' + cmp.changedRows.join(', ') : ''}`);
  console.log(`best changes      ${cmp.bestChanges.length}${cmp.bestChanges.length ? ': ' + cmp.bestChanges.map(x => `${x.id} [${x.detail}]`).join('; ') : ''}`);
  console.log(`improvements      ${cmp.improvements.length}${cmp.improvements.length ? ': ' + cmp.improvements.map(x => `${x.kind} ${x.id}${x.detail ? ` (${x.detail})` : ''}`).join('; ') : ''}`);
  console.log(`REGRESSIONS       ${cmp.regressions.length}${cmp.regressions.length ? ':\n  ' + cmp.regressions.map(x => `${x.kind} ${x.id} ${x.detail}`).join('\n  ') : ''}`);
}

const outPath = resolve(args.out ?? join(ROOT, 'outputs', `layout-regression-${(baseline.sha ?? 'base').slice(0, 7)}-${(candidate.sha ?? 'cand').slice(0, 7)}.json`));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`\nreport: ${outPath}`);
console.log(failed ? 'RESULT: REGRESSION' : 'RESULT: NO REGRESSION');
process.exit(failed ? 1 : 0);
