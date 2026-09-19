import React, { useEffect, useRef, useState } from 'react';
import type { LayoutCandidate, Floor } from '@archgenius/core';
import { t, tf, faNum, spaceLabel, PERSIAN_FONT_STACK } from './i18n';
import { IconPlus, IconMinus, IconFit } from './components';

/** Canvas font with Persian-capable fallback stack (per-glyph fallback). */
const fontStr = (px: number) => `${px}px ${PERSIAN_FONT_STACK}`;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const PAN_PADDING = 40;

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Content bounds of a floor — the SINGLE source of truth used by both the
 * renderer and the click hit-test (includes footprint, parking, aisle,
 * space polygons and the buildable boundary, so the two transforms can
 * never diverge).
 */
export function computeBounds(candidate: LayoutCandidate, floor: Floor): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expandPt = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  const expand = (x: number, y: number, w: number, h: number) => {
    expandPt(x, y);
    expandPt(x + w, y + h);
  };
  expand(floor.footprint.x, floor.footprint.y, floor.footprint.w, floor.footprint.h);
  for (const s of floor.parkingStalls) expand(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
  if (floor.parkingArea) expand(floor.parkingArea.aisleRect.x, floor.parkingArea.aisleRect.y, floor.parkingArea.aisleRect.w, floor.parkingArea.aisleRect.h);
  for (const sp of floor.spaces) {
    if (sp.polygon) {
      for (const p of sp.polygon) expandPt(p.x, p.y);
    } else {
      expand(sp.rect.x, sp.rect.y, sp.rect.w, sp.rect.h);
    }
  }
  const anyFloor = floor as any;
  if (anyFloor.buildableBoundary) {
    for (const p of anyFloor.buildableBoundary) expandPt(p.x, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Fit transform: world (y-up) → screen pixels (y-down), view = identity. */
function fitBounds(b: Bounds, cssW: number, cssH: number) {
  const worldW = Math.max(1e-6, b.maxX - b.minX);
  const worldH = Math.max(1e-6, b.maxY - b.minY);
  const scale = Math.min((cssW - PAN_PADDING * 2) / worldW, (cssH - PAN_PADDING * 2) / worldH);
  const ox = PAN_PADDING + (cssW - PAN_PADDING * 2 - worldW * scale) / 2;
  const oy = PAN_PADDING + (cssH - PAN_PADDING * 2 - worldH * scale) / 2;
  return { scale, ox, oy };
}

interface View { z: number; px: number; py: number }

/** Build the world↔screen mapping (fit × zoom-around-center × pan). */
export function makeTransform(b: Bounds, cssW: number, cssH: number, view: View) {
  const { scale, ox, oy } = fitBounds(b, cssW, cssH);
  const cx = cssW / 2, cy = cssH / 2;
  const tx = (x: number) => (ox + (x - b.minX) * scale - cx) * view.z + cx + view.px;
  const ty = (y: number) => cssH - ((oy + (y - b.minY) * scale - cy) * view.z + cy + view.py);
  const worldAt = (sx: number, sy: number) => {
    const vx = sx, vy = cssH - sy;
    const fx = (vx - view.px - cx) / view.z + cx;
    const fy = (vy - view.py - cy) / view.z + cy;
    return { x: (fx - ox) / scale + b.minX, y: (fy - oy) / scale + b.minY };
  };
  return { scale, ox, oy, tx, ty, worldAt };
}

interface Props {
  candidate: LayoutCandidate | null;
  floorIndex?: number;
  selectedSpaceId?: string | null;
  onSelectSpace?: (id: string | null) => void;
}

export function PlanCanvas({ candidate, floorIndex = 0, selectedSpaceId, onSelectSpace }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ z: 1, px: 0, py: 0 });
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ sx: number; sy: number; moved: boolean } | null>(null);

  // Responsive sizing — measure the wrapper (no fixed 800×560 stretch).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset the view for every NEW candidate (regeneration); edits keep the id
  // (core clones candidates) so the user's zoom/pan survives an edit.
  useEffect(() => {
    setView({ z: 1, px: 0, py: 0 });
  }, [candidate?.id]);

  const zoomAt = (sx: number, sy: number, factor: number) => {
    setView(v => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * factor));
      if (z === v.z) return v;
      // keep the world point under the cursor stationary
      return { z, px: v.px + (sx - size.w / 2) * (1 - z / v.z) * 0 + (v.px * 0) + (sx - size.w / 2 - (sx - size.w / 2 - v.px) * (z / v.z)), py: v.py + (sy - size.h / 2 - (sy - size.h / 2 - v.py) * (z / v.z)) };
    });
  };

  // Wheel zoom (non-passive so the page does not scroll while zooming).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [size.w, size.h]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 2 || size.h < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = size.w, cssH = size.h;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, cssW, cssH);

    if (!candidate) return;

    const fi = Math.max(0, Math.min(floorIndex, candidate.floors.length - 1));
    const floor = candidate.floors[fi];
    const b = computeBounds(candidate, floor);
    const { scale, tx, ty, worldAt } = makeTransform(b, cssW, cssH, view);
    const effScale = scale * view.z;

    const drawRect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
      ctx.fillStyle = fill;
      ctx.fillRect(tx(x), ty(y + h), w * effScale, h * effScale);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(tx(x), ty(y + h), w * effScale, h * effScale);
      }
    };

    const drawPolygon = (poly: Array<{ x: number; y: number }>, fill: string, stroke?: string, lineWidth = 1) => {
      if (poly.length < 3) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(tx(poly[0].x), ty(poly[0].y));
      for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i].x), ty(poly[i].y));
      ctx.closePath();
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    };

    // Grid — adaptive step (1m / 5m / 10m) over the visible world rect.
    const tl = worldAt(0, 0), br = worldAt(cssW, cssH);
    const visMinX = Math.min(tl.x, br.x), visMaxX = Math.max(tl.x, br.x);
    const visMinY = Math.min(tl.y, br.y), visMaxY = Math.max(tl.y, br.y);
    const span = Math.max(visMaxX - visMinX, visMaxY - visMinY);
    const gridStep = span <= 60 ? 1 : span <= 200 ? 5 : 10;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let gx = Math.floor(visMinX / gridStep) * gridStep; gx <= Math.ceil(visMaxX / gridStep) * gridStep; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(gx), ty(visMinY)); ctx.lineTo(tx(gx), ty(visMaxY)); ctx.stroke();
    }
    for (let gy = Math.floor(visMinY / gridStep) * gridStep; gy <= Math.ceil(visMaxY / gridStep) * gridStep; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(visMinX), ty(gy)); ctx.lineTo(tx(visMaxX), ty(gy)); ctx.stroke();
    }

    // Buildable boundary (canonical) — draw as dashed polygon if available
    const anyFloor = floor as any;
    if (anyFloor.buildableBoundary) {
      drawPolygon(anyFloor.buildableBoundary, 'rgba(96,165,250,0.04)', '#60a5fa', 1.5);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const bb = anyFloor.buildableBoundary;
      ctx.moveTo(tx(bb[0].x), ty(bb[0].y));
      for (let i = 1; i < bb.length; i++) ctx.lineTo(tx(bb[i].x), ty(bb[i].y));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const bl = candidate.buildableArea;
      ctx.strokeStyle = '#60a5fa';
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(tx(bl.x), ty(bl.y + bl.h), bl.w * effScale, bl.h * effScale);
      ctx.setLineDash([]);
    }

    for (const stall of floor.parkingStalls) {
      drawRect(stall.rect.x, stall.rect.y, stall.rect.w, stall.rect.h, 'rgba(100,116,139,0.15)', '#475569');
      ctx.fillStyle = '#94a3b8';
      ctx.font = fontStr(10);
      ctx.textAlign = 'center';
      ctx.fillText(`P${stall.index} F${fi}`, tx(stall.rect.x + stall.rect.w / 2), ty(stall.rect.y + stall.rect.h / 2) + 3);
    }
    if (floor.parkingArea) {
      const a = floor.parkingArea.aisleRect;
      ctx.strokeStyle = '#64748b';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(tx(a.x), ty(a.y + a.h), a.w * effScale, a.h * effScale);
      ctx.setLineDash([]);
    }

    const roomFill: Record<string, string> = {
      living: 'rgba(59,130,246,0.08)',
      dining: 'rgba(59,130,246,0.08)',
      kitchen: 'rgba(245,158,11,0.08)',
      bedroom: 'rgba(16,185,129,0.08)',
      'master-bedroom': 'rgba(16,185,129,0.14)',
      bathroom: 'rgba(139,92,246,0.10)',
      'master-bathroom': 'rgba(139,92,246,0.14)',
      'guest-wc': 'rgba(139,92,246,0.10)',
      corridor: 'rgba(148,163,184,0.12)',
      'stair-hall': 'rgba(236,72,153,0.10)',
      entrance: 'rgba(244,63,94,0.08)',
      foyer: 'rgba(244,63,94,0.08)',
      storage: 'rgba(100,116,139,0.18)',
    };

    // Draw spaces using canonical polygon
    for (const s of floor.spaces) {
      const baseFill = roomFill[s.type] ?? 'rgba(100,116,139,0.08)';
      const isSelected = selectedSpaceId === s.id;
      const fill = isSelected ? 'rgba(251,191,36,0.18)' : baseFill;
      const stroke = isSelected ? '#fbbf24' : '#334155';
      const lw = isSelected ? 2.5 : 1;
      if (s.polygon && s.polygon.length >= 4) {
        drawPolygon(s.polygon, fill, stroke, lw);
      } else {
        drawRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h, fill, stroke);
      }
      // Locked indicator
      if (s.locked?.position || s.locked?.geometry || s.locked?.size) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = fontStr(11);
        ctx.textAlign = 'left';
        const rx = s.rect.x;
        const ry = s.rect.y + s.rect.h;
        ctx.fillText('🔒', tx(rx) + 2, ty(ry) + 12);
      }
    }

    ctx.lineCap = 'square';
    for (const w of floor.walls) {
      ctx.strokeStyle = w.kind === 'exterior' ? '#f1f5f9' : '#cbd5e1';
      ctx.lineWidth = Math.max(1.5, w.thickness * effScale);
      ctx.beginPath();
      ctx.moveTo(tx(w.start.x), ty(w.start.y));
      ctx.lineTo(tx(w.end.x), ty(w.end.y));
      ctx.stroke();
    }

    for (const o of floor.openings) {
      if (o.type === 'window') {
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        const dx = o.wallDir.x * o.width / 2;
        const dy = o.wallDir.y * o.width / 2;
        ctx.beginPath();
        ctx.moveTo(tx(o.center.x - dx), ty(o.center.y - dy));
        ctx.lineTo(tx(o.center.x + dx), ty(o.center.y + dy));
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        const dx = o.wallDir.x * o.width / 2;
        const dy = o.wallDir.y * o.width / 2;
        const hx = o.center.x - dx;
        const hy = o.center.y - dy;
        ctx.beginPath();
        ctx.moveTo(tx(hx), ty(hy));
        ctx.lineTo(tx(o.center.x + o.normal.x * o.width), ty(o.center.y + o.normal.y * o.width));
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = '#34d39966';
        const ang = Math.atan2(o.normal.y, o.normal.x);
        ctx.arc(tx(hx), ty(hy), o.width * effScale, -ang - Math.PI / 2, -ang, false);
        ctx.stroke();
      }
    }

    for (const st of floor.stairs) {
      const sx = st.rect?.x ?? st.footprint?.x ?? 0;
      const sy = st.rect?.y ?? st.footprint?.y ?? 0;
      const sw = st.rect?.w ?? st.footprint?.w ?? 0;
      const sh = st.rect?.h ?? st.footprint?.h ?? 0;
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 1;
      const steps = Math.max(4, Math.floor(sh / (st.tread || st.treadDepth || 0.3)));
      for (let i = 1; i < steps; i++) {
        const yy = sy + (sh * i / steps);
        ctx.beginPath();
        ctx.moveTo(tx(sx), ty(yy));
        ctx.lineTo(tx(sx + sw), ty(yy));
        ctx.stroke();
      }
      ctx.fillStyle = '#c084fc';
      ctx.font = fontStr(10);
      ctx.textAlign = 'left';
      ctx.fillText(`${t('canvasStair')} ${fi}`, tx(sx), ty(sy + sh) - 4);
    }

    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    for (const s of floor.spaces) {
      const fs = Math.max(9, Math.min(13, Math.min(s.rect.w, s.rect.h) * effScale * 0.18));
      ctx.font = fontStr(fs);
      const cx = s.rect.x + s.rect.w / 2;
      const cy = s.rect.y + s.rect.h / 2;
      const isSel = selectedSpaceId === s.id;
      ctx.fillStyle = isSel ? '#fbbf24' : '#e2e8f0';
      ctx.fillText(spaceLabel(s.label), tx(cx), ty(cy) + fs * 0.2);
      ctx.font = fontStr(fs * 0.75);
      ctx.fillStyle = isSel ? '#fde68a' : '#94a3b8';
      ctx.fillText(`${s.area.toFixed(1)} m² ${s.polygon.length}v`, tx(cx), ty(cy) + fs * 1.1);
      ctx.fillStyle = '#e2e8f0';
    }

    ctx.fillStyle = '#f1f5f9';
    ctx.font = fontStr(12);
    ctx.textAlign = 'left';
    const nx = tx(b.minX) + 12, ny = ty(b.maxY) + 18;
    ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx - 4, ny + 2); ctx.lineTo(nx + 4, ny + 2); ctx.closePath(); ctx.fill();
    ctx.fillText(t('canvasNorth'), nx - 12, ny + 18);
    ctx.fillText(tf('canvasFloor', { current: fi, last: candidate.floors.length - 1, count: floor.spaces.length }), tx(b.minX), ty(b.minY) - 8);

    const barLen = 5;
    const bx = tx(b.maxX) - barLen * effScale - 20;
    const by = ty(b.minY) - 20;
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barLen * effScale, by); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = fontStr(10);
    ctx.textAlign = 'center';
    ctx.fillText(`0`, bx, by + 14);
    ctx.fillText(`${barLen}m`, bx + barLen * effScale, by + 14);
  }, [candidate, floorIndex, selectedSpaceId, size, view]);

  // ---------------------------------------------------------------------------
  // Pointer interaction: drag = pan, click (no drag) = select space
  // ---------------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!candidate) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; setPanning(true); }
    drag.sx = e.clientX; drag.sy = e.clientY;
    setView(v => ({ ...v, px: v.px + dx, py: v.py - dy }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    if (!candidate || !onSelectSpace || !drag || drag.moved) return;
    // click-select: hit-test against the same transform used for drawing
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const fi = Math.max(0, Math.min(floorIndex, candidate.floors.length - 1));
    const floor = candidate.floors[fi];
    const b = computeBounds(candidate, floor);
    const { worldAt } = makeTransform(b, size.w, size.h, viewRef.current);
    const wp = worldAt(x, y);
    for (const sp of floor.spaces) {
      const poly = sp.polygon;
      if (poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i].x, yi = poly[i].y;
          const xj = poly[j].x, yj = poly[j].y;
          const intersect = ((yi > wp.y) !== (yj > wp.y)) && (wp.x < (xj - xi) * (wp.y - yi) / (yj - yi + 1e-9) + xi);
          if (intersect) inside = !inside;
        }
        if (inside) { onSelectSpace(sp.id); return; }
      } else {
        if (wp.x >= sp.rect.x && wp.x <= sp.rect.x + sp.rect.w && wp.y >= sp.rect.y && wp.y <= sp.rect.y + sp.rect.h) {
          onSelectSpace(sp.id);
          return;
        }
      }
    }
    onSelectSpace(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!candidate) return;
    const pan = 40;
    switch (e.key) {
      case 'ArrowLeft': setView(v => ({ ...v, px: v.px - pan })); break;
      case 'ArrowRight': setView(v => ({ ...v, px: v.px + pan })); break;
      case 'ArrowUp': setView(v => ({ ...v, py: v.py + pan })); break;
      case 'ArrowDown': setView(v => ({ ...v, py: v.py - pan })); break;
      case '+': case '=': zoomAt(size.w / 2, size.h / 2, 1.25); break;
      case '-': case '_': zoomAt(size.w / 2, size.h / 2, 1 / 1.25); break;
      case '0': setView({ z: 1, px: 0, py: 0 }); break;
      case 'Escape': onSelectSpace?.(null); break;
      default: return;
    }
    e.preventDefault();
  };

  const zoomBtn = (label: string, title: string, icon: React.ReactNode, fn: () => void) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={fn}
      disabled={!candidate}
      className="w-7 h-7 flex items-center justify-center rounded-md bg-ink-800/90 border border-ink-600 text-ink-400 hover:text-slate-100 hover:border-accent-400 transition-colors disabled:opacity-40"
    >
      {icon}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-0 min-w-0">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={tf('canvasAriaLabel', { floor: faNum(floorIndex + 1) })}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; setPanning(false); }}
        className={`absolute inset-0 w-full h-full rounded bg-ink-900 outline-none touch-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ display: 'block' }}
      />
      <div className="absolute bottom-2 left-2 flex gap-1 z-10">
        {zoomBtn(t('zoomInLabel'), t('zoomInLabel'), <IconPlus className="w-3.5 h-3.5" />, () => zoomAt(size.w / 2, size.h / 2, 1.25))}
        {zoomBtn(t('zoomOutLabel'), t('zoomOutLabel'), <IconMinus className="w-3.5 h-3.5" />, () => zoomAt(size.w / 2, size.h / 2, 1 / 1.25))}
        {zoomBtn(t('resetViewLabel'), t('resetViewLabel'), <IconFit className="w-3.5 h-3.5" />, () => setView({ z: 1, px: 0, py: 0 }))}
      </div>
    </div>
  );
}
