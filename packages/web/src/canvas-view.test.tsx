/**
 * Canvas view-interaction tests — ROADMAP Phase 5 ("Better canvas preview:
 * panning, zoom, hatch").
 *
 * All of the interaction math is pure (canvas-view.ts) so it is tested here
 * without a DOM. The centrepiece is the zoom-about-cursor invariant, which the
 * previous inline implementation violated: zooming with the cursor off the
 * vertical centre moved the world point under the cursor by ~3 m.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import {
  ANIM_MS, FIT_VIEW, INERTIA_IDLE_MS, INERTIA_MS, MAX_FLING_PX_PER_FRAME, MAX_ZOOM, MIN_ZOOM,
  PAN_STEP_PX, ZOOM_STEP,
  clampZoom, easeOutCubic, hatchSegments, hatchSpecFor, inertiaTail,
  interpolateView, isSameView, panViewBy, releaseVelocity, zoomViewAt,
} from './canvas-view';
import type { View } from './canvas-view';
import { PlanCanvas, computeBounds, makeTransform } from './PlanCanvas';
import { t } from './i18n';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const W = 800;
const H = 560;

const floor = {
  level: 0, floorHeight: 3, elevation: 0,
  footprint: { x: 0, y: 0, w: 10, h: 8 },
  spaces: [], walls: [], openings: [], stairs: [], elevators: [],
  furniture: [], parkingStalls: [],
} as any;
const candidate = { id: 'c1', buildableArea: { x: 0, y: 0, w: 10, h: 8 }, floors: [floor] } as any;
const B = computeBounds(candidate, floor);

const worldUnder = (v: View, sx: number, sy: number) => makeTransform(B, W, H, v).worldAt(sx, sy);

const VIEWS: View[] = [
  { z: 1, px: 0, py: 0 },
  { z: 2.5, px: 130, py: -40 },
  { z: 0.5, px: -60, py: 22 },
  { z: 0.25, px: 0, py: 0 },
  { z: 8, px: 12, py: 7 },
];

/** Cursor positions incl. the off-centre ones the old formula got wrong. */
const POINTS: Array<[number, number]> = [
  [W / 2, H / 2], [400, 100], [400, 500], [10, 10], [790, 550], [123, 456],
];

