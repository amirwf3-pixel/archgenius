/**
 * DXF R12 ASCII writer.
 *
 * R12 was chosen because it is universally supported by AutoCAD, LibreCAD,
 * DraftSight, ARES Commander, and online viewers. The format is a flat list
 * of (group-code, value) pairs with section markers.
 *
 * All coordinates are emitted in MILLIMETRES. (R12/AC1009 has no $INSUNITS
 * variable — it is a post-R12 header variable — so units are implied by the
 * millimetre-scale drawing content.) Angles in degrees (counter-clockwise from East).
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

/**
 * Phase-A DXF fix — TEXT encoding policy for R12.
 *
 * DXF R12 (AC1009) predates Unicode and has no $DWGCODEPAGE (R13+),
 * so every TEXT value must be ASCII-safe. Deterministic policy,
 * applied ONLY to the DXF representation (the web UI keeps full Persian):
 *   1. printable ASCII passes through unchanged;
 *   2. common typography is mapped (— → -, ² → 2, · → ., × → x, …);
 *   3. Persian/Arabic script is transliterated to Latin (deterministic
 *      letter-by-letter fallback label, not a translation);
 *   4. bidi/zero-width controls and Arabic diacritics are dropped;
 *   5. anything else non-ASCII becomes '?'.
 */
const DXF_CHAR_MAP: Record<string, string> = {
  '\u2014': '-', '\u2013': '-', '\u2012': '-', '\u2015': '-', '\u2212': '-',
  '\u00B2': '2', '\u00B3': '3', '\u00B9': '1',
  '\u00B7': '.', '\u2022': '.', '\u00D7': 'x', '\u00F7': '/',
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2026': '...',
  '\u00B0': 'deg', '\u00B1': '+/-', '\u2264': '<=', '\u2265': '>=',
  '\t': ' ', '\n': ' ', '\r': ' ',
  '\u200B': '', '\u200C': '', '\u200D': '', '\u200E': '', '\u200F': '', '\u061C': '', '\uFEFF': '',
};

/** Persian/Arabic → Latin transliteration (deterministic fallback labels). */
const PERSIAN_TRANSLIT: Record<string, string> = {
  '\u0622': 'a', '\u0623': 'a', '\u0625': 'e', '\u0626': 'y', '\u0627': 'a',
  '\u0621': '', '\u0628': 'b', '\u067E': 'p', '\u0629': 'h', '\u062A': 't',
  '\u062B': 's', '\u062C': 'j', '\u0686': 'ch', '\u062D': 'h', '\u062E': 'kh',
  '\u062F': 'd', '\u0630': 'z', '\u0631': 'r', '\u0632': 'z', '\u0698': 'zh',
  '\u0633': 's', '\u0634': 'sh', '\u0635': 's', '\u0636': 'z', '\u0637': 't',
  '\u0638': 'z', '\u0639': 'a', '\u063A': 'gh', '\u0640': '', '\u0641': 'f',
  '\u0642': 'q', '\u06A9': 'k', '\u06AF': 'g', '\u0644': 'l', '\u0645': 'm',
  '\u0646': 'n', '\u0648': 'v', '\u0647': 'h', '\u06D5': 'a', '\u06CC': 'y',
  '\u064A': 'y', '\u0643': 'k',
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
  '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
};

/** Arabic diacritics / combining marks — dropped. */
const DXF_DROP = /[\u064B-\u0655\u0670]/;

/** Deterministic ASCII-safe representation of a TEXT value for DXF R12 output. */
export function dxfSafeText(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch >= ' ' && ch <= '~') { out += ch; continue; }
    if (Object.prototype.hasOwnProperty.call(DXF_CHAR_MAP, ch)) { out += DXF_CHAR_MAP[ch]; continue; }
    if (Object.prototype.hasOwnProperty.call(PERSIAN_TRANSLIT, ch)) { out += PERSIAN_TRANSLIT[ch]; continue; }
    if (DXF_DROP.test(ch)) continue;
    out += '?';
  }
  return out;
}

/**
 * Phase 9 — Build a complete DXF ASCII document with multi-floor identity.
 * - All floors represented (no silent ground-floor-only)
 * - Floor-specific layers: A-FLOOR-0-WALL-EXT, A-FLOOR-1-WALL-EXT, etc. — authoritative namespace
 * - Generic base layers (A-WALL-EXT etc) are emitted for floor 0 ONLY for backward compatibility — NOT second geometry
 * - Vertical offset per floor in model space to separate floors visually (stacked north)
 *   FLOOR_GAP_M = 4m gap between floors in presentation space, not architectural elevation
 *   floorOffset(fi) = fi * (maxFootprintH + FLOOR_GAP_M) — presentation transformation only
 * - Preserves R12 ASCII, millimetre-scale (no $INSUNITS, R13+), deterministic.
 * - Single source of truth: candidate.floors geometry.
 *
 * Phase 9.1 — Optional includeGenericLayers flag (default true) to disable backward compat generic layers if needed.
 */
