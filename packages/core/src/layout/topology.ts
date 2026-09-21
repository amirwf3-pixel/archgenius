/**
 * Phase 15 M4 — Generalized band/block capacity solver.
 *
 * Pure geometry: given a band rectangle and a program demand (cells with minimum
 * width/height, minimum area and target area), decide whether the band can HOST the
 * program with architecturally sane proportions — and if so, produce per-cell sizes.
 * Nothing here knows site dimensions, strategies or cases: every decision derives
 * from the demand, so the same solver governs public bands, private bands, entry
 * sequences and the sub-rectangles of L-shape / polygon decompositions alike.
 *
 * Design rules (Phase-15 M4 directive):
 *  - cells are sized toward their TARGET area and CAPPED (capFactor·target): a band
 *    larger than its program must NOT force-feed the remainder into the last room
 *    (giant residuals) nor stretch rooms into ribbons;
 *  - leftover extent is reported as an explicit residual on the band's free end —
 *    the caller decides whether to leave it as intentional void;
 *  - infeasibility is returned as data (null): the caller repartitions (chooseSpine-
 *    Fraction) or lets the existing honest gates declare the candidate infeasible —
 *    never a silent drop and never a validator weakening.
 */

export interface BandCellDemand {
  /** stable identifier — the solver never branches on it */
  type: string;
  minWidth: number;
  minHeight: number;
  minArea: number;
  target: number;
}

export interface SolvedBandCell {
  /** extent along the band flow axis (row: width; col: height) */
  flow: number;
  /** extent along the band cross axis (uniform row height | shared band width) */
  cross: number;
}

export interface BandSolution {
  mode: 'row' | 'col';
  cells: SolvedBandCell[];
  /** total extent consumed along the flow axis */
  usedFlow: number;
  /** extent LEFT over on the flow axis — the intentional residual (0 when tiled) */
  freeFlow: number;
  /** area the cells would occupy */
  usedArea: number;
  worstAspect: number;
}

const EPS = 1e-9;
const weightOf = (c: BandCellDemand) => Math.max(c.target, c.minArea, 0.01);
const capOf = (c: BandCellDemand, capFactor: number) =>
  Math.max(c.minArea * 1.1, c.target * capFactor);

/**
 * ROW mode: cells side by side along `bandW`, sharing one height H (entry gallery row,
 * side-by-side living+dining). Feasible iff ΣminWidth ≤ bandW and the required shared
 * height fits bandH. Heights grow toward targets, capped by capFactor·target PER CELL.
 */
export function solveRow(bandW: number, bandH: number, cells: BandCellDemand[], capFactor = 1.75): BandSolution | null {
  if (cells.length === 0) return { mode: 'row', cells: [], usedFlow: 0, freeFlow: bandW, usedArea: 0, worstAspect: 1 };
  const minSum = cells.reduce((s, c) => s + c.minWidth, 0);
  if (minSum > bandW + EPS) return null;
  // a shared row height must be able to reach every cell's own minHeight somewhere in the band
  if (bandH < Math.max(...cells.map(c => c.minHeight)) - EPS) return null;
  const sumW = cells.reduce((s, c) => s + weightOf(c), 0);
  const surplus = Math.max(0, bandW - minSum);
  const flows = cells.map(c => c.minWidth + surplus * (weightOf(c) / sumW));
  const needH = Math.max(...cells.map((c, i) => Math.max(c.minHeight, c.minArea / Math.max(flows[i], 0.5))));
  if (needH > bandH + EPS) return null;
  // grow the shared height toward targets — but never above ANY cell's cap.
  const capH = Math.min(...cells.map((c, i) => capOf(c, capFactor) / Math.max(flows[i], 0.5)));
  const h = Math.min(bandH, Math.max(needH, capH));
  const sized = cells.map(() => ({ flow: 0, cross: h }));
  cells.forEach((c, i) => { sized[i].flow = flows[i]; });
  const usedFlow = flows.reduce((s, f) => s + f, 0);
  const worstAspect = Math.max(...cells.map((c, i) =>
    Math.max(flows[i], h) / Math.max(0.01, Math.min(flows[i], h))));
  return {
    mode: 'row',
    cells: sized,
    usedFlow,
    freeFlow: Math.max(0, bandW - usedFlow),
    usedArea: sized.reduce((s, x) => s + x.flow * x.cross, 0),
    worstAspect,
  };
}

/**
 * COL mode: cells stacked along `bandH`, each spanning the band width W (bedroom rows,
 * entry columns). Heights start at minimums plus target-proportional surplus, then the
 * shared width grows toward targets within per-cell caps. Band may end in freeFlow —
 * an INTENTIONAL residual the caller may keep as void instead of force-filling.
 */
