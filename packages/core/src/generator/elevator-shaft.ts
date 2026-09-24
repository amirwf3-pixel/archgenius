/**
 * Elevator shaft geometry — first bounded subphase (ROADMAP Phase 6).
 *
 * Pure, deterministic helpers that turn the elevator-hall space the placer
 * RESERVED (never carved from leftover space after layout) into an explicit
 * `Elevator` record: shaft/core cell, guaranteed clear shaft, cabin footprint
 * and landing door side.
 *
 * REGULATORY HONESTY: every dimension comes from DEFAULT_ELEVATOR_CONFIG, which
 * is a DESIGN ASSUMPTION (see model/stairs.ts). Nothing here checks, implies
 * or reports compliance with Mabhas 15. Pit/headroom/machine room (3D), fire
 * rating and cabin selection are out of scope.
 */
import type { Rect } from '../geometry/rect.js';
import type { Space } from '../model/space.js';
import type { Elevator, ElevatorConfig, ElevatorDoorSide } from '../model/stairs.js';
import { DEFAULT_ELEVATOR_CONFIG, elevatorCellSize } from '../model/stairs.js';
export { elevatorCellSize, elevatorClearSize } from '../model/stairs.js';
import { MIN_ADJ_EDGE, sharedEdgeLength } from './vertical-core.js';

/** Floor-level circulation a shaft may open onto. The stair hall is excluded
 *  on purpose: a U-stair's far end is its mid-landing (half a storey up), so
 *  a shaft door onto the stair hall is not a floor-level landing. */
export const ELEVATOR_LANDING_TYPES: ReadonlySet<string> = new Set(['corridor', 'foyer', 'entrance']);

/** The single building core id every floor's shaft shares. */
export const ELEVATOR_CORE_ID = 'core-lift';

const SIDE_ORDER: ElevatorDoorSide[] = ['south', 'east', 'north', 'west'];

/**
 * Landing side of a shaft cell: the side whose shared edge with a floor-level
 * circulation space is longest (≥ MIN_ADJ_EDGE). Ties break on the fixed side
 * order, so equal inputs give equal outputs. Returns null when the cell does
 * not touch any landing circulation with a usable edge.
 */
export function elevatorLandingSide(
  cell: Rect,
  spaces: Space[],
  cfg: ElevatorConfig = DEFAULT_ELEVATOR_CONFIG,
): { side: ElevatorDoorSide; length: number } | null {
  let best: { side: ElevatorDoorSide; length: number } | null = null;
  for (const side of SIDE_ORDER) {
    // The door wall must be the shaft's WIDTH side in this orientation.
    if (!cellFitsShaft(cell, side, cfg)) continue;
    let len = 0;
    for (const s of spaces) {
      if (!ELEVATOR_LANDING_TYPES.has(s.type)) continue;
      len = Math.max(len, sharedEdgeLength(cell, side, s.rect));
    }
    if (len + 1e-9 >= MIN_ADJ_EDGE && (!best || len > best.length + 1e-9)) best = { side, length: len };
  }
  return best;
}

/**
 * Restore the reserved shaft cell to its exact configured size after the
 * generic room passes (cm snapping, corridor welding) nudged it. The landing
 * edge (the one touching floor-level circulation) stays flush where it is, and
 * the lateral start coordinate is kept, so the landing survives. Returns the
 * rigid rect (unchanged object when the cell is already exact).
 */
export function rigidShaftCell(cell: Rect, spaces: Space[], cfg: ElevatorConfig = DEFAULT_ELEVATOR_CONFIG): Rect {
  const need = elevatorCellSize(cfg);
  const landing = elevatorLandingSide(cell, spaces, cfg);
  // Orientation: the landing side decides; otherwise the one closest to the cell.
  const side: ElevatorDoorSide = landing?.side
    ?? (Math.abs(cell.w - need.width) + Math.abs(cell.h - need.depth) <= Math.abs(cell.w - need.depth) + Math.abs(cell.h - need.width) ? 'south' : 'west');
  const w = doorAlongX(side) ? need.width : need.depth;
  const h = doorAlongX(side) ? need.depth : need.width;
  let x = side === 'east' ? round3(cell.x + cell.w - w) : cell.x;
  let y = side === 'north' ? round3(cell.y + cell.h - h) : cell.y;
  // Flush the landing edge onto the circulation edge it faces (cm snapping can
  // leave a seam; walls and the landing door need one exact shared edge).
  if (landing) {
    const FLUSH = 0.02;
    for (const s of spaces) {
      if (!ELEVATOR_LANDING_TYPES.has(s.type)) continue;
      const r = s.rect;
      if (side === 'south' && Math.abs(y - (r.y + r.h)) < FLUSH) { y = r.y + r.h; break; }
      if (side === 'north' && Math.abs(y + h - r.y) < FLUSH) { y = r.y - h; break; }
      if (side === 'west' && Math.abs(x - (r.x + r.w)) < FLUSH) { x = r.x + r.w; break; }
      if (side === 'east' && Math.abs(x + w - r.x) < FLUSH) { x = r.x - w; break; }
    }
  }
  if (x === cell.x && y === cell.y && Math.abs(cell.w - w) < 1e-9 && Math.abs(cell.h - h) < 1e-9) return cell;
  return { x, y, w, h };
}