export interface DXFOptions {
  includeGenericLayers?: boolean; // default true — emit generic base layers for floor 0 for backward compat
}
export function writeDXF(candidate: LayoutCandidate, projectName = 'ArchGenius Plan', options: DXFOptions = {}): string {
  const includeGenericLayers = options.includeGenericLayers ?? true;
  const b: string[] = [];
  const push = (code: number | string, value: string | number) => {
    b.push(String(code));
    b.push(String(value));
  };

  // ---- HEADER SECTION ----
  // Minimal conservative R12 AC1009 header: ONLY $ACADVER is required.
  // All other HEADER variables ($INSBASE, $EXTMIN, $EXTMAX, $LIMMIN, $LIMMAX,
  // $VIEWCTR, $VIEWSIZE, $VIEWDIR, $LUNITS, $DWGCODEPAGE, $SCREENSIZE) are
  // optional or R13+ and have been proven to trigger Enter prompts / black
  // views in real AutoCAD when malformed. Start minimal; add only if proven.
  b.push('0', 'SECTION');
  b.push('2', 'HEADER');
  push(9, '$ACADVER'); push(1, 'AC1009'); // R12
  b.push('0', 'ENDSEC');

  // Build dynamic layer list: base LAYERS + per-floor layers
  const floorCount = candidate.floors.length;
  const perFloorLayerNames: string[] = [];
  const baseLayerNames = LAYERS.map(l => l.name);
  // For each floor and each base wall/room/opening/stair layer, create A-FLOOR-{n}-{base}
  const floorSpecificDefs: { name: string; color: number; linetype: string; lineweight: number; description: string }[] = [];
  const baseForFloorLayers = ['A-WALL-EXT','A-WALL-INT','A-WALL-CORE','A-WALL-SERVICE','A-WALL-PART','A-DOOR','A-WINDOW','A-STAIR','A-STAIR-TREAD','A-STAIR-DIR','A-ROOM','A-DIMS','A-PARKING','A-BLDG-OUT','A-SITE','A-SETBACK'];
  for (let fi = 0; fi < floorCount; fi++) {
    for (const baseName of baseForFloorLayers) {
      const baseDef = LAYERS.find(l => l.name === baseName);
      const color = baseDef?.color ?? 7;
      const ltype = baseDef?.linetype ?? 'CONTINUOUS';
      const lw = baseDef?.lineweight ?? 25;
      const name = `A-FLOOR-${fi}-${baseName}`;
      floorSpecificDefs.push({ name, color, linetype: ltype, lineweight: lw, description: `Floor ${fi} ${baseName}` });
      perFloorLayerNames.push(name);
    }
  }

  // ---- TABLES SECTION ----
  b.push('0', 'SECTION');
  b.push('2', 'TABLES');
  b.push('0', 'TABLE', '2', 'LTYPE', '70', '3');
  // AutoCAD's stock CENTER/DASHED dash lengths are INCH-scale; this drawing is
  // millimetres, so emit the x25.4-scaled patterns to stay visible at plan scale.
  writeLtype(b, 'CONTINUOUS', 'Solid line', [0.0]);
  writeLtype(b, 'CENTER', 'Center ____ _ ____ _ ____', [31.75, -6.35, 6.35, -6.35]);
  writeLtype(b, 'DASHED', 'Dashed __ __ __ __', [12.7, -6.35]);
  b.push('0', 'ENDTAB');
  // LAYER table: base + per-floor + extra meta layers
  const allLayers = [...LAYERS, ...floorSpecificDefs];
  b.push('0', 'TABLE', '2', 'LAYER', '70', String(allLayers.length));
  for (const layer of allLayers) {
    b.push('0', 'LAYER');
    push(2, layer.name);
    push(70, 0);
    push(62, layer.color);
    push(6, layer.linetype);
    // NOTE: no group 370 here — lineweight on layers is an R13+ feature and is
    // not valid in an R12 LAYER record.
  }
  b.push('0', 'ENDTAB');
  b.push('0', 'TABLE', '2', 'STYLE', '70', '1');
  // R12 text styles reference SHX shape fonts; 'txt' ships with every AutoCAD.
  b.push('0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0', '41', '1', '50', '0', '71', '0', '42', '0.2', '3', 'txt', '4', '');
  b.push('0', 'ENDTAB');
  b.push('0', 'ENDSEC');

  b.push('0', 'SECTION', '2', 'BLOCKS');
  b.push('0', 'BLOCK', '2', '*Model_Space', '70', '0', '10', '0', '20', '0', '30', '0');
  b.push('0', 'ENDBLK');
  b.push('0', 'BLOCK', '2', '*Paper_Space', '70', '0', '10', '0', '20', '0', '30', '0');
  b.push('0', 'ENDBLK');
  b.push('0', 'ENDSEC');

  b.push('0', 'SECTION', '2', 'ENTITIES');

  const mm = (m: number) => Math.round(m * MM_PER_M * 100) / 100;

  const emitLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    b.push('0', 'LINE');
    push(8, layer);
    push(10, mm(x1)); push(20, mm(y1)); push(30, '0');
    push(11, mm(x2)); push(21, mm(y2)); push(31, '0');
  };
  const emitArc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer: string) => {
    // Normalize ARC angles to 0..360 for R12 — AutoCAD rejects negative and ezdxf audit still passes, masking black-screen.
    const norm = (a: number) => {
      let n = a % 360;
      if (n < 0) n += 360;
      return Math.round(n * 1e6) / 1e6;
    };
    const s = norm(startDeg);
    const e = norm(endDeg);
    b.push('0', 'ARC');
    push(8, layer);
    push(10, mm(cx)); push(20, mm(cy)); push(30, '0');
    push(40, mm(r));
    push(50, s);
    push(51, e);
  };
  const emitText = (x: number, y: number, text: string, heightM: number, layer: string, horiz = 0) => {
    b.push('0', 'TEXT');
    push(8, layer);
    push(10, mm(x)); push(20, mm(y)); push(30, '0');
    push(40, mm(heightM));
    push(1, dxfSafeText(text));
    push(50, 0);
    push(72, horiz);
    // R12 TEXT second alignment point 11,21,31 required when 72 is non-0 (and canonical even when 0)
    push(11, mm(x)); push(21, mm(y)); push(31, '0');
    // Style is always STANDARD (72/73 already), height via 40 above
  };
  const emitPolyline = (pts: Vec2[], layer: string, closed = true) => {
    b.push('0', 'POLYLINE');
    push(8, layer);
    // R12 POLYLINE elevation point (10,20,30) required even for 2D (0,0,0)
    push(10, '0'); push(20, '0'); push(30, '0');
    push(70, closed ? 1 : 0);
    push(66, 1);
    push(40, '0'); push(41, '0'); push(71, '0'); push(72, '0');
    for (const p of pts) {
      b.push('0', 'VERTEX');
      push(8, layer);
      push(10, mm(p.x)); push(20, mm(p.y)); push(30, '0');
      // R12 VERTEX bulge 42 required (0 for straight)
      push(42, '0');
    }
    b.push('0', 'SEQEND');
    push(8, layer);
  };

  // Vertical offset per floor to separate visually (stacked north)
  const FLOOR_GAP_M = 4; // gap between floors in model space
  // Compute max building dimension for offset
  const maxH = Math.max(...candidate.floors.map(f => f.footprint.h), candidate.buildableArea.h);
  const floorOffset = (fi: number) => fi * (maxH + FLOOR_GAP_M);

  // Phase 10 — site/buildable/setback geometry from candidate (if available)
  const anyCand = candidate as any;
  const siteBoundary: Vec2[] | undefined = anyCand.siteBoundary;
  const buildableBoundary: Vec2[] | undefined = anyCand.buildableBoundary;
  const siteShape: string | undefined = anyCand.siteShape;
  const appliedSetbacks: any[] | undefined = anyCand.appliedSetbacks;

  // ---- Draw all floors — Phase 10.1 site-aware hardening: every floor uses canonical buildableBoundary/siteBoundary
  for (let fi = 0; fi < candidate.floors.length; fi++) {
    const fl = candidate.floors[fi];
    const yOff = floorOffset(fi);

    // Buildable outline per floor — canonical is buildableBoundary polygon, NOT bounding rect
    // For rectangle, buildableBoundary is rectangle (same as footprint bounding), for L-shape/polygon it's non-rectangular
    {
      const fr = fl.footprint;
      let shifted: Vec2[];
      if (buildableBoundary && buildableBoundary.length >= 3) {
        // Canonical: actual buildableBoundary polygon for EVERY floor, not just ground
        shifted = buildableBoundary.map(p => ({ x: p.x, y: p.y + yOff }));
      } else {
        // Fallback only if no canonical boundary (old data) — compatibility/presentation
        shifted = [
          { x: fr.x, y: fr.y + yOff },
          { x: fr.x + fr.w, y: fr.y + yOff },
          { x: fr.x + fr.w, y: fr.y + fr.h + yOff },
          { x: fr.x, y: fr.y + fr.h + yOff },
        ];
      }
      // generic outline only for floor 0 to keep backward compat (still canonical polygon for floor 0)
      if (fi === 0 && includeGenericLayers) {
        emitPolyline(shifted, 'A-BLDG-OUT', true);
        emitPolyline(shifted, 'A-SETBACK', true);
      }
      emitPolyline(shifted, `A-FLOOR-${fi}-A-BLDG-OUT`, true);
      // A-SETBACK per floor must represent actual buildable/setback boundary for that floor/context
      emitPolyline(shifted, `A-FLOOR-${fi}-A-SETBACK`, true);
    }

    // Site boundary outline — canonical siteBoundary polygon for EVERY floor
    if (siteBoundary && siteBoundary.length >= 3) {
      const shiftedSite = siteBoundary.map(p => ({ x: p.x, y: p.y + yOff }));
      if (fi === 0 && includeGenericLayers) {
        emitPolyline(shiftedSite, 'A-SITE', true);
      }
      emitPolyline(shiftedSite, `A-FLOOR-${fi}-A-SITE`, true);
      // Site label only for ground floor to avoid clutter, but geometry per floor exists
      if (fi === 0) {
        const br = (() => {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of siteBoundary) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        })();
        emitText(br.x, br.y - 0.8 + yOff, `SITE ${siteShape} ${br.w.toFixed(1)}x${br.h.toFixed(1)}m`, 0.3, 'A-SITE', 0);
        emitText(br.x, br.y - 1.2 + yOff, `Setbacks N=${appliedSetbacks?.find((s:any)=>s.direction==='north')?.value ?? '?'} S=${appliedSetbacks?.find((s:any)=>s.direction==='south')?.value ?? '?'} E=${appliedSetbacks?.find((s:any)=>s.direction==='east')?.value ?? '?'} W=${appliedSetbacks?.find((s:any)=>s.direction==='west')?.value ?? '?'}`, 0.2, 'A-SETBACK', 0);
      }
    }

    // Floor label
    {
      const fr = fl.footprint;
      emitText(fr.x, fr.y + fr.h + yOff + 0.5, `FLOOR ${fi} — Level ${fl.level} — ${fl.elevation.toFixed(2)}m elev`, 0.35, `A-FLOOR-${fi}-A-ROOM`, 0);
      if (fi === 0 && includeGenericLayers) emitText(fr.x, fr.y + fr.h + yOff + 0.5, `FLOOR ${fi} — Level ${fl.level}`, 0.35, 'A-ROOM', 0);
    }

    // Walls
    for (const w of fl.walls) {
      let baseLayer: string;
      switch (w.kind) {
        case 'exterior': baseLayer = 'A-WALL-EXT'; break;
        case 'core': baseLayer = 'A-WALL-CORE'; break;
        case 'service': baseLayer = 'A-WALL-SERVICE'; break;
        case 'partition': baseLayer = 'A-WALL-PART'; break;
        default: baseLayer = 'A-WALL-INT'; break;
      }
      const floorLayer = `A-FLOOR-${fi}-${baseLayer}`;
      // Emit on floor-specific layer (with y offset)
      emitWallWithOpeningsOffset(w, fl, emitLine, floorLayer, yOff);
      // Also emit on generic layer for floor 0 only (backward compat)
      if (fi === 0 && includeGenericLayers) emitWallWithOpeningsOffset(w, fl, emitLine, baseLayer, yOff);
    }

    // Openings — emit only on floor-specific + generic for floor 0 (no double hard-coded layer)
    for (const o of fl.openings) {
      const baseLayer = o.type === 'window' ? 'A-WINDOW' : 'A-DOOR';
      const floorLayer = `A-FLOOR-${fi}-${baseLayer}`;
      const shiftedOpening = shiftOpening(o, yOff);
      if (o.type === 'window') {
        drawWindowWithLayer(shiftedOpening, emitLine, floorLayer);
        if (fi === 0 && includeGenericLayers) drawWindowWithLayer(shiftedOpening, emitLine, baseLayer);
      } else {
        drawDoorWithLayer(shiftedOpening, emitLine, emitArc, floorLayer);
        if (fi === 0 && includeGenericLayers) drawDoorWithLayer(shiftedOpening, emitLine, emitArc, baseLayer);
      }
    }

    // Stairs
    for (const st of fl.stairs) {
      const shiftedStair = shiftStair(st, yOff);
      drawStairWithLayers(shiftedStair, emitLine, emitText, emitPolyline, fi);
      if (fi === 0 && includeGenericLayers) drawStair(shiftedStair, emitLine, emitText, emitPolyline);
    }

    // Parking (only floor 0 typically)
    for (const stall of fl.parkingStalls) {
      const r = shiftRect(stall.rect, yOff);
      const [sw, se, ne, nw] = rCorners(r);
      const pl = `A-FLOOR-${fi}-A-PARKING`;
      emitLine(sw.x, sw.y, se.x, se.y, pl);
      emitLine(se.x, se.y, ne.x, ne.y, pl);
      emitLine(ne.x, ne.y, nw.x, nw.y, pl);
      emitLine(nw.x, nw.y, sw.x, sw.y, pl);
      emitText((sw.x + ne.x) / 2, (sw.y + ne.y) / 2 - 0.2, `P${stall.index} F${fi}`, 0.25, pl, 1);
      if (fi === 0 && includeGenericLayers) {
        emitLine(sw.x, sw.y, se.x, se.y, 'A-PARKING');
        emitLine(se.x, se.y, ne.x, ne.y, 'A-PARKING');
        emitLine(ne.x, ne.y, nw.x, nw.y, 'A-PARKING');
        emitLine(nw.x, nw.y, sw.x, sw.y, 'A-PARKING');
        emitText((sw.x + ne.x) / 2, (sw.y + ne.y) / 2 - 0.2, `P${stall.index}`, 0.25, 'A-PARKING', 1);
      }
    }
    if (fl.parkingArea) {
      const a = shiftRect(fl.parkingArea.aisleRect, yOff);
      const pl = `A-FLOOR-${fi}-A-PARKING`;
      emitPolyline([{ x: a.x, y: a.y }, { x: a.x + a.w, y: a.y }, { x: a.x + a.w, y: a.y + a.h }, { x: a.x, y: a.y + a.h }], pl, true);
      emitText(a.x + a.w / 2, a.y + a.h / 2, 'AISLE', 0.25, pl, 1);
      if (fi === 0 && includeGenericLayers) {
        emitPolyline([{ x: a.x, y: a.y }, { x: a.x + a.w, y: a.y }, { x: a.x + a.w, y: a.y + a.h }, { x: a.x, y: a.y + a.h }], 'A-PARKING', true);
        emitText(a.x + a.w / 2, a.y + a.h / 2, 'AISLE', 0.25, 'A-PARKING', 1);
      }
    }

    // Room polygon geometry — Phase 11 canonical polygon, not just bounding rect
    // Emit actual room polygon on A-ROOM layers (walls already from polygon, but explicit room polygon for DXF room geometry)
    for (const s of fl.spaces) {
      const poly = s.polygon;
      if (poly && poly.length >= 3) {
        const shiftedPoly = poly.map(p => ({ x: p.x, y: p.y + yOff }));
        const flLayer = `A-FLOOR-${fi}-A-ROOM`;
        emitPolyline(shiftedPoly, flLayer, true);
        if (fi === 0 && includeGenericLayers) {
          emitPolyline(shiftedPoly, 'A-ROOM', true);
        }
      }
    }

    // Room labels + areas — floor-specific + generic for floor 0, at polygon centroid for L-shaped rooms
    for (const s of fl.spaces) {
      // Use polygon centroid for label placement (more accurate for L-shape)
      let cx: number, cy: number;
      if (s.polygon && s.polygon.length >= 3) {
        // Simple centroid via bounding rect center for rectangle, but for L-shape use polygon centroid approximation
        // Compute centroid via area-weighted method
        let cxx = 0, cyy = 0, a2 = 0;
        const poly = s.polygon;
        for (let i = 0, n = poly.length; i < n; i++) {
          const p1 = poly[i];
          const p2 = poly[(i + 1) % n];
          const cross = p1.x * p2.y - p2.x * p1.y;
          a2 += cross;
          cxx += (p1.x + p2.x) * cross;
          cyy += (p1.y + p2.y) * cross;
        }
        const a = a2 * 3 || 1;
        cx = cxx / a;
        cy = cyy / a + yOff;
        // Fallback to rect center if centroid outside polygon (rare for concave)
        // For simplicity, keep computed centroid
      } else {
        cx = s.rect.x + s.rect.w / 2;
        cy = s.rect.y + s.rect.h / 2 + yOff;
      }
      const h = Math.min(0.35, Math.max(0.18, Math.min(s.rect.w, s.rect.h) * 0.08));
      const flLayer = `A-FLOOR-${fi}-A-ROOM`;
      emitText(cx, cy + h * 0.5, `${s.label} [F${fi}]`, h, flLayer, 1);
      emitText(cx, cy - h * 0.7, `${s.area.toFixed(1)} m²`, h * 0.7, flLayer, 1);
      if (fi === 0 && includeGenericLayers) {
        emitText(cx, cy + h * 0.5, s.label, h, 'A-ROOM', 1);
        emitText(cx, cy - h * 0.7, `${s.area.toFixed(1)} m²`, h * 0.7, 'A-ROOM', 1);
      }
    }

    if (fi === 0) emitGridShifted(candidate.buildableArea, emitLine, emitText, yOff);
    emitOuterDimensionsShifted(fl.footprint, emitLine, emitText, yOff, fi, includeGenericLayers);
    emitRoomDimensionsShifted(fl.spaces, emitLine, emitText, yOff, fi, includeGenericLayers);

    if (fi === 0) drawNorthArrow(fl.footprint.x + fl.footprint.w - 1.2, fl.footprint.y + fl.footprint.h - 0.3 + yOff, emitLine, emitText);

    if (fi === 0) drawTitleBlock(candidate, projectName, emitLine, emitText);
  }

  // Whole-building vertical markers (connect stairs across floors)
  if (candidate.floors.length > 1) {
    // Draw vertical alignment lines between stair footprints across floors
    const firstStairs = candidate.floors[0].stairs;
    for (const st0 of firstStairs) {
      const r0 = st0.footprint ?? st0.rect;
      if (!r0) continue;
      const cx0 = r0.x + r0.w / 2;
      const cy0Bottom = r0.y + floorOffset(0);
      const cyTop = (candidate.floors[candidate.floors.length - 1].footprint.y + candidate.floors[candidate.floors.length - 1].footprint.h) + floorOffset(candidate.floors.length - 1);
      // Dashed-like vertical line indicating stair stack
      emitLine(cx0, cy0Bottom, cx0, cyTop, 'A-STAIR');
      emitText(cx0 + 0.2, cyTop + 0.2, `STAIR STACK — ${candidate.floors.length} FLOORS — Whole-Building`, 0.25, 'A-STAIR-DIR', 0);
    }
  }

  b.push('0', 'ENDSEC');
  b.push('0', 'EOF');

  return b.join(CR) + CR;
}

