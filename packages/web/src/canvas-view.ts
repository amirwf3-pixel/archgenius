/**
 * Pure view-transform and hatch math for the 2D plan preview
 * (ROADMAP Phase 5 — "Better canvas preview (panning, zoom, hatch)").
 *
 * Everything here is side-effect free so it can be unit-tested without a DOM
 * and so the interaction stays deterministic: the same gesture always produces
 * the same target view. `PlanCanvas` owns the animation frames and the canvas
 * drawing; it delegates every decision about *where the view ends up* to these
 * functions.
 *
 * The world↔screen mapping itself stays in `PlanCanvas.makeTransform` (covered
 * by the existing ui.test.tsx suite) — this module never redefines it.
 */

/** View state: zoom multiplier on top of the fit transform, plus screen-space pan. */
export interface View {
  /** Zoom multiplier applied on top of the fit-to-bounds scale. */
  z: number;
  /** Horizontal pan in CSS pixels (screen space, +right). */
  px: number;
  /** Vertical pan in CSS pixels (screen space, +up — the canvas flips y). */
  py: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
/** Coarse step used by the toolbar buttons and the +/- keys. */
export const ZOOM_STEP = 1.25;
/** Finer step used by the mouse wheel so a notch never jumps. */
export const WHEEL_ZOOM_STEP = 1.15;
/** Keyboard pan distance in CSS pixels. */
export const PAN_STEP_PX = 40;
/** Duration of an eased view transition (buttons, keys, fit, inertia). */
export const ANIM_MS = 180;
/** Duration of the post-drag inertia glide. */
export const INERTIA_MS = 420;
/** Release speed cap (px per 16.7 ms frame): bounds any glide to ≈ 250 px. */
export const MAX_FLING_PX_PER_FRAME = 40;
/** A release this long after the last pointer move means the user stopped: no glide. */
export const INERTIA_IDLE_MS = 80;

/**
 * The velocity a drag release actually hands to the inertia glide.
 * - pointer resting before release (idle > INERTIA_IDLE_MS) → no glide
 * - speed clamped to MAX_FLING_PX_PER_FRAME, direction preserved, so a spiky
 *   sample (e.g. two events 1 ms apart) cannot fling the plan off-screen
 * - non-finite input → no glide
 */
export function releaseVelocity(vx: number, vy: number, idleMs: number): [number, number] {
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || !(idleMs <= INERTIA_IDLE_MS)) return [0, 0];
  const speed = Math.hypot(vx, vy);
  if (speed <= MAX_FLING_PX_PER_FRAME) return [vx, vy];
  const k = MAX_FLING_PX_PER_FRAME / speed;
  return [vx * k, vy * k];
}

/** The fit-to-view state: identity zoom, no pan (the fit transform is the base). */
export const FIT_VIEW: View = { z: 1, px: 0, py: 0 };

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function isSameView(a: View, b: View): boolean {
  return a.z === b.z && a.px === b.px && a.py === b.py;
}

/**
 * Zoom about a point on the canvas, keeping the world point under that point
 * exactly where it is.
 *
 * Derivation (with `u` the fit-space coordinate and `cy = cssH / 2`):
 *   screenX =  u·z + cx + px        ⇒ px' = ax − (ax − px)·k
 *   screenY = cssH − (u·z + cy + py) ⇒ py' = ay − (ay − py)·k
 * where `ax = sx − cx`, `ay = cy − sy` and `k = z'/z`. The y anchor is
 * `cy − sy`, not `sy − cy`, because the canvas flips y.
 *
 * Returns the SAME object when the zoom is already clamped at a limit, so
 * callers can cheaply detect "nothing changed".
 */
export function zoomViewAt(
  view: View,
  sx: number,
  sy: number,
  cssW: number,
  cssH: number,
  factor: number,
): View {
  const z = clampZoom(view.z * factor);
  if (z === view.z) return view;
  const k = z / view.z;
  const ax = sx - cssW / 2;
  const ay = cssH / 2 - sy;
  return {
    z,
    px: ax - (ax - view.px) * k,
    py: ay - (ay - view.py) * k,
  };
}

