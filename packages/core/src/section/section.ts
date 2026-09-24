/**
 * Multi-section details — deterministic 2D building sections derived ONLY from
 * the authoritative model (candidate.floors). No AI coordinates, no invented
 * data: every entity below is computed from fields the model already carries.
 *
 * A section is a vertical cut plane:
 *   axis 'x' — the plane x = at; the section's horizontal coordinate u = plan y.
 *   axis 'y' — the plane y = at; the section's horizontal coordinate u = plan x.
 * The vertical coordinate z is height above the model origin (Floor.elevation).
 *
 * Represented relationships (what the model provides):
 *   - storey levels      Floor.elevation / Floor.floorHeight → level lines
 *   - cut walls          Wall centreline + thickness → solid band over the storey
 *   - openings in walls  Opening.sill / Opening.height → gap in the cut band
 *   - stairs             StairFlight riser/tread/startPoint/endPoint → riser-tread
 *                        profile; StairLanding footprint → landing at its level
 *   - lift shafts        Elevator.rect → shaft outline per storey
 *
 * NOT represented (the model has no data, so nothing is drawn or assumed):
 * slab/finish thickness, roof, parapet, foundation, ceiling. Storey levels are
 * therefore drawn as level LINES, not slabs.
 *
 * Findings from validateSection are geometric-consistency checks on the
 * section itself. They are not regulatory checks and make no compliance claim.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Wall } from '../model/wall.js';
import type { Rect } from '../geometry/rect.js';
import type { Vec2 } from '../geometry/vec2.js';
import type { Finding } from '../validation/types.js';

export type SectionAxis = 'x' | 'y';

export interface SectionCut {
  /** Section identifier, e.g. 'A' → "SECTION A-A". */
  id: string;
  /** 'x' → cut plane x = at; 'y' → cut plane y = at (plan metres). */
  axis: SectionAxis;
  at: number;
}

/** Axis-aligned rectangle in section coordinates (u horizontal, z vertical), metres. */
export interface SectionRect { u0: number; u1: number; z0: number; z1: number }
export interface SectionPoint { u: number; z: number }

export interface SectionLevel { floor: number; z: number; u0: number; u1: number; label: string }
export interface SectionWallCut { wallId: string; kind: Wall['kind']; floor: number; solids: SectionRect[] }
export interface SectionOpeningCut { openingId: string; wallId: string; type: string; floor: number; rect: SectionRect }
export interface SectionFlightProfile { stairId: string; flightId: string; floor: number; points: SectionPoint[] }
export interface SectionLandingCut { stairId: string; landingId: string; floor: number; z: number; u0: number; u1: number }
export interface SectionLiftCut { elevatorId: string; floor: number; rect: SectionRect }

export interface SectionDrawing {
  cut: SectionCut;
  levels: SectionLevel[];
  walls: SectionWallCut[];
  openings: SectionOpeningCut[];
  flights: SectionFlightProfile[];
  landings: SectionLandingCut[];
  lifts: SectionLiftCut[];
  /** Horizontal extent of the cut building (u) and vertical extent (z); null when nothing is cut. */
  extent: { u0: number; u1: number; z0: number; z1: number } | null;
  findings: Finding[];
}

const EPS = 1e-6;
/** Stair rise vs storey height tolerance (m) — numerical, not a design threshold. */
const RISE_TOL = 0.005;
const LEVEL_TOL = 0.001;
const round = (v: number) => Math.round(v * 1e6) / 1e6;
const fmtLevel = (z: number) => `${z >= 0 ? '+' : '-'}${Math.abs(z).toFixed(2)}`;