function shiftRect(r: Rect, yOff: number): Rect { return { x: r.x, y: r.y + yOff, w: r.w, h: r.h }; }
function shiftOpening(o: Opening, yOff: number): Opening {
  return {
    ...o,
    center: { x: o.center.x, y: o.center.y + yOff },
    hinge: o.hinge ? { x: o.hinge.x, y: o.hinge.y + yOff } : undefined,
    leafEnd: (o as any).leafEnd ? { x: (o as any).leafEnd.x, y: (o as any).leafEnd.y + yOff } : undefined,
    openEnd: (o as any).openEnd ? { x: (o as any).openEnd.x, y: (o as any).openEnd.y + yOff } : undefined,
  };
}
function shiftStair(st: any, yOff: number): any {
  const shiftPt = (p: Vec2) => ({ x: p.x, y: p.y + yOff });
  const sr = st.footprint ?? st.rect;
  return {
    ...st,
    footprint: sr ? shiftRect(sr, yOff) : sr,
    rect: st.rect ? shiftRect(st.rect, yOff) : undefined,
    startPoint: st.startPoint ? shiftPt(st.startPoint) : undefined,
    endPoint: st.endPoint ? shiftPt(st.endPoint) : undefined,
    flights: (st.flights ?? []).map((fl: any) => ({
      ...fl,
      footprint: fl.footprint ? shiftRect(fl.footprint, yOff) : fl.footprint,
      startPoint: fl.startPoint ? shiftPt(fl.startPoint) : fl.startPoint,
      endPoint: fl.endPoint ? shiftPt(fl.endPoint) : fl.endPoint,
    })),
    landings: (st.landings ?? []).map((l: any) => ({
      ...l,
      footprint: l.footprint ? shiftRect(l.footprint, yOff) : l.footprint,
    })),
  };
}

