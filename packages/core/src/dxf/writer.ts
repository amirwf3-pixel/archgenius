/**
 * DXF R12 ASCII writer.
 *
 * R12 was chosen because it is universally supported by AutoCAD, LibreCAD,
 * DraftSight, ARES Commander, and online viewers. The format is a flat list
 * of (group-code, value) pairs with section markers.
 *
 * All coordinates are emitted in MILLIMETERS, INSUNITS=4. Angles in degrees
 * (counter-clockwise from East, matching AutoCAD default if $INSUNITS respect).
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Wall } from '../model/wall.js';
import type { Opening } from '../model/opening.js';
import type { Space } from '../model/space.js';
import type { Vec2 } from '../geometry/vec2.js';
import { MM_PER_M } from '../units.js';
import { LAYERS } from './layers.js';
import { rCorners } from '../geometry/rect.js';
import type { Rect } from '../geometry/rect.js';
import { vSub, vNorm } from '../geometry/vec2.js';

const CR = "\r\n";

/** Build a complete DXF ASCII document. */
export function writeDXF(candidate: LayoutCandidate, projectName = 'ArchGenius Plan'): string {
  const b: string[] = [];
  const push = (code: number | string, value: string | number) => {
    b.push(String(code));
    b.push(String(value));
  };

  // ---- HEADER SECTION ----
  b.push('0', 'SECTION');
  b.push('2', 'HEADER');
  push(9, '$ACADVER'); push(1, 'AC1009'); // R12
  push(9, '$INSUNITS'); push(70, 4); // millimeters
  push(9, '$LUNITS'); push(70, 2); // decimal
  push(9, '$MEASUREMENT'); push(70, 1); // metric
  push(9, '$DWGCODEPAGE'); push(3, 'ANSI_1252');
  // Extents computed while emitting entities; fill at end.
  const extMin = { x: Infinity, y: Infinity };
  const extMax = { x: -Infinity, y: -Infinity };
  b.push('0', 'ENDSEC');

  // ---- TABLES SECTION ----
  b.push('0', 'SECTION');
  b.push('2', 'TABLES');
  // LTYPE table — required linetypes
  b.push('0', 'TABLE', '2', 'LTYPE', '70', '3');
  writeLtype(b, 'CONTINUOUS', 'Solid line', [0.0]);
  writeLtype(b, 'CENTER', 'Center ____ _ ____ _ ____', [1.25, -0.25, 0.25, -0.25]);
  writeLtype(b, 'DASHED', 'Dashed __ __ __ __', [0.5, -0.25]);
  b.push('0', 'ENDTAB');
  // LAYER table
  b.push('0', 'TABLE', '2', 'LAYER', '70', String(LAYERS.length));
  for (const layer of LAYERS) {
    b.push('0', 'LAYER');
    push(2, layer.name);
    push(70, 0);
    push(62, layer.color);
    push(6, layer.linetype);
    push(370, layer.lineweight);
  }
  b.push('0', 'ENDTAB');
  // STYLE
  b.push('0', 'TABLE', '2', 'STYLE', '70', '1');
  b.push('0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0', '41', '1', '50', '0', '71', '0', '42', '0.2', '3', 'Arial', '4', '');
  b.push('0', 'ENDTAB');
  b.push('0', 'ENDSEC');

  // ---- BLOCKS SECTION ---- (minimal)
  b.push('0', 'SECTION', '2', 'BLOCKS');
  b.push('0', 'BLOCK', '2', '*Model_Space', '70', '0', '10', '0', '20', '0', '30', '0');
  b.push('0', 'ENDBLK');
  b.push('0', 'BLOCK', '2', '*Paper_Space', '70', '0', '10', '0', '20', '0', '30', '0');
  b.push('0', 'ENDBLK');
  b.push('0', 'ENDSEC');

  // ---- ENTITIES SECTION ----
  b.push('0', 'SECTION', '2', 'ENTITIES');

  const track = (x: number, y: number) => {
    if (x < extMin.x) extMin.x = x;
    if (y < extMin.y) extMin.y = y;
    if (x > extMax.x) extMax.x = x;
    if (y > extMax.y) extMax.y = y;
  };
  const mm = (m: number) => Math.round(m * MM_PER_M * 100) / 100;

  const emitLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    track(x1, y1); track(x2, y2);
    b.push('0', 'LINE');
    push(8, layer);
    push(10, mm(x1)); push(20, mm(y1));
    push(11, mm(x2)); push(21, mm(y2));
  };
  const emitCircle = (cx: number, cy: number, r: number, layer: string) => {
    track(cx + r, cy + r); track(cx - r, cy - r);
    b.push('0', 'CIRCLE');
    push(8, layer);
    push(10, mm(cx)); push(20, mm(cy));
    push(40, mm(r));
  };
  const emitArc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer: string) => {
    track(cx + r, cy + r); track(cx - r, cy - r);
    b.push('0', 'ARC');
    push(8, layer);
    push(10, mm(cx)); push(20, mm(cy));
    push(40, mm(r));
    push(50, startDeg);
    push(51, endDeg);
  };
  const emitText = (x: number, y: number, text: string, heightM: number, layer: string, horiz = 0 /* 0 left, 1 center, 2 right */) => {
    track(x, y);
    b.push('0', 'TEXT');
    push(8, layer);
    push(10, mm(x)); push(20, mm(y));
    push(40, mm(heightM));
    push(1, text);
    push(50, 0);
    push(72, horiz);
    push(11, mm(x)); push(21, mm(y));
  };
  const emitPolyline = (pts: Vec2[], layer: string, closed = true) => {
    b.push('0', 'POLYLINE');
    push(8, layer);
    push(66, 1);
    push(70, closed ? 1 : 0);
    for (const p of pts) {
      track(p.x, p.y);
      b.push('0', 'VERTEX');
      push(8, layer);
      push(10, mm(p.x)); push(20, mm(p.y));
    }
    b.push('0', 'SEQEND');
    push(8, layer);
  };

  // ---- Draw buildable-area outline (helper) ----
  for (let fi = 0; fi < candidate.floors.length; fi++) {
    const fl = candidate.floors[fi];
    if (fi === 0) {
      const fr = candidate.buildableArea;
      emitPolyline([
        { x: fr.x, y: fr.y }, { x: fr.x + fr.w, y: fr.y },
        { x: fr.x + fr.w, y: fr.y + fr.h }, { x: fr.x, y: fr.y + fr.h },
      ], 'A-BLDG-OUT', true);
    }

    // ---- Walls ----
    for (const w of fl.walls) {
      let layer: string;
      switch (w.kind) {
        case 'exterior': layer = 'A-WALL-EXT'; break;
        case 'core': layer = 'A-WALL-CORE'; break;
        case 'service': layer = 'A-WALL-SERVICE'; break;
        case 'partition': layer = 'A-WALL-PART'; break;
        default: layer = 'A-WALL-INT'; break;
      }
      emitWallWithOpenings(w, fl, emitLine, layer);
    }

    // ---- Openings ----
    for (const o of fl.openings) {
      if (o.type === 'window') {
        drawWindow(o, emitLine);
      } else {
        drawDoor(o, emitLine, emitArc);
      }
    }

    // ---- Stairs ----
    for (const st of fl.stairs) {
      drawStair(st, emitLine, emitText, emitPolyline);
    }

    // ---- Parking ----
    for (const stall of fl.parkingStalls) {
      const r = stall.rect;
      const [sw, se, ne, nw] = rCorners(r);
      emitLine(sw.x, sw.y, se.x, se.y, 'A-PARKING');
      emitLine(se.x, se.y, ne.x, ne.y, 'A-PARKING');
      emitLine(ne.x, ne.y, nw.x, nw.y, 'A-PARKING');
      emitLine(nw.x, nw.y, sw.x, sw.y, 'A-PARKING');
      emitText((sw.x + ne.x) / 2, (sw.y + ne.y) / 2 - 0.2, `P${stall.index}`, 0.25, 'A-PARKING', 1);
    }
    if (fl.parkingArea) {
      const a = fl.parkingArea.aisleRect;
      emitPolyline([
        { x: a.x, y: a.y }, { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h }, { x: a.x, y: a.y + a.h },
      ], 'A-PARKING', true);
      emitText(a.x + a.w / 2, a.y + a.h / 2, 'AISLE', 0.25, 'A-PARKING', 1);
    }

    // ---- Room labels + areas ----
    for (const s of fl.spaces) {
      const cx = s.rect.x + s.rect.w / 2;
      const cy = s.rect.y + s.rect.h / 2;
      const h = Math.min(0.35, Math.max(0.18, Math.min(s.rect.w, s.rect.h) * 0.08));
      emitText(cx, cy + h * 0.5, s.label, h, 'A-ROOM', 1);
      emitText(cx, cy - h * 0.7, `${s.area.toFixed(1)} m²`, h * 0.7, 'A-ROOM', 1);
    }

    // ---- Grid / Axis (Phase 6) ----
    if (fi === 0) emitGrid(candidate.buildableArea, emitLine, emitText);

    // ---- Dimensions (improved) ----
    emitOuterDimensions(fl.footprint, emitLine, emitText);
    emitRoomDimensions(fl.spaces, emitLine, emitText);

    // ---- North arrow ----
    if (fi === 0) drawNorthArrow(fl.footprint.x + fl.footprint.w - 1.2, fl.footprint.y + fl.footprint.h - 0.3, emitLine, emitText);

    // ---- Title block ----
    if (fi === 0) drawTitleBlock(candidate, projectName, emitLine, emitText, track);
  }

  b.push('0', 'ENDSEC');

  // ---- EOF ----
  b.push('0', 'EOF');

  // Patch extents into header by rewriting header section? Simpler: rebuild header now with real extents.
  const final = [] as string[];
  final.push('0', 'SECTION', '2', 'HEADER');
  final.push('9', '$ACADVER', '1', 'AC1009');
  final.push('9', '$INSUNITS', '70', '4');
  final.push('9', '$LUNITS', '70', '2');
  final.push('9', '$MEASUREMENT', '70', '1');
  final.push('9', '$DWGCODEPAGE', '3', 'ANSI_1252');
  if (isFinite(extMin.x)) {
    final.push('9', '$EXTMIN', '10', String(mm(extMin.x)), '20', String(mm(extMin.y)), '30', '0');
    final.push('9', '$EXTMAX', '10', String(mm(extMax.x)), '20', String(mm(extMax.y)), '30', '0');
    final.push('9', '$LIMMIN', '10', String(mm(extMin.x)), '20', String(mm(extMin.y)));
    final.push('9', '$LIMMAX', '10', String(mm(extMax.x)), '20', String(mm(extMax.y)));
  }
  final.push('0', 'ENDSEC');
  // Replace the placeholder header that was first in b[] (we pushed HEADER..ENDSEC, 6 lines + ENDSEC = see below)
  // Instead of splicing, rebuild: final header (with extents) + rest of b after its ENDSEC.
  const headerEndIdx = b.indexOf('ENDSEC', b.indexOf('HEADER'));
  const afterHeader = b.slice(headerEndIdx + 1); // past ENDSEC
  const doc = [...final, ...afterHeader].join(CR) + CR;
  return doc;
}