/** Door wall runs along x for north/south doors, along y for east/west. */
function doorAlongX(side: ElevatorDoorSide): boolean {
  return side === 'north' || side === 'south';
}

/** Does the reserved cell hold the configured shaft in the given door
 *  orientation (width along the door wall, depth across it)? */
export function cellFitsShaft(cell: Rect, side: ElevatorDoorSide, cfg: ElevatorConfig = DEFAULT_ELEVATOR_CONFIG): boolean {
  const need = elevatorCellSize(cfg);
  const along = doorAlongX(side) ? cell.w : cell.h;
  const across = doorAlongX(side) ? cell.h : cell.w;
  return along + 1e-6 >= need.width && across + 1e-6 >= need.depth;
}

/**
 * Build the explicit Elevator record for one floor from its reserved
 * elevator-hall cell. Deterministic: the clear shaft is the cell inset by
 * the enclosure allowance; the cabin is centred along the door wall and set
 * `frontClearance` back from the door-side clear face.
 */
export function buildElevator(args: {
  hall: Space;
  doorSide: ElevatorDoorSide;
  level: number;
  coreId?: string;
  cfg?: ElevatorConfig;
}): Elevator {
  const cfg = args.cfg ?? DEFAULT_ELEVATOR_CONFIG;
  const r = args.hall.rect;
  const a = cfg.enclosureAllowance;
  const clearRect: Rect = { x: r.x + a, y: r.y + a, w: round3(r.w - 2 * a), h: round3(r.h - 2 * a) };
  const alongX = doorAlongX(args.doorSide);
  const cw = alongX ? cfg.cabinWidth : cfg.cabinDepth; // cabin extent along x
  const ch = alongX ? cfg.cabinDepth : cfg.cabinWidth; // cabin extent along y
  let cx: number, cy: number;
  if (alongX) {
    cx = clearRect.x + (clearRect.w - cw) / 2;
    cy = args.doorSide === 'south' ? clearRect.y + cfg.frontClearance : clearRect.y + clearRect.h - cfg.frontClearance - ch;
  } else {
    cy = clearRect.y + (clearRect.h - ch) / 2;
    cx = args.doorSide === 'west' ? clearRect.x + cfg.frontClearance : clearRect.x + clearRect.w - cfg.frontClearance - cw;
  }
  const cabinRect: Rect = { x: round3(cx), y: round3(cy), w: cw, h: ch };
  return {
    id: `elevator-${args.level}-0`,
    rect: { ...r },
    clearRect: { x: round3(clearRect.x), y: round3(clearRect.y), w: clearRect.w, h: clearRect.h },
    cabinRect,
    cabinWidth: cfg.cabinWidth,
    cabinDepth: cfg.cabinDepth,
    doorSide: args.doorSide,
    coreId: args.coreId ?? ELEVATOR_CORE_ID,
    hallSpaceId: args.hall.id,
    basis: cfg.basis,
    floor: args.level,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Core-adjacent shaft cell in FREE space (multi-rectangle / L-shape plans).
 *
 * The L-wing and multi-rect planners tile their wings with their own band
 * solvers and cannot carry a fixed cell, so the shaft is withheld from them.
 * Once such a plan is accepted on the origin floor, this deterministic search
 * looks for the exact DESIGN-ASSUMPTION cell that
 *   - sits in free space (overlaps no space and no excluded rect — nothing is
 *     moved or shrunk),
 *   - lies inside the authoritative buildable polygon AND the floor's building
 *     slice (never in a parking band / forecourt),
 *   - shares ≥ `minCoreEdge` with the stair hall (compact vertical core), and
 *   - lands with its full door wall on floor-level circulation over an EXACT
 *     shared edge ≥ MIN_ADJ_EDGE.
 * Candidates are enumerated along every landing-space edge (door facing it) at
 * alignment points plus a 1 cm grid, and ranked by stair contact, landing
 * length, then coordinates — equal inputs give equal outputs. Returns null
 * when no such cell exists (the caller then reports ELEV_SHAFT_MISSING).
 */
export function findCoreAdjacentShaftCell(args: {
  stairHall: Rect;
  spaces: Space[];
  inside: (r: Rect) => boolean;
  exclude?: Rect[];
  cfg?: ElevatorConfig;
  minCoreEdge?: number;
}): { rect: Rect; side: ElevatorDoorSide } | null {
  const cfg = args.cfg ?? DEFAULT_ELEVATOR_CONFIG;
  const { width: along, depth } = elevatorCellSize(cfg);
  const minCore = args.minCoreEdge ?? MIN_ADJ_EDGE;
  const EPS = 1e-6;
  const overlap = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const landings = args.spaces.filter(s => ELEVATOR_LANDING_TYPES.has(s.type));
  const blockers = [...args.spaces.map(s => s.rect), ...(args.exclude ?? [])];
  let best: { rect: Rect; side: ElevatorDoorSide; key: number[] } | null = null;
  for (const land of landings) {
    const r = land.rect;
    // door side of the CELL (it faces the landing space)
    const lines: Array<{ side: ElevatorDoorSide; w: number; h: number; horiz: boolean; fixed: number; lo: number; hi: number }> = [
      { side: 'south', w: along, h: depth, horiz: true, fixed: r.y + r.h, lo: r.x, hi: r.x + r.w },
      { side: 'north', w: along, h: depth, horiz: true, fixed: r.y - depth, lo: r.x, hi: r.x + r.w },
      { side: 'west', w: depth, h: along, horiz: false, fixed: r.x + r.w, lo: r.y, hi: r.y + r.h },
      { side: 'east', w: depth, h: along, horiz: false, fixed: r.x - depth, lo: r.y, hi: r.y + r.h },
    ];
    for (const ln of lines) {
      const span = ln.horiz ? ln.w : ln.h;
      const sh = args.stairHall;
      const align = ln.horiz
        ? [sh.x, sh.x + sh.w, sh.x - span, sh.x + sh.w - span, ln.lo, ln.hi - span]
        : [sh.y, sh.y + sh.h, sh.y - span, sh.y + sh.h - span, ln.lo, ln.hi - span];
      const pos = new Set<number>(align);
      const from = Math.ceil((ln.lo - span + MIN_ADJ_EDGE) * 100), to = Math.floor((ln.hi - MIN_ADJ_EDGE) * 100);
      for (let t = from; t <= to; t++) pos.add(t / 100);
      for (const p of [...pos].sort((a, b) => a - b)) {
        const cell: Rect = ln.horiz ? { x: p, y: ln.fixed, w: ln.w, h: ln.h } : { x: ln.fixed, y: p, w: ln.w, h: ln.h };
        const landing = ln.horiz
          ? Math.max(0, Math.min(cell.x + cell.w, r.x + r.w) - Math.max(cell.x, r.x))
          : Math.max(0, Math.min(cell.y + cell.h, r.y + r.h) - Math.max(cell.y, r.y));
        if (landing + 1e-9 < MIN_ADJ_EDGE) continue;
        const core = exactSharedEdge(cell, sh);
        if (core + 1e-9 < minCore) continue;
        if (blockers.some(b => overlap(b, cell) > EPS)) continue;
        if (!args.inside(cell)) continue;
        const key = [-round3(core), -round3(landing), round3(cell.y), round3(cell.x), SIDE_ORDER.indexOf(ln.side)];
        if (!best || lexLess(key, best.key)) best = { rect: cell, side: ln.side, key };
      }
    }
  }
  return best ? { rect: best.rect, side: best.side } : null;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Length of the edge two rects share EXACTLY (touching, collinear, overlapping
 *  span) — no seam tolerance: walls need one coincident edge. */
function exactSharedEdge(a: Rect, b: Rect, eps = 1e-6): number {
  const ov = (a0: number, a1: number, c0: number, c1: number) => Math.max(0, Math.min(a1, c1) - Math.max(a0, c0));
  let m = 0;
  if (Math.abs(a.y - (b.y + b.h)) < eps || Math.abs(a.y + a.h - b.y) < eps) m = Math.max(m, ov(a.x, a.x + a.w, b.x, b.x + b.w));
  if (Math.abs(a.x - (b.x + b.w)) < eps || Math.abs(a.x + a.w - b.x) < eps) m = Math.max(m, ov(a.y, a.y + a.h, b.y, b.y + b.h));
  return m;
}