function emitWallWithOpeningsOffset(
  w: Wall,
  floor: Floor,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  layer: string,
  yOff: number,
) {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const thk = w.thickness / 2;
  interface Range { from: number; to: number; }
  const openings: Range[] = [];
  for (const oid of w.openingIds) {
    const o = floor.openings.find(op => op.id === oid);
    if (!o) continue;
    const px = o.center.x - w.start.x;
    const py = o.center.y - w.start.y;
    const offset = px * ux + py * uy;
    const from = Math.max(0, offset - o.width / 2);
    const to = Math.min(len, offset + o.width / 2);
    openings.push({ from, to });
  }
  openings.sort((a, b) => a.from - b.from);
  const spans: Range[] = [];
  let cursor = 0;
  for (const op of openings) {
    if (op.from > cursor + 1e-4) spans.push({ from: cursor, to: op.from });
    cursor = Math.max(cursor, op.to);
  }
  if (cursor < len - 1e-4) spans.push({ from: cursor, to: len });
  for (const s of spans) {
    const a = { x: w.start.x + ux * s.from, y: w.start.y + uy * s.from + yOff };
    const bpt = { x: w.start.x + ux * s.to, y: w.start.y + uy * s.to + yOff };
    emitLine(a.x + nx * thk, a.y + ny * thk, bpt.x + nx * thk, bpt.y + ny * thk, layer);
    emitLine(a.x - nx * thk, a.y - ny * thk, bpt.x - nx * thk, bpt.y - ny * thk, layer);
    if (s.from === 0) emitLine(a.x + nx * thk, a.y + ny * thk, a.x - nx * thk, a.y - ny * thk, layer);
    if (s.to === len) emitLine(bpt.x + nx * thk, bpt.y + ny * thk, bpt.x - nx * thk, bpt.y - ny * thk, layer);
  }
  for (const op of openings) {
    const a = { x: w.start.x + ux * op.from, y: w.start.y + uy * op.from + yOff };
    const bpt = { x: w.start.x + ux * op.to, y: w.start.y + uy * op.to + yOff };
    emitLine(a.x + nx * thk, a.y + ny * thk, a.x - nx * thk, a.y - ny * thk, layer);
    emitLine(bpt.x + nx * thk, bpt.y + ny * thk, bpt.x - nx * thk, bpt.y - ny * thk, layer);
  }
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
    // v1.0.1 (AGX-01): draw the ACTUAL flight going — no minimum-spacing clamp.
    const t = fl.treadDepth ?? st.tread ?? 0.28;
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
  // v1.0.1 (AGX-01): annotate the ACTUAL generated geometry (per-flight going
  // and riser), never a nominal value that differs from the drawn stair.
  const actRiser = flights[0]?.riserHeight ?? st.riserHeight ?? st.riser ?? 0;
  const actTread = Math.min(...flights.map((f: any) => f.treadDepth ?? st.tread ?? st.treadDepth ?? 0.28));
  const label = `${flights.length}F · ${st.totalRisers}R @ ${(actRiser*100).toFixed(0)}×${(actTread*100).toFixed(0)}`;
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
) { emitGridShifted(fr, emitLine, emitText, 0); }