export function solveCol(bandW: number, bandH: number, cells: BandCellDemand[], capFactor = 1.75): BandSolution | null {
  if (cells.length === 0) return { mode: 'col', cells: [], usedFlow: 0, freeFlow: bandH, usedArea: 0, worstAspect: 1 };
  // stacked rows share the band's width — it must satisfy every cell's own minWidth
  if (bandW < Math.max(...cells.map(c => c.minWidth)) - EPS) return null;
  const minSum = cells.reduce((s, c) => s + c.minHeight, 0);
  if (minSum > bandH + EPS) return null;
  const sumW = cells.reduce((s, c) => s + weightOf(c), 0);
  const surplus = Math.max(0, bandH - minSum);
  let flows = cells.map(c => c.minHeight + surplus * (weightOf(c) / sumW));
  // each height must reach its cell's minArea at the band width; growth stays capped
  const grew = flows.map((f, i) => Math.max(f, cells[i].minArea / Math.max(bandW, 0.5)));
  const totalGrew = grew.reduce((s, f) => s + f, 0);
  if (totalGrew > bandH + EPS) {
    // packed band: every cell at its area-need, feasible only if the needs themselves tile
    const minHs = cells.map(c => Math.max(c.minHeight, c.minArea / Math.max(bandW, 0.5)));
    const tot = minHs.reduce((s, f) => s + f, 0);
    if (tot > bandH + EPS) return null;
    // distribute the small slack by weight, never over cap
    const slack = Math.max(0, bandH - tot);
    const sw = Math.max(minHs.reduce((s, f) => s + f, 0), EPS);
    flows = minHs.map((f, i) => f + slack * (f / sw));
  } else {
    // room to breathe: cap growth at capFactor·target per cell; leftover becomes freeFlow
    const capped = flows.map((f, i) => Math.min(f, capOf(cells[i], capFactor) / Math.max(bandW, 0.5)));
    const cappedTot = capped.reduce((s, f) => s + f, 0);
    if (cappedTot >= minSum - EPS && cappedTot <= bandH + EPS) flows = capped;
  }
  const usedFlow = flows.reduce((s, f) => s + f, 0);
  const worstAspect = Math.max(...flows.map((f, i) =>
    Math.max(bandW, f) / Math.max(0.01, Math.min(bandW, f))));
  return {
    mode: 'col',
    cells: flows.map(f => ({ flow: f, cross: bandW })),
    usedFlow,
    freeFlow: Math.max(0, bandH - usedFlow),
    usedArea: flows.reduce((s, f) => s + f * bandW, 0),
    worstAspect,
  };
}

/**
 * Choose the better placement for a band (deterministic): prefer aspects within
 * maxAspect, then smaller residual. Null when the band cannot host the program at all.
 */
export function solveBand(
  bandW: number,
  bandH: number,
  cells: BandCellDemand[],
  opts: { capFactor?: number; maxAspect?: number } = {},
): BandSolution | null {
  const cap = opts.capFactor ?? 1.75;
  const maxAspect = opts.maxAspect ?? 4.5;
  const row = solveRow(bandW, bandH, cells, cap);
  const col = solveCol(bandW, bandH, cells, cap);
  const cands = [row, col].filter((s): s is BandSolution => !!s);
  if (cands.length === 0) return null;
  const area = Math.max(bandW * bandH, 0.01);
  const score = (s: BandSolution) =>
    (s.worstAspect > maxAspect ? 1000 + (s.worstAspect - maxAspect) : 0) +
    (s.freeFlow > 0 ? 10 + Math.min(4, s.freeFlow) : 0) *
      Math.min(1, (bandW * bandH - s.usedArea) / area * 3 + 0.3);
  return [...cands].sort((a, b) => (score(a) - score(b)) || (a.mode === 'row' ? -1 : 1))[0];
}

/**
 * Enumerate the quantized ladder and return the FEASIBLE fraction minimizing `score`
 * (typically |bandArea − program demand| summed over both bands — a fit measure that
 * stops partition slack from becoming giant rooms or voids). Ties resolve to the
 * candidate closest to `home`, then to the lower fraction — fully deterministic.
 */

/** Can a band host this program at all, in either orientation? (ladder feasibility test) */
export function bandCanHost(bandW: number, bandH: number, cells: BandCellDemand[], capFactor = 1.75): boolean {
  return !!solveRow(bandW, bandH, cells, capFactor) || !!solveCol(bandW, bandH, cells, capFactor);
}

/**
 * Deterministic spine/corridor fraction search for band REPARTITIONING: scan a fixed
 * quantized ladder around the strategy default and return the first fraction where
 * `test(f)` is feasible for ALL bands, preferring the closest to `home`. When nothing
 * fits, `home` is returned and the caller's existing honest failure path reports it.
 */
export function chooseSpineFraction(
  home: number,
  test: (fraction: number) => boolean,
  opts: { lo?: number; hi?: number; step?: number } = {},
): number {
  const lo = opts.lo ?? 0.34, hi = opts.hi ?? 0.66, step = opts.step ?? 0.02;
  if (test(home)) return home;
  const maxDelta = Math.max(home - lo, hi - home);
  const seen = new Set<number>([home]);
  for (let d = step; d <= maxDelta + EPS; d += step) {
    for (const cand of [home + d, home - d]) {
      const f = Math.round(Math.min(hi, Math.max(lo, cand)) * 1000) / 1000;
      if (seen.has(f)) continue;
      seen.add(f);
      if (test(f)) return f;
    }
  }
  return home;
}