/**
 * Pan by a screen-space delta. `dyPx` follows pointer convention (+down), so it
 * is negated into the view's +up pan axis.
 */
export function panViewBy(view: View, dxPx: number, dyPx: number): View {
  if (dxPx === 0 && dyPx === 0) return view;
  return { z: view.z, px: view.px + dxPx, py: view.py - dyPx };
}

/** Cubic ease-out: fast start, gentle settle — used for every view transition. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  const inv = 1 - c;
  return 1 - inv * inv * inv;
}

/** Linear blend of two views; `t` is eased by the caller. */
export function interpolateView(from: View, to: View, t: number): View {
  const c = Math.min(1, Math.max(0, t));
  return {
    z: from.z + (to.z - from.z) * c,
    px: from.px + (to.px - from.px) * c,
    py: from.py + (to.py - from.py) * c,
  };
}

/**
 * Total remaining travel of a decaying velocity — the distance an inertia
 * glide should cover. Bounded by `maxSteps`, so a fast flick can never fling
 * the view arbitrarily far.
 */
export function inertiaTail(
  velocityPxPerFrame: number,
  friction = 0.86,
  maxSteps = 60,
): number {
  if (!Number.isFinite(velocityPxPerFrame)) return 0;
  const f = Math.min(0.97, Math.max(0, friction));
  let total = 0;
  let cur = velocityPxPerFrame;
  for (let i = 0; i < maxSteps; i++) {
    cur *= f;
    if (Math.abs(cur) < 0.05) break;
    total += cur;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Architectural hatch
// ---------------------------------------------------------------------------

export interface HatchSpec {
  /** Line angle in degrees, screen space (0 = horizontal). */
  angleDeg: number;
  /** Spacing between lines in CSS pixels — constant at every zoom level. */
  spacingPx: number;
  strokeStyle: string;
  /** Draw a second set at +90° (cross-hatch). */
  cross?: boolean;
}

/**
 * Which room types get an architectural hatch, and how.
 *
 * Deliberately limited to service/wet/storage spaces: the habitable rooms keep
 * their existing flat tint so the plan stays legible, and nothing here depends
 * on geometry the engine does not already provide.
 */
export function hatchSpecFor(spaceType: string): HatchSpec | null {
  switch (spaceType) {
    case 'bathroom':
    case 'master-bathroom':
    case 'guest-wc':
      return { angleDeg: 45, spacingPx: 7, strokeStyle: 'rgba(167,139,250,0.55)' };
    case 'kitchen':
      return { angleDeg: -45, spacingPx: 8, strokeStyle: 'rgba(251,191,36,0.45)' };
    case 'storage':
      return { angleDeg: 45, spacingPx: 6, strokeStyle: 'rgba(148,163,184,0.55)', cross: true };
    default:
      return null;
  }
}

export interface HatchSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Parallel line segments covering a screen-space rect at the given angle.
 *
 * The lines deliberately overshoot the rect (by the diagonal) so the caller can
 * `clip()` to an arbitrary room polygon and still get full coverage. Pure and
 * deterministic: identical inputs always produce identical output.
 */
export function hatchSegments(
  x: number,
  y: number,
  w: number,
  h: number,
  angleDeg: number,
  spacingPx: number,
): HatchSegment[] {
  if (!(spacingPx > 0) || !Number.isFinite(spacingPx)) return [];
  if (!(w > 0) || !(h > 0)) return [];
  const diag = Math.hypot(w, h);
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  // unit normal — the direction we step along to lay parallel lines
  const nx = -dirY;
  const ny = dirX;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = diag / 2;
  const reach = half + spacingPx;
  const out: HatchSegment[] = [];
  const count = Math.floor(diag / spacingPx) + 1;
  for (let i = 0; i < count; i++) {
    const off = -half + i * spacingPx;
    const ox = cx + nx * off;
    const oy = cy + ny * off;
    out.push({
      x1: ox - dirX * reach,
      y1: oy - dirY * reach,
      x2: ox + dirX * reach,
      y2: oy + dirY * reach,
    });
  }
  return out;
}