function emitGridShifted(
  fr: Rect,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  yOff: number,
) {
  const cx = fr.x + fr.w / 2;
  const cy = fr.y + fr.h / 2 + yOff;
  emitLine(fr.x, fr.y - 0.5 + yOff, fr.x, fr.y + fr.h + 0.5 + yOff, 'A-GRID');
  emitLine(cx, fr.y - 0.5 + yOff, cx, fr.y + fr.h + 0.5 + yOff, 'A-AXIS');
  emitLine(fr.x + fr.w, fr.y - 0.5 + yOff, fr.x + fr.w, fr.y + fr.h + 0.5 + yOff, 'A-GRID');
  emitLine(fr.x - 0.5, fr.y + yOff, fr.x + fr.w + 0.5, fr.y + yOff, 'A-GRID');
  emitLine(fr.x - 0.5, cy, fr.x + fr.w + 0.5, cy, 'A-AXIS');
  emitLine(fr.x - 0.5, fr.y + fr.h + yOff, fr.x + fr.w + 0.5, fr.y + fr.h + yOff, 'A-GRID');
  emitText(fr.x - 0.7, fr.y + fr.h + 0.3 + yOff, 'A', 0.25, 'A-AXIS-TEXT', 1);
  emitText(cx, fr.y + fr.h + 0.3 + yOff, 'B', 0.25, 'A-AXIS-TEXT', 1);
  emitText(fr.x + fr.w + 0.3, fr.y + fr.h + 0.3 + yOff, 'C', 0.25, 'A-AXIS-TEXT', 0);
  emitText(fr.x - 0.7, fr.y - 0.7 + yOff, '1', 0.25, 'A-AXIS-TEXT', 2);
  emitText(fr.x - 0.7, cy, '2', 0.25, 'A-AXIS-TEXT', 2);
}