/** Emit wall as two parallel lines, broken around openings. */
function emitWallWithOpenings(
  w: Wall,
  floor: Floor,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  layer: string,
) {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len, uy = dy / len; // wall direction
  const nx = -uy, ny = ux; // left normal
  const thk = w.thickness / 2;

  // Collect opening ranges along the wall centerline [0..len]
  interface Range { from: number; to: number; }
  const openings: Range[] = [];
  for (const oid of w.openingIds) {
    const o = floor.openings.find(op => op.id === oid);
    if (!o) continue;
    // Project center onto segment: offset from start
    const px = o.center.x - w.start.x;
    const py = o.center.y - w.start.y;
    const offset = px * ux + py * uy;
    const from = Math.max(0, offset - o.width / 2);
    const to = Math.min(len, offset + o.width / 2);
    openings.push({ from, to });
  }
  openings.sort((a, b) => a.from - b.from);

  // Build solid wall spans (inverse of openings, plus end caps)
  const spans: Range[] = [];
  let cursor = 0;
  for (const op of openings) {
    if (op.from > cursor + 1e-4) spans.push({ from: cursor, to: op.from });
    cursor = Math.max(cursor, op.to);
  }
  if (cursor < len - 1e-4) spans.push({ from: cursor, to: len });

  for (const s of spans) {
    // offset from wall centerline by thickness/2 to both sides
    const a = { x: w.start.x + ux * s.from, y: w.start.y + uy * s.from };
    const b = { x: w.start.x + ux * s.to, y: w.start.y + uy * s.to };
    // left edge
    emitLine(a.x + nx * thk, a.y + ny * thk, b.x + nx * thk, b.y + ny * thk, layer);
    // right edge
    emitLine(a.x - nx * thk, a.y - ny * thk, b.x - nx * thk, b.y - ny * thk, layer);
    // end caps at span endpoints (only when adjacent to an opening or at wall start/end)
    if (s.from === 0) {
      emitLine(a.x + nx * thk, a.y + ny * thk, a.x - nx * thk, a.y - ny * thk, layer);
    }
    if (s.to === len) {
      emitLine(b.x + nx * thk, b.y + ny * thk, b.x - nx * thk, b.y - ny * thk, layer);
    }
  }

  // End caps around openings
  for (const op of openings) {
    const a = { x: w.start.x + ux * op.from, y: w.start.y + uy * op.from };
    const b = { x: w.start.x + ux * op.to, y: w.start.y + uy * op.to };
    emitLine(a.x + nx * thk, a.y + ny * thk, a.x - nx * thk, a.y - ny * thk, layer);
    emitLine(b.x + nx * thk, b.y + ny * thk, b.x - nx * thk, b.y - ny * thk, layer);
  }
}

