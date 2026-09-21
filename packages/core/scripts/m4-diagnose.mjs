/**
 * Phase 15 M4 — DIAGNOSIS ONLY (scratch, not a test).
 * Walks the full 560-case matrix, runs allStrategies generation, and classifies every
 * rejection reason + measures geometry quality of every plan (usable or not):
 *   residual, ribbon aspect, corridor efficiency, min-area slack, band capacity.
 */
import { buildStressCases } from '../dist/stress/matrix.js';
import { createProject, generate } from '../dist/pipeline.js';

const cases = buildStressCases();
const reasonFam = new Map();
const ncBySiteClass = new Map();
const quality = { n: 0, residualSum: 0, ribbons: 0, bigRooms: 0, longCorr: 0, voidCells: 0 };
const sampleBad = [];

function bump(map, k) { map.set(k, (map.get(k) ?? 0) + 1); }

for (const c of cases) {
  const prj = createProject(c.input);
  let out;
  try {
    out = generate(prj, { allStrategies: true });
  } catch (e) { bump(reasonFam, 'THROW:' + String(e.message).slice(0, 40)); continue; }
  const plans = [...(out.candidates ?? []), ...(out.infeasible?.diagnosticCandidates ?? [])];
  if (out.bestCandidate) {
    bump(reasonFam, 'FEASIBLE');
  } else {
    const att = out.infeasible?.attempts ?? [];
    for (const a of att) {
      let key;
      const r = a.reason || '';
      if (r.startsWith('below minArea')) key = 'DIM:minArea ' + /below minArea (\S+)/.exec(r)?.[1];
      else if (r.startsWith('below minLength')) key = 'DIM:minLength ' + /below minLength (\S+)/.exec(r)?.[1];
      else if (r.startsWith('below minWidth')) key = 'DIM:minWidth ' + /below minWidth (\S+)/.exec(r)?.[1];
      else if (r.includes('ARCH_PROGRAM_UNPLACED')) key = 'RULE:program-unplaced ' + (/room '([^']+)'/.exec(r)?.[1] ?? r.split(':')[1]?.trim().slice(0, 30));
      else if (r.includes('CIRC_INACCESSIBLE')) key = 'RULE:circ-inaccessible';
      else if (r.includes('CONSTRAINT_DIRECT_ACCESS')) key = 'RULE:direct-access';
      else if (r.includes('MBH4-DYL')) key = 'RULE:windowless';
      else if (r.includes('GEO_OVERLAPPING')) key = 'RULE:overlap';
      else if (r.includes('OUTSIDE')) key = 'RULE:outside-envelope';
      else key = 'OTHER:' + r.slice(0, 44);
      bump(reasonFam, key);
    }
    bump(ncBySiteClass, c.siteClass ?? 'rect');
  }
  // geometry quality across all plans (winner-focused would bias): take first plan per case
  for (const p of plans.slice(0, 1)) {
    quality.n++;
    for (const fl of p.floors) {
      const env = fl.envelopeArea ?? (c.input.site.width * c.input.site.length);
      let sum = 0;
      for (const s of fl.spaces) {
        const a = s.rect.w * s.rect.h;
        sum += a;
        const ar = Math.max(s.rect.w, s.rect.h) / Math.max(0.01, Math.min(s.rect.w, s.rect.h));
        if (ar > 4.5 && Math.min(s.rect.w, s.rect.h) < 1.9) { quality.ribbons++; if (sampleBad.length < 12) sampleBad.push({ id: c.id, strat: p.metadata.strategy, type: s.type, w: +s.rect.w.toFixed(2), h: +s.rect.h.toFixed(2), ar: +ar.toFixed(1) }); }
        const tgt = (s).targetArea ?? 0;
        if (tgt > 0 && a > tgt * 2.2) { quality.bigRooms++; if (sampleBad.length < 12) sampleBad.push({ id: c.id, strat: p.metadata.strategy, type: s.type, area: +a.toFixed(1), target: tgt }); }
        if (s.type === 'corridor' && ar > 7) quality.longCorr++;
      }
      const resid = env - sum;
      if (resid > 0.4) { quality.residualSum += resid; quality.voidCells++; }
    }
  }
}

console.log('== rejection reason families (per-strategy counts) ==');
[...reasonFam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(String(v).padStart(5), k));
console.log('NC by siteClass:', JSON.stringify([...ncBySiteClass]));
console.log('quality:', JSON.stringify({ ...quality, avgResidualPerFloor: quality.residualSum / Math.max(1, quality.voidCells) }));
console.log('sample defects:', JSON.stringify(sampleBad, null, 1).slice(0, 1500));