function emitRoomDimensions(
  spaces: Space[],
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
) { emitRoomDimensionsShifted(spaces, emitLine, emitText, 0, 0); }

function emitRoomDimensionsShifted(
  spaces: Space[],
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  yOff: number,
  floorIdx: number,
  includeGenericLayers = true,
) {
  for (const s of spaces) {
    if (s.type === 'parking' || s.type === 'yard') continue;
    if (s.rect.w < 2 || s.rect.h < 2) continue;
    const r = shiftRect(s.rect, yOff);
    const off = 0.15;
    const base = `A-FLOOR-${floorIdx}-A-DIMS`;
    emitLine(r.x, r.y - off, r.x + r.w, r.y - off, base);
    emitText(r.x + r.w / 2, r.y - off - 0.15, `${r.w.toFixed(2)}`, 0.12, base, 1);
    emitLine(r.x - off, r.y, r.x - off, r.y + r.h, base);
    emitText(r.x - off - 0.2, r.y + r.h / 2, `${r.h.toFixed(2)}`, 0.12, base, 2);
    if (floorIdx === 0 && includeGenericLayers) {
      emitLine(r.x, r.y - off, r.x + r.w, r.y - off, 'A-DIMS');
      emitText(r.x + r.w / 2, r.y - off - 0.15, `${r.w.toFixed(2)}`, 0.12, 'A-DIMS', 1);
      emitLine(r.x - off, r.y, r.x - off, r.y + r.h, 'A-DIMS');
      emitText(r.x - off - 0.2, r.y + r.h / 2, `${r.h.toFixed(2)}`, 0.12, 'A-DIMS', 2);
    }
  }
}

function emitOuterDimensions(
  fr: Rect,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
) { emitOuterDimensionsShifted(fr, emitLine, emitText, 0, 0); }

function emitOuterDimensionsShifted(
  fr: Rect,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  yOff: number,
  floorIdx: number,
  includeGenericLayers = true,
) {
  const r = shiftRect(fr, yOff);
  const off = 1.0;
  const base = `A-FLOOR-${floorIdx}-A-DIMS`;
  emitLine(r.x, r.y - off, r.x + r.w, r.y - off, base);
  emitText((r.x + r.x + r.w) / 2, r.y - off - 0.3, `${r.w.toFixed(2)} m F${floorIdx}`, 0.22, base, 1);
  emitLine(r.x, r.y - off - 0.15, r.x, r.y - off + 0.15, base);
  emitLine(r.x + r.w, r.y - off - 0.15, r.x + r.w, r.y - off + 0.15, base);
  emitLine(r.x - off, r.y, r.x - off, r.y + r.h, base);
  emitText(r.x - off - 0.3, (r.y + r.y + r.h) / 2, `${r.h.toFixed(2)} m`, 0.22, base, 1);
  emitLine(r.x - off - 0.15, r.y, r.x - off + 0.15, r.y, base);
  emitLine(r.x - off - 0.15, r.y + r.h, r.x - off + 0.15, r.y + r.h, base);
  if (floorIdx === 0 && includeGenericLayers) {
    emitLine(r.x, r.y - off, r.x + r.w, r.y - off, 'A-DIMS');
    emitText((r.x + r.x + r.w) / 2, r.y - off - 0.3, `${r.w.toFixed(2)} m`, 0.22, 'A-DIMS', 1);
    emitLine(r.x, r.y - off - 0.15, r.x, r.y - off + 0.15, 'A-DIMS');
    emitLine(r.x + r.w, r.y - off - 0.15, r.x + r.w, r.y - off + 0.15, 'A-DIMS');
    emitLine(r.x - off, r.y, r.x - off, r.y + r.h, 'A-DIMS');
    emitText(r.x - off - 0.3, (r.y + r.y + r.h) / 2, `${r.h.toFixed(2)} m`, 0.22, 'A-DIMS', 1);
    emitLine(r.x - off - 0.15, r.y, r.x - off + 0.15, r.y, 'A-DIMS');
    emitLine(r.x - off - 0.15, r.y + r.h, r.x - off + 0.15, r.y + r.h, 'A-DIMS');
  }
}