function drawWindow(o: Opening, emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void) {
  // Draw a triple-line representation: two outer lines (wall edges) and a middle glass line
  // For V1, draw two short lines across the opening width.
  const wd = vNorm(vSub({ x: o.wallDir.y, y: -o.wallDir.x }, { x: 0, y: 0 })); // perpendicular
  // wallDir is unit; perpendicular = (-wallDir.y, wallDir.x)
  const perp: Vec2 = { x: -o.wallDir.y, y: o.wallDir.x };
  // draw four parallel lines along wall direction between opening ends
  const half = o.width / 2;
  const center = o.center;
  const along = o.wallDir;
  const depth = 0.04; // distance between lines
  for (const sign of [-1.5, -0.5, 0.5, 1.5]) {
    const cx = center.x + perp.x * depth * sign;
    const cy = center.y + perp.y * depth * sign;
    emitLine(cx - along.x * half, cy - along.y * half, cx + along.x * half, cy + along.y * half, 'A-WINDOW');
  }
}

function drawDoor(
  o: Opening,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitArc: (cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer: string) => void,
) {
  const along = o.wallDir;
  const n = o.normal;
  let hinge: Vec2, closedEnd: Vec2, openEnd: Vec2;
  if (o.hinge && o.leafEnd && o.openEnd) {
    hinge = o.hinge;
    closedEnd = o.leafEnd;
    openEnd = o.openEnd;
  } else {
    const hingeSign = o.swing === 'right' ? 1 : -1;
    hinge = {
      x: o.center.x + along.x * (o.width / 2) * hingeSign,
      y: o.center.y + along.y * (o.width / 2) * hingeSign,
    };
    closedEnd = {
      x: o.center.x - along.x * (o.width / 2) * hingeSign,
      y: o.center.y - along.y * (o.width / 2) * hingeSign,
    };
    openEnd = {
      x: hinge.x + n.x * o.width,
      y: hinge.y + n.y * o.width,
    };
  }
  emitLine(hinge.x, hinge.y, closedEnd.x, closedEnd.y, 'A-DOOR');
  const a1 = Math.atan2(closedEnd.y - hinge.y, closedEnd.x - hinge.x) * 180 / Math.PI;
  const a2 = Math.atan2(openEnd.y - hinge.y, openEnd.x - hinge.x) * 180 / Math.PI;
  let start = a1, end = a2;
  let diff = end - start;
  while (diff < 0) diff += 360;
  while (diff > 360) diff -= 360;
  if (diff > 180) {
    const t = start; start = end; end = t;
  }
  if (end < start) end += 360;
  emitArc(hinge.x, hinge.y, o.width, start, end, 'A-DOOR');
  if (o.leafThickness) {
    const perpOpen: Vec2 = { x: -n.y, y: n.x };
    const thk = o.leafThickness;
    emitLine(openEnd.x, openEnd.y, openEnd.x + perpOpen.x * thk, openEnd.y + perpOpen.y * thk, 'A-DOOR');
  }
}

