import React, { useEffect, useRef } from 'react';
import type { LayoutCandidate } from '@archgenius/core';

interface Props {
  candidate: LayoutCandidate | null;
  width?: number;
  height?: number;
}

/**
 * Canvas-based 2D preview of the selected floor plan.
 * Coordinates are in meters; we scale to fit with padding and flip Y so
 * North is up.
 */
export function PlanCanvas({ candidate, width = 900, height = 600 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!candidate) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No plan generated yet. Enter parameters and click Generate.', canvas.width / 2, canvas.height / 2);
      return;
    }

    const floor = candidate.floors[0];
    // Compute world bounds (include parking stalls in the view)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (x: number, y: number, w: number, h: number) => {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w; if (y + h > maxY) maxY = y + h;
    };
    expand(floor.footprint.x, floor.footprint.y, floor.footprint.w, floor.footprint.h);
    for (const s of floor.parkingStalls) expand(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
    if (floor.parkingArea) expand(floor.parkingArea.aisleRect.x, floor.parkingArea.aisleRect.y, floor.parkingArea.aisleRect.w, floor.parkingArea.aisleRect.h);

    const pad = 40;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    const scale = Math.min((canvas.width - pad * 2) / worldW, (canvas.height - pad * 2) / worldH);
    const ox = pad + (canvas.width - pad * 2 - worldW * scale) / 2;
    const oy = pad + (canvas.height - pad * 2 - worldH * scale) / 2;
    const tx = (x: number) => ox + (x - minX) * scale;
    // flip Y: world y=minY -> canvas bottom
    const ty = (y: number) => canvas.height - oy - (y - minY) * scale;

    // Helper to draw a filled rect (for walls/rooms)
    const drawRect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
      ctx.fillStyle = fill;
      ctx.fillRect(tx(x), ty(y + h), w * scale, h * scale);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(tx(x), ty(y + h), w * scale, h * scale);
      }
    };

    // Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridStep = 1; // 1m
    for (let gx = Math.floor(minX); gx <= Math.ceil(maxX); gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(gx), ty(minY)); ctx.lineTo(tx(gx), ty(maxY)); ctx.stroke();
    }
    for (let gy = Math.floor(minY); gy <= Math.ceil(maxY); gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(minX), ty(gy)); ctx.lineTo(tx(maxX), ty(gy)); ctx.stroke();
    }

    // Parking
    for (const stall of floor.parkingStalls) {
      drawRect(stall.rect.x, stall.rect.y, stall.rect.w, stall.rect.h, 'rgba(100,116,139,0.15)', '#475569');
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${Math.max(10, 10)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`P${stall.index}`, tx(stall.rect.x + stall.rect.w / 2), ty(stall.rect.y + stall.rect.h / 2) + 3);
    }
    if (floor.parkingArea) {
      const a = floor.parkingArea.aisleRect;
      ctx.strokeStyle = '#64748b';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(tx(a.x), ty(a.y + a.h), a.w * scale, a.h * scale);
      ctx.setLineDash([]);
    }

    // Buildable area outline
    const b = candidate.buildableArea;
    ctx.strokeStyle = '#60a5fa';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(tx(b.x), ty(b.y + b.h), b.w * scale, b.h * scale);
    ctx.setLineDash([]);

    // Rooms (slight fill)
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
    for (const s of floor.spaces) {
      const fill = roomFill[s.type] ?? 'rgba(100,116,139,0.08)';
      drawRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h, fill);
    }

    // Walls: draw thick lines for each wall's centerline scaled so thickness ≈ the real thickness
    ctx.lineCap = 'square';
    for (const w of floor.walls) {
      ctx.strokeStyle = w.kind === 'exterior' ? '#f1f5f9' : '#cbd5e1';
      ctx.lineWidth = Math.max(1.5, w.thickness * scale);
      ctx.beginPath();
      ctx.moveTo(tx(w.start.x), ty(w.start.y));
      ctx.lineTo(tx(w.end.x), ty(w.end.y));
      ctx.stroke();
    }

    // Openings: doors in green, windows in cyan
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
        // door leaf is a single line perpendicular to wall in normal direction
        const hx = o.center.x - dx;
        const hy = o.center.y - dy;
        // Hinge side depends on swing; for preview just draw leaf from -end toward normal
        ctx.beginPath();
        ctx.moveTo(tx(hx), ty(hy));
        ctx.lineTo(tx(o.center.x + o.normal.x * o.width - dx * 0), ty(o.center.y + o.normal.y * o.width - dy * 0));
        ctx.stroke();
        // swing arc
        ctx.beginPath();
        ctx.strokeStyle = '#34d39966';
        const ang = Math.atan2(o.normal.y, o.normal.x);
        const rpx = tx(hx), rpy = ty(hy);
        const r = o.width * scale;
        ctx.arc(rpx, rpy, r, -ang - Math.PI / 2, -ang, false);
        ctx.stroke();
      }
    }

    // Stairs: diagonal hatching
    for (const st of floor.stairs) {
      const sx = st.rect.x, sy = st.rect.y, sw = st.rect.w, sh = st.rect.h;
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 1;
      const steps = Math.max(4, Math.floor(sh / (st.tread || 0.3)));
      for (let i = 1; i < steps; i++) {
        const yy = sy + (sh * i / steps);
        ctx.beginPath();
        ctx.moveTo(tx(sx), ty(yy));
        ctx.lineTo(tx(sx + sw), ty(yy));
        ctx.stroke();
      }
    }

    // Room labels
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    for (const s of floor.spaces) {
      const fs = Math.max(9, Math.min(13, Math.min(s.rect.w, s.rect.h) * scale * 0.18));
      ctx.font = `${fs}px Inter, sans-serif`;
      const cx = s.rect.x + s.rect.w / 2;
      const cy = s.rect.y + s.rect.h / 2;
      ctx.fillText(s.label, tx(cx), ty(cy) + fs * 0.2);
      ctx.font = `${fs * 0.75}px Inter, sans-serif`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${s.area.toFixed(1)} m²`, tx(cx), ty(cy) + fs * 1.1);
      ctx.fillStyle = '#e2e8f0';
    }

    // North arrow
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'left';
    const nx = tx(minX) + 12, ny = ty(maxY) + 18;
    ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx - 4, ny + 2); ctx.lineTo(nx + 4, ny + 2); ctx.closePath(); ctx.fill();
    ctx.fillText('N', nx - 3, ny + 18);

    // Scale bar (5m)
    const barLen = 5;
    const bx = tx(maxX) - barLen * scale - 20;
    const by = ty(minY) - 20;
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barLen * scale, by); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`0`, bx, by + 14);
    ctx.fillText(`${barLen}m`, bx + barLen * scale, by + 14);
  }, [candidate, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full rounded bg-ink-900"
      style={{ display: 'block' }}
    />
  );
}