/** Coordinate along the cut plane (u) of a plan point. */
const uOf = (axis: SectionAxis, p: Vec2) => (axis === 'x' ? p.y : p.x);
/** Coordinate across the cut plane (the plane's normal direction) of a plan point. */
const nOf = (axis: SectionAxis, p: Vec2) => (axis === 'x' ? p.x : p.y);
const rectU = (axis: SectionAxis, r: Rect): [number, number] => (axis === 'x' ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
const rectN = (axis: SectionAxis, r: Rect): [number, number] => (axis === 'x' ? [r.x, r.x + r.w] : [r.y, r.y + r.h]);
/** True when the plane strictly passes through the rect's interior. */
const planeCrossesRect = (cut: SectionCut, r: Rect) => {
  const [a, b] = rectN(cut.axis, r);
  return cut.at > a + EPS && cut.at < b - EPS;
};

function finding(code: string, severity: Finding['severity'], message: string, entityIds?: string[]): Finding {
  return entityIds && entityIds.length ? { code, severity, message, entityIds } : { code, severity, message };
}

/** Walls parallel to the plane whose thickness band contains the plane (the cut would run inside the wall). */
function wallsAlongCut(floor: Floor, cut: SectionCut): Wall[] {
  return floor.walls.filter((w) => {
    const dn = Math.abs(nOf(cut.axis, w.end) - nOf(cut.axis, w.start));
    if (dn > EPS) return false; // not parallel to the plane
    const du = Math.abs(uOf(cut.axis, w.end) - uOf(cut.axis, w.start));
    if (du <= EPS) return false; // degenerate wall
    return Math.abs(nOf(cut.axis, w.start) - cut.at) < w.thickness / 2 - EPS;
  });
}

/** Intersection of the plane with a wall: the u of the cut point and the band width along u. */
function wallCrossing(w: Wall, cut: SectionCut): { u: number; halfU: number; point: Vec2 } | null {
  const n0 = nOf(cut.axis, w.start), n1 = nOf(cut.axis, w.end);
  const dn = n1 - n0;
  if (Math.abs(dn) <= EPS) return null; // parallel — not crossed
  const t = (cut.at - n0) / dn;
  if (t < -EPS || t > 1 + EPS) return null;
  const u0 = uOf(cut.axis, w.start), u1 = uOf(cut.axis, w.end);
  const u = u0 + t * (u1 - u0);
  const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  if (!(len > EPS) || !(w.thickness > 0)) return null;
  // Band width along u = thickness / |cos| of the wall direction vs the plane normal.
  const halfU = (w.thickness / 2) / (Math.abs(dn) / len);
  const point: Vec2 = cut.axis === 'x' ? { x: cut.at, y: u } : { x: u, y: cut.at };
  return { u, halfU, point };
}

/** Subtract [a,b] intervals from [lo,hi]; returns the remaining solid intervals. */
function subtractIntervals(lo: number, hi: number, holes: Array<[number, number]>): Array<[number, number]> {
  const sorted = holes
    .map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number])
    .filter(([a, b]) => b - a > EPS)
    .sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let cur = lo;
  for (const [a, b] of sorted) {
    if (a - cur > EPS) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (hi - cur > EPS) out.push([cur, hi]);
  return out;
}

/**
 * Compute one section from the model. Pure and deterministic. Geometry is
 * emitted only where the model provides it; findings report invalid or
 * missing section geometry (see validateSection).
 */
