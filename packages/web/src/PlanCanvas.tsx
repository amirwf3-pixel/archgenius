import React, { useEffect, useRef } from 'react';
import type { LayoutCandidate } from '@archgenius/core';

interface Props {
  candidate: LayoutCandidate | null;
  floorIndex?: number;
  width?: number;
  height?: number;
}

export function PlanCanvas({ candidate, floorIndex = 0, width = 900, height = 600 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!candidate) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No plan generated yet. Enter parameters and click Generate.', canvas.width / 2, canvas.height / 2);
      return;
    }

    const fi = Math.max(0, Math.min(floorIndex, candidate.floors.length - 1));
    const floor = candidate.floors[fi];
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
    const ty = (y: number) => canvas.height - oy - (y - minY) * scale;

    const drawRect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
      ctx.fillStyle = fill;
      ctx.fillRect(tx(x), ty(y + h), w * scale, h * scale);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(tx(x), ty(y + h), w * scale, h * scale);
      }
    };

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridStep = 1;
    for (let gx = Math.floor(minX); gx <= Math.ceil(maxX); gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(gx), ty(minY)); ctx.lineTo(tx(gx), ty(maxY)); ctx.stroke();
    }
    for (let gy = Math.floor(minY); gy <= Math.ceil(maxY); gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(minX), ty(gy)); ctx.lineTo(tx(maxX), ty(gy)); ctx.stroke();
    }

    for (const stall of floor.parkingStalls) {
      drawRect(stall.rect.x, stall.rect.y, stall.rect.w, stall.rect.h, 'rgba(100,116,139,0.15)', '#475569');
      ctx.fillStyle = '#94a3b8';
      ctx.font = `10px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`P${stall.index} F${fi}`, tx(stall.rect.x + stall.rect.w / 2), ty(stall.rect.y + stall.rect.h / 2) + 3);
    }
    if (floor.parkingArea) {
      const a = floor.parkingArea.aisleRect;
      ctx.strokeStyle = '#64748b';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(tx(a.x), ty(a.y + a.h), a.w * scale, a.h * scale);
      ctx.setLineDash([]);
    }

    const b = candidate.buildableArea;
    ctx.strokeStyle = '#60a5fa';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(tx(b.x), ty(b.y + b.h), b.w * scale, b.h * scale);
    ctx.setLineDash([]);

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

    ctx.lineCap = 'square';
    for (const w of floor.walls) {
      ctx.strokeStyle = w.kind === 'exterior' ? '#f1f5f9' : '#cbd5e1';
      ctx.lineWidth = Math.max(1.5, w.thickness * scale);
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
        ctx.arc(tx(hx), ty(hy), o.width * scale, -ang - Math.PI / 2, -ang, false);
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
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`STAIR F${fi}`, tx(sx), ty(sy + sh) - 4);
    }

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

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'left';
    const nx = tx(minX) + 12, ny = ty(maxY) + 18;
    ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx - 4, ny + 2); ctx.lineTo(nx + 4, ny + 2); ctx.closePath(); ctx.fill();
    ctx.fillText('N', nx - 3, ny + 18);
    ctx.fillText(`Floor ${fi} / ${candidate.floors.length - 1} — ${floor.spaces.length} spaces — Whole-Building ${candidate.floors.length}F`, tx(minX), ty(minY) - 8);

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
  }, [candidate, floorIndex, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="w-full h-full rounded bg-ink-900" style={{ display: 'block' }} />;
}