// ---------------------------------------------------------------------------
// zoom
// ---------------------------------------------------------------------------
describe('zoomViewAt — zoom about a point', () => {
  it('keeps the world point under the cursor exactly fixed (every view × cursor × factor)', () => {
    for (const v of VIEWS) {
      for (const [sx, sy] of POINTS) {
        for (const factor of [1.15, 1 / 1.15, 1.25, 1 / 1.25, 2, 0.5]) {
          const next = zoomViewAt(v, sx, sy, W, H, factor);
          if (isSameView(next, v)) continue; // clamped at a limit
          const before = worldUnder(v, sx, sy);
          const after = worldUnder(next, sx, sy);
          expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
          expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('regression: the off-centre vertical case that used to drift by ~3 m', () => {
    const v: View = { z: 1, px: 0, py: 0 };
    const before = worldUnder(v, 400, 100);
    const after = worldUnder(zoomViewAt(v, 400, 100, W, H, 2), 400, 100);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
  });

  it('regression: the panned horizontal case that used to drift by ~0.67 m', () => {
    const v: View = { z: 1.5, px: 90, py: 0 };
    const before = worldUnder(v, 200, 280);
    const after = worldUnder(zoomViewAt(v, 200, 280, W, H, 1.5), 200, 280);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
  });

  it('zooming at the exact canvas centre scales the pan by the zoom ratio', () => {
    // The anchored point is the one under the centre, i.e. fit-space u = −px/z,
    // so px/py must scale with k for it to stay put (px=0 is the fixed point).
    for (const v of VIEWS) {
      const next = zoomViewAt(v, W / 2, H / 2, W, H, ZOOM_STEP);
      if (isSameView(next, v)) continue; // clamped at a limit
      const k = next.z / v.z;
      expect(next.px).toBeCloseTo(v.px * k, 10);
      expect(next.py).toBeCloseTo(v.py * k, 10);
    }
    const centred = zoomViewAt({ z: 1, px: 0, py: 0 }, W / 2, H / 2, W, H, ZOOM_STEP);
    expect(centred.px).toBe(0);
    expect(centred.py).toBe(0);
  });

  it('zoom in then out by the same factor returns to the original view', () => {
    for (const v of VIEWS) {
      for (const [sx, sy] of POINTS) {
        const up = zoomViewAt(v, sx, sy, W, H, 1.2);
        if (isSameView(up, v)) continue;
        const back = zoomViewAt(up, sx, sy, W, H, 1 / 1.2);
        expect(back.z).toBeCloseTo(v.z, 10);
        expect(back.px).toBeCloseTo(v.px, 9);
        expect(back.py).toBeCloseTo(v.py, 9);
      }
    }
  });
});

describe('zoom limits', () => {
  it('clamps to MIN_ZOOM / MAX_ZOOM', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(MAX_ZOOM).toBe(8);
    expect(MIN_ZOOM).toBe(0.25);
  });

  it('returns the SAME view object once a limit is reached (no wasted re-render)', () => {
    const maxed: View = { z: MAX_ZOOM, px: 5, py: 5 };
    expect(zoomViewAt(maxed, 100, 100, W, H, ZOOM_STEP)).toBe(maxed);
    const minned: View = { z: MIN_ZOOM, px: 5, py: 5 };
    expect(zoomViewAt(minned, 100, 100, W, H, 1 / ZOOM_STEP)).toBe(minned);
  });

  it('never exceeds the limits no matter how many wheel notches are applied', () => {
    let v: View = FIT_VIEW;
    for (let i = 0; i < 200; i++) v = zoomViewAt(v, 300, 200, W, H, 1.15);
    expect(v.z).toBeLessThanOrEqual(MAX_ZOOM);
    expect(Number.isFinite(v.px) && Number.isFinite(v.py)).toBe(true);
    for (let i = 0; i < 400; i++) v = zoomViewAt(v, 300, 200, W, H, 1 / 1.15);
    expect(v.z).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(Number.isFinite(v.px) && Number.isFinite(v.py)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pan
// ---------------------------------------------------------------------------
describe('panViewBy — screen-space pan', () => {
  it('moves the drawn content by exactly the requested pixel delta', () => {
    const v: View = { z: 1.8, px: 20, py: -15 };
    const dx = 37, dy = -24;
    const next = panViewBy(v, dx, dy);
    const a = makeTransform(B, W, H, v);
    const b = makeTransform(B, W, H, next);
    for (const [wx, wy] of [[0, 0], [10, 8], [4.4, 2.1]] as Array<[number, number]>) {
      expect(b.tx(wx) - a.tx(wx)).toBeCloseTo(dx, 10);
      expect(b.ty(wy) - a.ty(wy)).toBeCloseTo(dy, 10); // screen y follows the pointer
    }
  });

  it('does not change the zoom', () => {
    expect(panViewBy({ z: 3, px: 0, py: 0 }, 10, 10).z).toBe(3);
  });

  it('returns the same object for a zero delta and round-trips', () => {
    const v: View = { z: 2, px: 3, py: 4 };
    expect(panViewBy(v, 0, 0)).toBe(v);
    const there = panViewBy(v, 50, -30);
    const back = panViewBy(there, -50, 30);
    expect(back.px).toBeCloseTo(v.px, 12);
    expect(back.py).toBeCloseTo(v.py, 12);
  });

  it('keyboard pan step is a sane distance', () => {
    expect(PAN_STEP_PX).toBeGreaterThan(8);
    expect(PAN_STEP_PX).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// fit-to-view + easing
// ---------------------------------------------------------------------------
describe('fit-to-view and eased transitions', () => {
  it('FIT_VIEW is the identity view on top of the fit transform', () => {
    expect(FIT_VIEW).toEqual({ z: 1, px: 0, py: 0 });
    const { scale } = makeTransform(B, W, H, FIT_VIEW);
    const expected = Math.min((W - 80) / 10, (H - 80) / 8);
    expect(scale).toBeCloseTo(expected, 10);
  });

  it('easeOutCubic is a proper 0→1 monotonic ease', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const e = easeOutCubic(i / 20);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    // clamped outside the unit interval
    expect(easeOutCubic(-2)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });

  it('interpolateView blends endpoints exactly', () => {
    const from: View = { z: 1, px: 0, py: 0 };
    const to: View = { z: 3, px: 120, py: -60 };
    expect(interpolateView(from, to, 0)).toEqual(from);
    expect(interpolateView(from, to, 1)).toEqual(to);
    const mid = interpolateView(from, to, 0.5);
    expect(mid.z).toBeCloseTo(2, 12);
    expect(mid.px).toBeCloseTo(60, 12);
    expect(mid.py).toBeCloseTo(-30, 12);
    // always lands exactly on the target at t=1, whatever the start
    expect(interpolateView({ z: 7, px: -5, py: 5 }, FIT_VIEW, 1)).toEqual(FIT_VIEW);
  });

  it('animation budgets are short enough to feel responsive', () => {
    expect(ANIM_MS).toBeGreaterThan(0);
    expect(ANIM_MS).toBeLessThanOrEqual(400);
    expect(INERTIA_MS).toBeGreaterThanOrEqual(ANIM_MS);
    expect(INERTIA_MS).toBeLessThanOrEqual(1000);
  });
});

describe('inertiaTail — bounded post-drag glide', () => {
  it('is zero for zero or non-finite velocity', () => {
    expect(inertiaTail(0)).toBe(0);
    expect(inertiaTail(Number.NaN)).toBe(0);
    expect(inertiaTail(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('preserves direction and grows with the release speed', () => {
    expect(inertiaTail(10)).toBeGreaterThan(0);
    expect(inertiaTail(-10)).toBeLessThan(0);
    expect(Math.abs(inertiaTail(20))).toBeGreaterThan(Math.abs(inertiaTail(10)));
  });

  it('is bounded — a violent flick cannot fling the plan arbitrarily far', () => {
    const tail = inertiaTail(500);
    expect(Math.abs(tail)).toBeLessThan(500 * 60); // maxSteps bound
    expect(Math.abs(tail)).toBeLessThan(4000);
    expect(Number.isFinite(tail)).toBe(true);
  });

  it('is deterministic for identical input', () => {
    expect(inertiaTail(13.7)).toBe(inertiaTail(13.7));
  });
});

describe('releaseVelocity — what a drag release hands to the glide (regression)', () => {
  // Found by a live-render check: a 60 px drag delivered 1 ms after pointerdown
  // produced ~601 px/frame, and inertiaTail() (only proportionally bounded)
  // flung the plan ~3,700 px off-screen. A pause before release also glided.
  it('regression: a spiky 1 ms drag sample can no longer fling the plan off-screen', () => {
    const spiky = 60 * 16.7 * 0.6; // the exact sample the live check produced
    const [vx, vy] = releaseVelocity(spiky, 0, 0);
    expect(Math.abs(inertiaTail(spiky))).toBeGreaterThan(3000); // what used to happen
    expect(Math.hypot(vx, vy)).toBeCloseTo(MAX_FLING_PX_PER_FRAME, 10);
    expect(Math.abs(inertiaTail(vx)) + Math.abs(inertiaTail(vy))).toBeLessThan(300);
  });

  it('caps glide travel in ABSOLUTE terms for any release speed or direction', () => {
    for (const v of [41, 100, 1e3, 1e6]) {
      for (const [dx, dy] of [[1, 0], [0, -1], [0.6, 0.8], [-0.7071, -0.7071]]) {
        const [vx, vy] = releaseVelocity(v * dx, v * dy, 10);
        expect(Math.hypot(inertiaTail(vx), inertiaTail(vy))).toBeLessThan(300);
      }
    }
  });

  it('preserves the release direction when clamping', () => {
    const [vx, vy] = releaseVelocity(300, -400, 10); // 3-4-5 triangle
    expect(vx / vy).toBeCloseTo(300 / -400, 12);
    expect(vx).toBeGreaterThan(0);
    expect(vy).toBeLessThan(0);
  });

  it('passes ordinary release speeds through unchanged', () => {
    expect(releaseVelocity(12, -7, 16)).toEqual([12, -7]);
    expect(releaseVelocity(0, 0, 0)).toEqual([0, 0]);
  });

  it('regression: resting the pointer before release gives no glide', () => {
    expect(releaseVelocity(25, 10, INERTIA_IDLE_MS)).toEqual([25, 10]); // boundary still glides
    expect(releaseVelocity(25, 10, INERTIA_IDLE_MS + 1)).toEqual([0, 0]);
    expect(releaseVelocity(25, 10, 1000)).toEqual([0, 0]);
  });

  it('is safe for non-finite input and deterministic', () => {
    expect(releaseVelocity(Number.NaN, 1, 0)).toEqual([0, 0]);
    expect(releaseVelocity(1, Number.POSITIVE_INFINITY, 0)).toEqual([0, 0]);
    expect(releaseVelocity(1, 1, Number.NaN)).toEqual([0, 0]);
    expect(releaseVelocity(123.4, -56.7, 5)).toEqual(releaseVelocity(123.4, -56.7, 5));
  });
});

// ---------------------------------------------------------------------------
// hatch
// ---------------------------------------------------------------------------
describe('hatchSpecFor — which rooms get an architectural pattern', () => {
  it('hatches wet spaces at 45°', () => {
    for (const type of ['bathroom', 'master-bathroom', 'guest-wc']) {
      const spec = hatchSpecFor(type);
      expect(spec).not.toBeNull();
      expect(spec!.angleDeg).toBe(45);
      expect(spec!.cross ?? false).toBe(false);
      expect(spec!.spacingPx).toBeGreaterThan(0);
    }
  });

  it('hatches the kitchen in the opposite diagonal so it reads differently', () => {
    expect(hatchSpecFor('kitchen')!.angleDeg).toBe(-45);
  });

  it('cross-hatches storage', () => {
    const spec = hatchSpecFor('storage')!;
    expect(spec.cross).toBe(true);
    expect(spec.angleDeg).toBe(45);
  });

  it('leaves habitable and circulation rooms unhatched (existing look preserved)', () => {
    for (const type of ['living', 'dining', 'bedroom', 'master-bedroom', 'corridor', 'stair-hall', 'entrance', 'foyer', 'unknown-type']) {
      expect(hatchSpecFor(type)).toBeNull();
    }
  });

  it('is deterministic', () => {
    expect(hatchSpecFor('bathroom')).toEqual(hatchSpecFor('bathroom'));
  });
});

describe('hatchSegments — deterministic pattern geometry', () => {
  it('produces the expected number of lines for a known rect', () => {
    const segs = hatchSegments(0, 0, 100, 100, 45, 10);
    const diag = Math.hypot(100, 100);
    expect(segs).toHaveLength(Math.floor(diag / 10) + 1);
  });

  it('is deterministic — identical input, identical output', () => {
    const a = hatchSegments(12, 34, 88, 52, -45, 7);
    const b = hatchSegments(12, 34, 88, 52, -45, 7);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('overshoots the rect so a clipped polygon is fully covered', () => {
    const w = 60, h = 40;
    const diag = Math.hypot(w, h);
    for (const angle of [0, 45, 90, 135, -45]) {
      for (const s of hatchSegments(0, 0, w, h, angle, 6)) {
        expect(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).toBeGreaterThan(diag);
      }
    }
  });

  it('honours the requested angle', () => {
    const horizontal = hatchSegments(0, 0, 100, 50, 0, 8);
    for (const s of horizontal) expect(s.y1).toBeCloseTo(s.y2, 9);
    const vertical = hatchSegments(0, 0, 100, 50, 90, 8);
    for (const s of vertical) expect(s.x1).toBeCloseTo(s.x2, 9);
  });

  it('returns nothing for a non-positive spacing or a degenerate rect', () => {
    expect(hatchSegments(0, 0, 100, 100, 45, 0)).toEqual([]);
    expect(hatchSegments(0, 0, 100, 100, 45, -5)).toEqual([]);
    expect(hatchSegments(0, 0, 100, 100, 45, Number.NaN)).toEqual([]);
    expect(hatchSegments(0, 0, 0, 100, 45, 5)).toEqual([]);
    expect(hatchSegments(0, 0, 100, 0, 45, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rendering state
// ---------------------------------------------------------------------------
describe('PlanCanvas — controls and rendering state', () => {
  const el = (props: any) => renderToString(React.createElement(PlanCanvas, props));

  it('exposes zoom in / zoom out / fit / hatch controls', () => {
    const html = el({ candidate, floorIndex: 0 });
    expect(html).toContain(t('zoomInLabel'));
    expect(html).toContain(t('zoomOutLabel'));
    expect(html).toContain(t('resetViewLabel'));
    expect(html).toContain(t('hatchOnLabel'));
    expect(html).toContain('data-canvas-hatch="on"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('hatch is on by default and toggling the label follows the state', () => {
    expect(el({ candidate, floorIndex: 0 })).toContain('data-canvas-hatch="on"');
    expect(t('hatchOnLabel')).not.toBe(t('hatchOffLabel'));
  });

  it('disables every control when there is no candidate, without crashing', () => {
    const html = el({ candidate: null, floorIndex: 0 });
    expect(html).toMatch(/<canvas[^>]*tabindex="0"/);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b).toContain('disabled');
  });

  it('keeps the canvas keyboard-focusable with the Persian aria-label', () => {
    const html = el({ candidate, floorIndex: 0 });
    expect(html).toMatch(/<canvas[^>]*tabindex="0"/);
    expect(html).toContain('aria-label=');
  });
});