export function computeSection(candidate: LayoutCandidate, cut: SectionCut): SectionDrawing {
  const out: SectionDrawing = { cut, levels: [], walls: [], openings: [], flights: [], landings: [], lifts: [], extent: null, findings: [] };
  const F = out.findings;
  const floors = candidate?.floors ?? [];
  const tag = `Section ${cut?.id ?? '?'}`;

  if (!cut || (cut.axis !== 'x' && cut.axis !== 'y') || !Number.isFinite(cut.at) || typeof cut.id !== 'string' || cut.id.trim() === '') {
    F.push(finding('SECTION_INVALID_CUT', 'hard', `${tag}: the cut must have a non-empty id, axis 'x' or 'y' and a finite coordinate.`));
    return out;
  }
  if (floors.length === 0) {
    F.push(finding('SECTION_NO_FLOORS', 'hard', `${tag}: the model has no floors — there is nothing to section.`));
    return out;
  }

  // ---- storey levels must be usable and stack consistently ----
  let levelsOk = true;
  floors.forEach((f, i) => {
    if (!Number.isFinite(f.elevation) || !Number.isFinite(f.floorHeight) || !(f.floorHeight > 0)) {
      levelsOk = false;
      F.push(finding('SECTION_LEVEL_INVALID', 'hard', `${tag}: floor ${f.level} has a missing or non-positive storey height / elevation (elevation=${f.elevation}, floorHeight=${f.floorHeight}).`));
      return;
    }
    if (i > 0) {
      const prev = floors[i - 1];
      const expected = prev.elevation + prev.floorHeight;
      if (Number.isFinite(expected) && Math.abs(f.elevation - expected) > LEVEL_TOL) {
        levelsOk = false;
        F.push(finding('SECTION_LEVEL_INVALID', 'hard', `${tag}: floor ${f.level} elevation ${f.elevation.toFixed(3)} m does not equal floor ${prev.level} elevation + storey height (${expected.toFixed(3)} m).`));
      }
    }
  });
  if (!levelsOk) return out;

  // ---- the plane must not run inside a wall (ambiguous cut) ----
  for (const f of floors) {
    const along = wallsAlongCut(f, cut);
    if (along.length) {
      F.push(finding('SECTION_CUT_ALONG_WALL', 'hard', `${tag}: the cut ${cut.axis} = ${cut.at} m runs inside wall(s) ${along.map((w) => w.id).join(', ')} on floor ${f.level}; move the cut off the wall.`, along.map((w) => w.id)));
    }
  }
  if (F.some((x) => x.severity === 'hard')) return out;

  let uMin = Infinity, uMax = -Infinity;
  const zMin = floors[0].elevation;
  let zMax = -Infinity;

  floors.forEach((f, fi) => {
    const z0 = f.elevation, z1 = f.elevation + f.floorHeight;
    let fu0 = Infinity, fu1 = -Infinity;

    // ---- walls + openings ----
    const walls = [...f.walls].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const w of walls) {
      const x = wallCrossing(w, cut);
      if (!x) continue;
      const u0 = round(x.u - x.halfU), u1 = round(x.u + x.halfU);
      fu0 = Math.min(fu0, u0); fu1 = Math.max(fu1, u1);
      const holes: Array<[number, number]> = [];
      const ops = f.openings.filter((o) => o.wallId === w.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const o of ops) {
        const s = (x.point.x - o.center.x) * o.wallDir.x + (x.point.y - o.center.y) * o.wallDir.y;
        if (Math.abs(s) >= o.width / 2 - EPS) continue; // plane misses this opening
        const sill = o.sill, head = o.sill + o.height;
        if (!Number.isFinite(sill) || !Number.isFinite(o.height) || sill < -EPS || !(o.height > 0) || head > f.floorHeight + LEVEL_TOL) {
          F.push(finding('SECTION_OPENING_OUT_OF_STOREY', 'hard', `${tag}: opening ${o.id} (sill ${sill}, height ${o.height}) does not fit inside floor ${f.level}'s storey height ${f.floorHeight} m.`, [o.id, w.id]));
          continue;
        }
        const oz0 = round(z0 + sill), oz1 = round(Math.min(z0 + head, z1));
        holes.push([oz0, oz1]);
        out.openings.push({ openingId: o.id, wallId: w.id, type: o.type, floor: f.level, rect: { u0, u1, z0: oz0, z1: oz1 } });
      }
      const solids = subtractIntervals(z0, z1, holes).map(([a, b]) => ({ u0, u1, z0: round(a), z1: round(b) }));
      out.walls.push({ wallId: w.id, kind: w.kind, floor: f.level, solids });
    }

    // ---- stairs: a stair on floor fi rises to floor fi+1 (profiled only when that floor exists) ----
    const next = floors[fi + 1];
    for (const st of f.stairs ?? []) {
      if (!next) continue;
      const flights = st.flights ?? [];
      const cum: number[] = [];
      let acc = 0;
      for (const fl of flights) { cum.push(acc); acc += fl.riserCount * fl.riserHeight; }
      let stairCut = false;
      flights.forEach((fl, k) => {
        if (!fl.footprint || !planeCrossesRect(cut, fl.footprint)) return;
        stairCut = true;
        const runsAlongU = cut.axis === 'x' ? fl.direction === 'north' || fl.direction === 'south' : fl.direction === 'east' || fl.direction === 'west';
        if (!runsAlongU) {
          F.push(finding('SECTION_STAIR_NOT_PROFILED', 'advisory', `${tag}: the cut crosses stair flight ${fl.id} across its run, so no riser/tread profile is drawn for it; cut along the flight to profile it.`, [st.id, fl.id]));
          return;
        }
        const us = uOf(cut.axis, fl.startPoint), ue = uOf(cut.axis, fl.endPoint);
        const dir = ue >= us ? 1 : -1;
        let u = us, z = z0 + cum[k];
        const pts: SectionPoint[] = [{ u: round(u), z: round(z) }];
        const treads = Math.min(fl.treadCount, fl.riserCount);
        for (let r = 0; r < fl.riserCount; r++) {
          z += fl.riserHeight;
          pts.push({ u: round(u), z: round(z) });
          if (r < treads) { u += dir * fl.treadDepth; pts.push({ u: round(u), z: round(z) }); }
        }
        out.flights.push({ stairId: st.id, flightId: fl.id, floor: f.level, points: pts });
        for (const p of pts) { fu0 = Math.min(fu0, p.u); fu1 = Math.max(fu1, p.u); }
      });
      (st.landings ?? []).forEach((ld, k) => {
        if (!ld.footprint || !planeCrossesRect(cut, ld.footprint)) return;
        stairCut = true;
        // Landing level = top of the lowest connected flight (fallback: flight k).
        const idx = flights
          .map((fl, i) => ((ld.connectedFlightIds ?? []).includes(fl.id) ? i : -1))
          .filter((i) => i >= 0);
        const below = idx.length ? Math.min(...idx) : Math.min(k, flights.length - 1);
        if (below < 0) return;
        const z = round(z0 + cum[below] + flights[below].riserCount * flights[below].riserHeight);
        const [a, b] = rectU(cut.axis, ld.footprint);
        out.landings.push({ stairId: st.id, landingId: ld.id, floor: f.level, z, u0: round(a), u1: round(b) });
      });
      if (stairCut) {
        const storey = next.elevation - f.elevation;
        if (Math.abs(acc - storey) > RISE_TOL) {
          F.push(finding('SECTION_STAIR_RISE_MISMATCH', 'hard', `${tag}: stair ${st.id} rises ${acc.toFixed(3)} m (Σ risers × riser height) but floor ${f.level} → ${next.level} is ${storey.toFixed(3)} m.`, [st.id]));
        }
      }
    }

    // ---- lift shafts ----
    for (const el of f.elevators ?? []) {
      if (!el.rect || !planeCrossesRect(cut, el.rect)) continue;
      const [a, b] = rectU(cut.axis, el.rect);
      out.lifts.push({ elevatorId: el.id, floor: f.level, rect: { u0: round(a), u1: round(b), z0: round(z0), z1: round(z1) } });
    }

    if (fu1 > fu0) {
      out.levels.push({ floor: f.level, z: round(z0), u0: fu0, u1: fu1, label: `F${f.level} ${fmtLevel(z0)}` });
      uMin = Math.min(uMin, fu0); uMax = Math.max(uMax, fu1);
      zMax = Math.max(zMax, z1);
      if (fi === floors.length - 1 || !floors.slice(fi + 1).some((g) => g.walls.some((w) => wallCrossing(w, cut)))) {
        // Top of the highest cut storey (no roof data exists — this is a level line only).
        out.levels.push({ floor: f.level, z: round(z1), u0: fu0, u1: fu1, label: `TOP F${f.level} ${fmtLevel(z1)}` });
      }
    }
  });

  if (out.walls.length === 0) {
    F.push(finding('SECTION_CUT_OUTSIDE_BUILDING', 'hard', `${tag}: the cut ${cut.axis} = ${cut.at} m does not cross any wall on any floor — it lies outside the building.`));
    return out;
  }
  out.extent = { u0: round(uMin), u1: round(uMax), z0: round(zMin), z1: round(zMax) };
  return out;
}