// Layer-aware wrappers
function drawWindowWithLayer(o: Opening, emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void, layer: string) {
  const perp: Vec2 = { x: -o.wallDir.y, y: o.wallDir.x };
  const half = o.width / 2;
  const center = o.center;
  const along = o.wallDir;
  const depth = 0.04;
  for (const sign of [-1.5, -0.5, 0.5, 1.5]) {
    const cx = center.x + perp.x * depth * sign;
    const cy = center.y + perp.y * depth * sign;
    emitLine(cx - along.x * half, cy - along.y * half, cx + along.x * half, cy + along.y * half, layer);
  }
}

function drawDoorWithLayer(
  o: Opening,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitArc: (cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer: string) => void,
  layer: string,
) {
  const along = o.wallDir;
  const n = o.normal;
  let hinge: Vec2, closedEnd: Vec2, openEnd: Vec2;
  if (o.hinge && o.leafEnd && o.openEnd) {
    hinge = o.hinge; closedEnd = o.leafEnd; openEnd = o.openEnd;
  } else {
    const hingeSign = o.swing === 'right' ? 1 : -1;
    hinge = { x: o.center.x + along.x * (o.width / 2) * hingeSign, y: o.center.y + along.y * (o.width / 2) * hingeSign };
    closedEnd = { x: o.center.x - along.x * (o.width / 2) * hingeSign, y: o.center.y - along.y * (o.width / 2) * hingeSign };
    openEnd = { x: hinge.x + n.x * o.width, y: hinge.y + n.y * o.width };
  }
  emitLine(hinge.x, hinge.y, closedEnd.x, closedEnd.y, layer);
  const a1 = Math.atan2(closedEnd.y - hinge.y, closedEnd.x - hinge.x) * 180 / Math.PI;
  const a2 = Math.atan2(openEnd.y - hinge.y, openEnd.x - hinge.x) * 180 / Math.PI;
  let start = a1, end = a2;
  let diff = end - start; while (diff < 0) diff += 360; while (diff > 360) diff -= 360;
  if (diff > 180) { const t = start; start = end; end = t; }
  if (end < start) end += 360;
  emitArc(hinge.x, hinge.y, o.width, start, end, layer);
  if (o.leafThickness) {
    const perpOpen: Vec2 = { x: -n.y, y: n.x };
    const thk = o.leafThickness;
    emitLine(openEnd.x, openEnd.y, openEnd.x + perpOpen.x * thk, openEnd.y + perpOpen.y * thk, layer);
  }
}

function drawStairWithLayers(
  st: any,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  emitPolyline: (pts: Vec2[], layer: string, closed?: boolean) => void,
  floorIdx: number,
) {
  const rect: Rect = st.footprint ?? st.rect;
  const [sw, se, ne, nw] = rCorners(rect);
  emitPolyline([sw, se, ne, nw], `A-FLOOR-${floorIdx}-A-STAIR`, true);
  const flights: any[] = st.flights ?? [];
  const landings: any[] = st.landings ?? [];
  if (flights.length === 0) {
    const t = Math.max(0.25, st.tread ?? 0.28);
    const x0 = rect.x + 0.1; const x1 = rect.x + rect.w - 0.1;
    let y = rect.y + 0.3; while (y < rect.y + rect.h - 0.3) { emitLine(x0, y, x1, y, `A-FLOOR-${floorIdx}-A-STAIR-TREAD`); y += t; }
    emitText(rect.x + rect.w - 0.6, rect.y + rect.h - 0.3, 'UP', 0.2, `A-FLOOR-${floorIdx}-A-STAIR-DIR`);
    return;
  }
  for (const l of landings) {
    const lr = l.footprint as Rect;
    const [a, b, c, d] = rCorners(lr);
    emitPolyline([a, b, c, d], `A-FLOOR-${floorIdx}-A-STAIR`, true);
    emitText(lr.x + lr.w / 2, lr.y + lr.h / 2, 'LDNG', 0.18, `A-FLOOR-${floorIdx}-A-STAIR`, 1);
  }
  for (const fl of flights) {
    const fr = fl.footprint as Rect;
    const dir: string = fl.direction;
    const [a, b, c, d] = rCorners(fr);
    emitPolyline([a, b, c, d], `A-FLOOR-${floorIdx}-A-STAIR`, false);
    const t = fl.treadDepth ?? st.tread ?? 0.28; // v1.0.1 (AGX-01): actual going, no clamp
    if (dir === 'north' || dir === 'south') {
      const x0 = fr.x; const x1 = fr.x + fr.w;
      const yStart = fl.startPoint.y; const yEnd = fl.endPoint.y;
      const step = yEnd > yStart ? t : -t;
      for (let y = yStart + step; Math.abs(y - yEnd) > 0.005; y += step) {
        if (y < fr.y - 0.005 || y > fr.y + fr.h + 0.005) break;
        emitLine(x0, y, x1, y, `A-FLOOR-${floorIdx}-A-STAIR-TREAD`);
      }
    } else {
      const y0 = fr.y; const y1 = fr.y + fr.h;
      const xStart = fl.startPoint.x; const xEnd = fl.endPoint.x;
      const step = xEnd > xStart ? t : -t;
      for (let x = xStart + step; Math.abs(x - xEnd) > 0.005; x += step) {
        if (x < fr.x - 0.005 || x > fr.x + fr.w + 0.005) break;
        emitLine(x, y0, x, y1, `A-FLOOR-${floorIdx}-A-STAIR-TREAD`);
      }
    }
    const cx = (fl.startPoint.x + fl.endPoint.x) / 2;
    const cy = (fl.startPoint.y + fl.endPoint.y) / 2;
    drawDirArrowWithLayer(cx, cy, dir, emitLine, 0.35, `A-FLOOR-${floorIdx}-A-STAIR-DIR`);
  }
  const bottom = flights.reduce((p: any, c: any) => c.startPoint.y < p.startPoint.y ? c : p, flights[0]);
  emitText(bottom.startPoint.x - 0.25, bottom.startPoint.y - 0.05, 'UP', 0.18, `A-FLOOR-${floorIdx}-A-STAIR-DIR`);
  // v1.0.1 (AGX-01): annotate the ACTUAL generated geometry.
  const actRiser = flights[0]?.riserHeight ?? st.riserHeight ?? st.riser ?? 0;
  const actTread = Math.min(...flights.map((f: any) => f.treadDepth ?? st.tread ?? st.treadDepth ?? 0.28));
  const label = `${flights.length}F · ${st.totalRisers}R @ ${(actRiser*100).toFixed(0)}×${(actTread*100).toFixed(0)} F${floorIdx}`;
  emitText(rect.x + 0.1, rect.y + rect.h - 0.15, label, 0.15, `A-FLOOR-${floorIdx}-A-STAIR-DIR`);
}