function drawStair(
  st: any,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  emitPolyline: (pts: Vec2[], layer: string, closed?: boolean) => void,
) {
  const rect: Rect = st.footprint ?? st.rect;
  // Stairwell outline
  const [sw, se, ne, nw] = rCorners(rect);
  emitPolyline([sw, se, ne, nw], 'A-STAIR', true);

  const flights: any[] = st.flights ?? [];
  const landings: any[] = st.landings ?? [];

  if (flights.length === 0) {
    // Legacy fallback: simple parallel tread lines.
    const t = Math.max(0.25, st.tread ?? 0.28);
    const x0 = rect.x + 0.1;
    const x1 = rect.x + rect.w - 0.1;
    let y = rect.y + 0.3;
    while (y < rect.y + rect.h - 0.3) {
      emitLine(x0, y, x1, y, 'A-STAIR-TREAD');
      y += t;
    }
    emitText(rect.x + rect.w - 0.6, rect.y + rect.h - 0.3, 'UP', 0.2, 'A-STAIR-DIR');
    return;
  }

  // Landing fills: draw outline for each landing on A-STAIR.
  for (const l of landings) {
    const lr = l.footprint as Rect;
    const [a, b, c, d] = rCorners(lr);
    emitPolyline([a, b, c, d], 'A-STAIR', true);
    emitText(lr.x + lr.w / 2, lr.y + lr.h / 2, 'LDNG', 0.18, 'A-STAIR', 1);
  }

  // Flights: draw parallel tread lines across each flight, perpendicular
  // to the direction of travel.
  for (const fl of flights) {
    const fr = fl.footprint as Rect;
    const dir: string = fl.direction;
    // Flight boundary (lighter, same outline color).
    const [a, b, c, d] = rCorners(fr);
    emitPolyline([a, b, c, d], 'A-STAIR', false);
    const t = Math.max(0.22, fl.treadDepth ?? 0.28);
    if (dir === 'north' || dir === 'south') {
      // Horizontal treads spanning east-west; y varies.
      const x0 = fr.x;
      const x1 = fr.x + fr.w;
      // Start at startPoint.y; step by tread towards endPoint.y.
      const yStart = fl.startPoint.y;
      const yEnd = fl.endPoint.y;
      const step = yEnd > yStart ? t : -t;
      for (let y = yStart + step; Math.abs(y - yEnd) > 0.005; y += step) {
        if (y < fr.y - 0.005 || y > fr.y + fr.h + 0.005) break;
        emitLine(x0, y, x1, y, 'A-STAIR-TREAD');
      }
    } else {
      // Vertical treads spanning north-south; x varies.
      const y0 = fr.y;
      const y1 = fr.y + fr.h;
      const xStart = fl.startPoint.x;
      const xEnd = fl.endPoint.x;
      const step = xEnd > xStart ? t : -t;
      for (let x = xStart + step; Math.abs(x - xEnd) > 0.005; x += step) {
        if (x < fr.x - 0.005 || x > fr.x + fr.w + 0.005) break;
        emitLine(x, y0, x, y1, 'A-STAIR-TREAD');
      }
    }
    // Direction arrow at mid-run.
    const cx = (fl.startPoint.x + fl.endPoint.x) / 2;
    const cy = (fl.startPoint.y + fl.endPoint.y) / 2;
    drawDirArrow(cx, cy, dir, emitLine, 0.35);
  }

  // "UP" label at the bottom of the lowest flight.
  const bottom = flights.reduce((p: any, c: any) =>
    c.startPoint.y < p.startPoint.y ? c : p, flights[0]);
  emitText(bottom.startPoint.x - 0.25, bottom.startPoint.y - 0.05, 'UP', 0.18, 'A-STAIR-DIR');
  // Flight / riser annotation.
  const label = `${flights.length}F · ${st.totalRisers}R @ ${((st.riserHeight ?? st.riser ?? 0)*100).toFixed(0)}×${((st.treadDepth ?? st.tread ?? 0)*100).toFixed(0)}`;
  emitText(rect.x + 0.1, rect.y + rect.h - 0.15, label, 0.15, 'A-STAIR-DIR');
}