/** Findings for one section cut (invalid / missing section geometry). Empty = valid. */
export function validateSection(candidate: LayoutCandidate, cut: SectionCut): Finding[] {
  return computeSection(candidate, cut).findings;
}

/** A candidate cut is usable when it yields no hard finding. */
const usable = (candidate: LayoutCandidate, cut: SectionCut) =>
  !computeSection(candidate, cut).findings.some((f) => f.severity === 'hard');

/**
 * Deterministic default cuts ("multi-section"):
 *   A — along the first stair flight's run, through its centre line, so the
 *       riser/tread profile and landing appear (fallback: footprint centre).
 *   B — perpendicular to A through the ground-floor footprint centre
 *       (fallback: the centres of ground-floor spaces, largest first).
 * A default cut is only returned when it validates without hard findings.
 */
export function defaultSectionCuts(candidate: LayoutCandidate): SectionCut[] {
  const floors = candidate?.floors ?? [];
  if (floors.length === 0) return [];
  const g = floors[0];
  const fp = g.footprint;
  const centre = { x: fp.x + fp.w / 2, y: fp.y + fp.h / 2 };
  const spaceCentres = [...g.spaces]
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => ({ x: s.rect.x + s.rect.w / 2, y: s.rect.y + s.rect.h / 2 }));

  const pick = (id: string, axis: SectionAxis, tries: number[]): SectionCut | null => {
    for (const at of tries) {
      const c: SectionCut = { id, axis, at: round(at) };
      if (usable(candidate, c)) return c;
    }
    return null;
  };

  const cuts: SectionCut[] = [];
  const fl = floors.flatMap((f) => f.stairs ?? []).flatMap((s) => s.flights ?? [])[0];
  let axisA: SectionAxis = 'x';
  let a: SectionCut | null = null;
  if (fl?.footprint) {
    axisA = fl.direction === 'east' || fl.direction === 'west' ? 'y' : 'x';
    const [lo, hi] = rectN(axisA, fl.footprint);
    const mid = (lo + hi) / 2, q = (hi - lo) / 4;
    a = pick('A', axisA, [mid, mid - q, mid + q]);
  }
  if (!a) a = pick('A', axisA, [nOf(axisA, centre), ...spaceCentres.map((p) => nOf(axisA, p))]);
  if (a) cuts.push(a);
  const axisB: SectionAxis = axisA === 'x' ? 'y' : 'x';
  const b = pick('B', axisB, [nOf(axisB, centre), ...spaceCentres.map((p) => nOf(axisB, p))]);
  if (b) cuts.push(b);
  // C — through the lift shaft centre when neither A nor B crosses the shaft.
  const lift = floors.flatMap((f) => f.elevators ?? [])[0];
  if (lift?.rect && !cuts.some((c) => planeCrossesRect(c, lift.rect))) {
    const c = pick('C', axisA, [(rectN(axisA, lift.rect)[0] + rectN(axisA, lift.rect)[1]) / 2]);
    if (c) cuts.push(c);
  }
  return cuts;
}

/** Compute several sections (default cuts when none are given). */
export function buildSections(candidate: LayoutCandidate, cuts?: SectionCut[]): SectionDrawing[] {
  const list = cuts ?? defaultSectionCuts(candidate);
  const seen = new Set<string>();
  return list.map((c) => {
    const d = computeSection(candidate, c);
    if (c && typeof c.id === 'string') {
      if (seen.has(c.id)) d.findings.push(finding('SECTION_INVALID_CUT', 'hard', `Section ${c.id}: duplicate section id.`));
      seen.add(c.id);
    }
    return d;
  });
}