function drawDirArrowWithLayer(
  cx: number, cy: number, dir: string,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  size: number,
  layer: string,
) {
  let tipX = cx, tipY = cy; let bx = cx, by = cy;
  switch (dir) {
    case 'north': tipY = cy + size; by = cy - size; break;
    case 'south': tipY = cy - size; by = cy + size; break;
    case 'east':  tipX = cx + size; bx = cx - size; break;
    case 'west':  tipX = cx - size; bx = cx + size; break;
  }
  emitLine(bx, by, tipX, tipY, layer);
  if (dir === 'north' || dir === 'south') {
    const s = dir === 'north' ? -1 : 1;
    emitLine(tipX, tipY, tipX - 0.08, tipY + s * 0.12, layer);
    emitLine(tipX, tipY, tipX + 0.08, tipY + s * 0.12, layer);
  } else {
    const s = dir === 'east' ? -1 : 1;
    emitLine(tipX, tipY, tipX + s * 0.12, tipY - 0.08, layer);
    emitLine(tipX, tipY, tipX + s * 0.12, tipY + 0.08, layer);
  }
}

function writeLtype(b: string[], name: string, desc: string, pattern: number[]) {
  b.push('0', 'LTYPE');
  b.push('2', name);
  b.push('70', '0');
  b.push('3', desc);
  b.push('72', '65'); // R12-required alignment code ('A'); every LTYPE must carry it
  const elements = pattern.filter(p => Math.abs(p) > 1e-9).length;
  b.push('73', String(elements));
  let totalLen = 0;
  for (const p of pattern) totalLen += Math.abs(p);
  // Round to avoid JS floating artifacts like 50.800000000000004 / 19.049999999999997 which ezdxf tolerates but AutoCAD may reject
  totalLen = Math.round(totalLen * 10000) / 10000;
  b.push('40', String(totalLen || 0));
  for (const p of pattern) {
    if (Math.abs(p) < 1e-9) continue;
    // Round pattern values to 4 decimals as well (31.75 etc. are exact but guard against artifacts)
    const v = Math.round(p * 10000) / 10000;
    b.push('49', String(v));
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
  for (const name of ['A-WALL-EXT', 'A-WALL-INT', 'A-DOOR', 'A-WINDOW', 'A-ROOM', 'A-DIMS', 'A-STAIR', 'A-STAIR-TREAD', 'A-STAIR-DIR', 'A-GRID', 'A-AXIS', 'A-NORTH', 'A-TITLE', 'A-PARKING', 'A-SITE', 'A-SETBACK', 'A-BLDG-OUT']) {
    if (!lines.includes(name)) errors.push(`Missing layer entry: ${name}`);
  }
  // Minimal R12: ONLY $ACADVER AC1009 is required. All other HEADER variables ($VIEWCTR,$VIEWSIZE,$EXTMIN,$EXTMAX,$LIMMIN,$LIMMAX,$VIEWDIR)
  // are optional and have been removed to avoid Enter prompts / black views. Only forbid R13+ vars.
  if (!dxf.includes('$ACADVER') || !dxf.includes('AC1009')) errors.push('Missing $ACADVER AC1009 (R12)');
  if (dxf.includes('$SCREENSIZE')) errors.push('$SCREENSIZE is not valid in DXF R12 (AC1009) — remove (prompted Enter in AutoCAD)');
  if (dxf.includes('$DWGCODEPAGE')) errors.push('$DWGCODEPAGE is not valid in DXF R12 (AC1009) — remove');
  if (dxf.includes('$INSUNITS')) errors.push('$INSUNITS is not valid in DXF R12 (AC1009)');
  if (dxf.includes('$MEASUREMENT')) errors.push('$MEASUREMENT is not valid in DXF R12 (AC1009)');
  if (dxf.includes('$LUNITS')) errors.push('$LUNITS is not valid in minimal DXF R12 (AC1009) — remove');
  // Minimal TABLES: LTYPE + LAYER + STYLE only. VPORT/VIEW/UCS/APPID/DIMSTYLE are optional and not required.
  return { ok: errors.length === 0, errors };
}