/** Draw a small arrow pointing in `dir` direction, centered at (cx,cy). */
function drawDirArrow(
  cx: number, cy: number, dir: string,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  size = 0.3,
) {
  let tipX = cx, tipY = cy;
  let bx = cx, by = cy;
  switch (dir) {
    case 'north': tipY = cy + size; by = cy - size; break;
    case 'south': tipY = cy - size; by = cy + size; break;
    case 'east':  tipX = cx + size; bx = cx - size; break;
    case 'west':  tipX = cx - size; bx = cx + size; break;
  }
  emitLine(bx, by, tipX, tipY, 'A-STAIR-DIR');
  // Arrowhead
  if (dir === 'north' || dir === 'south') {
    const s = dir === 'north' ? -1 : 1;
    emitLine(tipX, tipY, tipX - 0.08, tipY + s * 0.12, 'A-STAIR-DIR');
    emitLine(tipX, tipY, tipX + 0.08, tipY + s * 0.12, 'A-STAIR-DIR');
  } else {
    const s = dir === 'east' ? -1 : 1;
    emitLine(tipX, tipY, tipX + s * 0.12, tipY - 0.08, 'A-STAIR-DIR');
    emitLine(tipX, tipY, tipX + s * 0.12, tipY + 0.08, 'A-STAIR-DIR');
  }
}

