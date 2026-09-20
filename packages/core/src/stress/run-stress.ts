/**
 * Phase 15 M1 — CLI entry for the 560-case stress harness.
 *
 * Usage (from repo root, after `npm run build -w @archgenius/core`):
 *   node packages/core/dist/stress/run-stress.js
 *
 * Writes outputs/stress-report.json (gitignored) and prints a summary.
 * Exit code 0 iff no harness-level ERRORs occurred; feasibility itself is a
 * measurement, not a build failure (M2/M8 introduce the acceptance gates).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { runStress } from './stress.js';

const report = runStress({});
const here = dirname(fileURLToPath(import.meta.url));
// packages/core/dist/stress -> repo root = ../../../../ (dist, core, packages, root)
const outDir = process.env.ARCHGENIUS_STRESS_OUT ?? join(here, '..', '..', '..', '..', 'outputs');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'stress-report.json'), JSON.stringify(report, null, 2), 'utf8');

const t = report.totals;
console.log('=== ArchGenius Phase 15 M1 — 560-case stress ===');
console.log(`matrix: ${report.matrix.sites} sites x ${report.matrix.programs} programs = ${report.matrix.cases} cases (seed ${report.matrix.seed})`);
console.log(`cases:   ${t.cases}`);
console.log(`feasible:      ${t.feasible}  (${(100 * t.feasible / t.cases).toFixed(1)}%)`);
console.log(`hard-winners:  ${t.hardWinners} (${(100 * t.hardWinners / t.cases).toFixed(1)}%)`);
console.log(`NC (infeasible): ${t.infeasibleNc} (${(100 * t.infeasibleNc / t.cases).toFixed(1)}%)`);
console.log(`harness errors:  ${t.errors}`);
for (const [k, v] of Object.entries(report.byCohort)) {
  console.log(`  cohort ${k}: feasible ${v.feasible}/${v.cases}, hardWinners ${v.hardWinners}, NC ${v.infeasibleNc}, err ${v.errors}`);
}
for (const [k, v] of Object.entries(report.bySiteClass)) {
  console.log(`  site ${k}: feasible ${v.feasible}/${v.cases}, hardWinners ${v.hardWinners}, NC ${v.infeasibleNc}, err ${v.errors}`);
}
console.log(`DXF sample: checked ${report.dxf.checked}, valid ${report.dxf.valid}, deterministic ${report.dxf.deterministic}${report.dxf.failures.length ? ', failures: ' + report.dxf.failures.join(',') : ''}`);
if (report.hardCodeHistogram.length) {
  console.log('hard codes on winners (top):');
  for (const [code, n] of report.hardCodeHistogram.slice(0, 12)) console.log(`  ${code}: ${n}`);
}
console.log(`NC proven-genuine (demand > buildable): ${report.ncAudit.filter(x => x.worstFloorRatio > 1).length}/${report.ncAudit.length}`);
console.log(`report: ${join(outDir, 'stress-report.json')} (${report.durationMs} ms)`);
process.exit(t.errors === 0 ? 0 : 1);