function drawNorthArrow(
  cx: number, cy: number,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
) {
  const size = 0.8;
  emitLine(cx, cy, cx, cy + size, 'A-NORTH');
  emitLine(cx, cy + size, cx - 0.15, cy + size - 0.3, 'A-NORTH');
  emitLine(cx, cy + size, cx + 0.15, cy + size - 0.3, 'A-NORTH');
  emitCircleStub(cx, cy, size * 0.2, emitLine);
  emitText(cx, cy + size + 0.2, 'N', 0.25, 'A-NORTH', 1);
}

function emitCircleStub(
  cx: number, cy: number, r: number,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
) {
  // Draw a circle using line segments (polygon). A proper CIRCLE entity isn't used here
  // to keep this helper independent; caller can use emitCircle instead — but used for
  // north arrow circle in a line-only fashion.
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a1 = (i / n) * Math.PI * 2;
    const a2 = ((i + 1) / n) * Math.PI * 2;
    emitLine(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, 'A-NORTH');
  }
}

function drawTitleBlock(
  cand: LayoutCandidate,
  projectName: string,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  _track: (x: number, y: number) => void,
) {
  // Place a simple title block below the plan in model space.
  const pad = 1.5;
  const fr = cand.floors[0].footprint;
  const bx0 = fr.x - pad;
  const by0 = fr.y - pad - 2.5;
  const bx1 = fr.x + fr.w + pad;
  const by1 = fr.y + fr.h + pad;
  // outer border around full drawing (approximate)
  emitLine(bx0, by0, bx1, by0, 'A-TITLE');
  emitLine(bx1, by0, bx1, by1, 'A-TITLE');
  emitLine(bx1, by1, bx0, by1, 'A-TITLE');
  emitLine(bx0, by1, bx0, by0, 'A-TITLE');
  // Title block bottom-right
  const tw = 10, th = 2;
  const tx0 = bx1 - tw, ty0 = by0;
  emitLine(tx0, ty0, bx1, ty0, 'A-TITLE');
  emitLine(tx0, ty0 + th, bx1, ty0 + th, 'A-TITLE');
  emitLine(tx0, ty0, tx0, ty0 + th, 'A-TITLE');
  emitLine(bx1, ty0, bx1, ty0 + th, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + th - 0.5, projectName, 0.4, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + th - 1.0, 'ArchGenius — AI Architectural Planning & Professional AutoCAD System', 0.22, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + 0.3, `Strategy: ${cand.metadata.strategy} | Floors: ${cand.floors.length} | Scale: 1:100`, 0.2, 'A-TITLE');
}

function emitGrid(
  fr: Rect,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
) {
  // Simple axis grid: one vertical and one horizontal line at footprint edges + center
  const cx = fr.x + fr.w / 2;
  const cy = fr.y + fr.h / 2;
  // Vertical grid lines
  emitLine(fr.x, fr.y - 0.5, fr.x, fr.y + fr.h + 0.5, 'A-GRID');
  emitLine(cx, fr.y - 0.5, cx, fr.y + fr.h + 0.5, 'A-AXIS');
  emitLine(fr.x + fr.w, fr.y - 0.5, fr.x + fr.w, fr.y + fr.h + 0.5, 'A-GRID');
  // Horizontal grid lines
  emitLine(fr.x - 0.5, fr.y, fr.x + fr.w + 0.5, fr.y, 'A-GRID');
  emitLine(fr.x - 0.5, cy, fr.x + fr.w + 0.5, cy, 'A-AXIS');
  emitLine(fr.x - 0.5, fr.y + fr.h, fr.x + fr.w + 0.5, fr.y + fr.h, 'A-GRID');
  // Labels
  emitText(fr.x - 0.7, fr.y + fr.h + 0.3, 'A', 0.25, 'A-AXIS-TEXT', 1);
  emitText(cx, fr.y + fr.h + 0.3, 'B', 0.25, 'A-AXIS-TEXT', 1);
  emitText(fr.x + fr.w + 0.3, fr.y + fr.h + 0.3, 'C', 0.25, 'A-AXIS-TEXT', 0);
  emitText(fr.x - 0.7, fr.y - 0.7, '1', 0.25, 'A-AXIS-TEXT', 2);
  emitText(fr.x - 0.7, cy, '2', 0.25, 'A-AXIS-TEXT', 2);
}

function emitRoomDimensions(
  spaces: Space[],
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
) {
  // Emit small dimension lines for each room (width/height)
  for (const s of spaces) {
    if (s.type === 'parking' || s.type === 'yard') continue;
    // Only for rooms larger than 2m in both dimensions to avoid clutter
    if (s.rect.w < 2 || s.rect.h < 2) continue;
    const r = s.rect;
    const off = 0.15;
    // Bottom edge dimension
    emitLine(r.x, r.y - off, r.x + r.w, r.y - off, 'A-DIMS');
    emitText(r.x + r.w / 2, r.y - off - 0.15, `${r.w.toFixed(2)}`, 0.12, 'A-DIMS', 1);
    // Left edge dimension
    emitLine(r.x - off, r.y, r.x - off, r.y + r.h, 'A-DIMS');
    // Use vertical text for height — horizontal for simplicity
    emitText(r.x - off - 0.2, r.y + r.h / 2, `${r.h.toFixed(2)}`, 0.12, 'A-DIMS', 2);
  }
}

function emitOuterDimensions(
  fr: Rect,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
) {
  const off = 1.0;
  emitLine(fr.x, fr.y - off, fr.x + fr.w, fr.y - off, 'A-DIMS');
  emitText((fr.x + fr.x + fr.w) / 2, fr.y - off - 0.3, `${(fr.w).toFixed(2)} m`, 0.22, 'A-DIMS', 1);
  emitLine(fr.x, fr.y - off - 0.15, fr.x, fr.y - off + 0.15, 'A-DIMS');
  emitLine(fr.x + fr.w, fr.y - off - 0.15, fr.x + fr.w, fr.y - off + 0.15, 'A-DIMS');
  emitLine(fr.x - off, fr.y, fr.x - off, fr.y + fr.h, 'A-DIMS');
  emitText(fr.x - off - 0.3, (fr.y + fr.y + fr.h) / 2, `${(fr.h).toFixed(2)} m`, 0.22, 'A-DIMS', 1);
  emitLine(fr.x - off - 0.15, fr.y, fr.x - off + 0.15, fr.y, 'A-DIMS');
  emitLine(fr.x - off - 0.15, fr.y + fr.h, fr.x - off + 0.15, fr.y + fr.h, 'A-DIMS');
}

function writeLtype(b: string[], name: string, desc: string, pattern: number[]) {
  b.push('0', 'LTYPE');
  b.push('2', name);
  b.push('70', '0');
  b.push('3', desc);
  const elements = pattern.filter(p => Math.abs(p) > 1e-9).length;
  b.push('73', String(elements));
  let totalLen = 0;
  for (const p of pattern) totalLen += Math.abs(p);
  b.push('40', String(totalLen || 0));
  for (const p of pattern) {
    if (Math.abs(p) < 1e-9) continue;
    b.push('49', String(p));
    b.push('74', '0');
  }
}

/** Validate the structural integrity of a generated DXF string (lightweight). */
export function validateDXFStructure(dxf: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = dxf.split(/\r?\n/);
  if (!lines.includes('SECTION')) errors.push('Missing SECTION');
  if (!lines.includes('ENTITIES')) errors.push('Missing ENTITIES section');
  if (!lines.includes('EOF')) errors.push('Missing EOF');
  if (!lines.includes('LAYER')) errors.push('Missing LAYER table');
  for (const name of ['A-WALL-EXT', 'A-WALL-INT', 'A-DOOR', 'A-WINDOW', 'A-ROOM', 'A-DIMS', 'A-STAIR', 'A-STAIR-TREAD', 'A-STAIR-DIR', 'A-GRID', 'A-AXIS', 'A-NORTH', 'A-TITLE', 'A-PARKING']) {
    if (!lines.includes(name)) errors.push(`Missing layer entry: ${name}`);
  }
  // Check INSUNITS=4 (mm)
  if (!dxf.includes('$INSUNITS') || !dxf.includes('4')) {
    errors.push('Missing INSUNITS=4 (mm) in HEADER');
  }
  return { ok: errors.length === 0, errors };
}
