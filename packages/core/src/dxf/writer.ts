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
import { pointInPolygon, polygonCentroid } from '../geometry/polygon.js';

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
  /**
   * P16-D layer scheme.
   *   'both' (DEFAULT, = legacy contract) — every floor draws on its A-FLOOR-{n}-{DISCIPLINE}
   *              layer; floor 0 additionally mirrors onto the base discipline layers
   *              (A-WALL-EXT, A-DOOR, …) so the drawing satisfies both the per-floor and
   *              the flat-discipline layer conventions simultaneously.
   *   'none'   — floor layers only: the leanest, fully non-duplicated drawing.
   *   'generic'— discipline layers only: one shared layer set across all floors.
   * All schemes emit each entity exactly once PER LAYER — coincident same-layer repeats
   * are suppressed at the emitter (P16-D cleanliness), and the base layers are always
   * defined in the LAYER table.
   */
  layerScheme?: 'none' | 'generic' | 'both';
  /** Legacy alias: true = 'both' (default), false = 'none'. layerScheme wins if given. */
  includeGenericLayers?: boolean;
}
export function writeDXF(candidate: LayoutCandidate, projectName = 'ArchGenius Plan', options: DXFOptions = {}): string {
  // P16-D: resolve the layer scheme; includeGenericLayers kept as a legacy alias.
  const scheme: 'none' | 'generic' | 'both' =
    options.layerScheme ?? (options.includeGenericLayers === false ? 'none' : 'both');
  const ENVELOPE_LAYERS = new Set(['A-BLDG-OUT', 'A-SETBACK', 'A-SITE']);
  // Every discipline resolves to the layer name(s) its entities live on. In the default
  // 'both' scheme each floor draws on its own A-FLOOR-{n}-* layers and floor 0 mirrors
  // onto the base discipline layers (the established dual-convention contract). Whatever
  // the scheme, an entity is emitted AT MOST ONCE per layer — the emitter-level
  // deduplication added in P16-D removes the harmful exact repeats.
  const layersFor = (fi: number, base: string): string[] => {
    const fl = `A-FLOOR-${fi}-${base}`;
    if (scheme === 'generic') return [base];
    if (scheme === 'none') return [fl];
    // 'both': floor layer everywhere + generic alias on floor 0 (envelope trio too)
    return fi === 0 ? [base, fl] : [fl];
  };
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
  // P16-D-B: A-TEXT joins the floor namespace so general annotations (floor headers,
  // stair build notes) keep per-floor routing in every layer scheme.
  // P16-D-C: A-FURN / A-SANITARY join it too — the Phase-11 generator already places
  // Furniture footprints per floor, drawn as glyph rectangles on these layers.
  const floorSpecificDefs: { name: string; color: number; linetype: string; lineweight: number; description: string }[] = [];
  const baseForFloorLayers = ['A-WALL-EXT','A-WALL-INT','A-WALL-CORE','A-WALL-SERVICE','A-WALL-PART','A-DOOR','A-WINDOW','A-STAIR','A-STAIR-TREAD','A-STAIR-DIR','A-ROOM','A-TEXT','A-FURN','A-SANITARY','A-DIMS','A-PARKING','A-BLDG-OUT','A-SITE','A-SETBACK'];
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

  // P16-D CAD cleanliness: every emitter deduplicates exact same-layer repeats (two
  // adjacent spaces can own the same shared wall edge — drawing it once is the
  // professional result) and refuses zero-length segments. Different layers are a
  // legitimate representation choice, so coincident cross-layer geometry is kept.
  const seenEnt = new Set<string>();
  const emitLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    const X1 = mm(x1), Y1 = mm(y1), X2 = mm(x2), Y2 = mm(y2);
    if (X1 === X2 && Y1 === Y2) return; // zero-length line — never emitted
    const k = `L|${layer}|${X1},${Y1}|${X2},${Y2}`;
    if (seenEnt.has(k)) return;
    seenEnt.add(k);
    b.push('0', 'LINE');
    push(8, layer);
    push(10, X1); push(20, Y1); push(30, '0');
    push(11, X2); push(21, Y2); push(31, '0');
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
    const k = `A|${layer}|${mm(cx)},${mm(cy)}|${mm(r)}|${s},${e}`;
    if (r <= 0 || seenEnt.has(k)) return;
    seenEnt.add(k);
    b.push('0', 'ARC');
    push(8, layer);
    push(10, mm(cx)); push(20, mm(cy)); push(30, '0');
    push(40, mm(r));
    push(50, s);
    push(51, e);
  };
  const emitText = (x: number, y: number, text: string, heightM: number, layer: string, horiz = 0, rotDeg = 0) => {
    const safeTxt = dxfSafeText(text);
    const kt = `T|${layer}|${mm(x)},${mm(y)}|${safeTxt}|${mm(heightM)}|${rotDeg}`;
    if (!safeTxt || !(heightM > 0) || seenEnt.has(kt)) return; // empty/zero-height text is never valid
    seenEnt.add(kt);
    b.push('0', 'TEXT');
    push(8, layer);
    push(10, mm(x)); push(20, mm(y)); push(30, '0');
    push(40, mm(heightM));
    push(1, safeTxt);
    push(50, rotDeg); // P16-D-C: optional rotation (R12 group 50); 0 preserves the legacy output
    push(72, horiz);
    // R12 TEXT second alignment point 11,21,31 required when 72 is non-0 (and canonical even when 0)
    push(11, mm(x)); push(21, mm(y)); push(31, '0');
    // Style is always STANDARD (72/73 already), height via 40 above
  };
  const emitPolyline = (pts: Vec2[], layer: string, closed = true) => {
    const kp = `P|${layer}|${closed ? 1 : 0}|` + pts.map(p => `${mm(p.x)},${mm(p.y)}`).join(';');
    if (pts.length < 2 || seenEnt.has(kp)) return;
    seenEnt.add(kp);
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

  // ---- Draw all floors — P16-D scheme-routed single emission -----------------------
  // Every discipline resolves through layersFor(): exactly one copy of each entity per
  // layer it belongs to (legacy 'both' mode is the only scheme with a floor-0 alias).
  const polyArea = (poly: Vec2[] | undefined, fallback: Rect): number => {
    if (!poly || poly.length < 3) return fallback.w * fallback.h;
    let acc = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const p1 = poly[i]; const p2 = poly[(i + 1) % n];
      acc += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(acc) / 2;
  };
  let siteBox: { x: number; y: number; w: number; h: number } | null = null;
  let totalNetArea = 0;

  for (let fi = 0; fi < candidate.floors.length; fi++) {
    const fl = candidate.floors[fi];
    const yOff = floorOffset(fi);
    const LY = (base: string): string[] => layersFor(fi, base);
    const lineB = (x1: number, y1: number, x2: number, y2: number, base: string) => { for (const L of LY(base)) emitLine(x1, y1, x2, y2, L); };
    const textB = (x: number, y: number, txt: string, h: number, base: string, horiz = 0, rotDeg = 0) => { for (const L of LY(base)) emitText(x, y, txt, h, L, horiz, rotDeg); };
    const polyB = (pts: Vec2[], base: string, closed = true) => { for (const L of LY(base)) emitPolyline(pts, L, closed); };

    // Buildable outline per floor — canonical buildableBoundary polygon, NOT bounding rect
    // (for rectangle it coincides with the footprint bounding; L-shape/polygon stay true).
    {
      const fr = fl.footprint;
      let shifted: Vec2[];
      if (buildableBoundary && buildableBoundary.length >= 3) {
        shifted = buildableBoundary.map(p => ({ x: p.x, y: p.y + yOff }));
      } else {
        shifted = [
          { x: fr.x, y: fr.y + yOff },
          { x: fr.x + fr.w, y: fr.y + yOff },
          { x: fr.x + fr.w, y: fr.y + fr.h + yOff },
          { x: fr.x, y: fr.y + fr.h + yOff },
        ];
      }
      polyB(shifted, 'A-BLDG-OUT', true);
      polyB(shifted, 'A-SETBACK', true);
    }

    // Site boundary — canonical siteBoundary polygon for EVERY floor (floor-specific layers).
    if (siteBoundary && siteBoundary.length >= 3) {
      const shiftedSite = siteBoundary.map(p => ({ x: p.x, y: p.y + yOff }));
      polyB(shiftedSite, 'A-SITE', true);
      if (fi === 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of siteBoundary) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        siteBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        emitText(minX, minY - 0.8, `SITE ${siteShape} ${siteBox.w.toFixed(1)}x${siteBox.h.toFixed(1)}m`, 0.3, 'A-SITE', 0);
        emitText(minX, minY - 1.2, `Setbacks N=${appliedSetbacks?.find((s:any)=>s.direction==='north')?.value ?? '?'} S=${appliedSetbacks?.find((s:any)=>s.direction==='south')?.value ?? '?'} E=${appliedSetbacks?.find((s:any)=>s.direction==='east')?.value ?? '?'} W=${appliedSetbacks?.find((s:any)=>s.direction==='west')?.value ?? '?'}`, 0.2, 'A-SETBACK', 0);
      }
    }

    // Floor header — exactly one label per floor. Routed to A-TEXT (P16-D-B):
    // it is a drawing-wide annotation, not a room label.
    {
      const fr = fl.footprint;
      textB(fr.x, fr.y + fr.h + yOff + 0.5, `FLOOR ${fi} — ELEV ${fl.elevation.toFixed(2)} m`, 0.3, 'A-TEXT', 0);
    }

    // Walls — double-line faces with opening gaps, on their discipline layer.
    for (const w of fl.walls) {
      let baseLayer: string;
      switch (w.kind) {
        case 'exterior': baseLayer = 'A-WALL-EXT'; break;
        case 'core': baseLayer = 'A-WALL-CORE'; break;
        case 'service': baseLayer = 'A-WALL-SERVICE'; break;
        case 'partition': baseLayer = 'A-WALL-PART'; break;
        default: baseLayer = 'A-WALL-INT'; break;
      }
      for (const L of LY(baseLayer)) emitWallWithOpeningsOffset(w, fl, emitLine, L, yOff);
    }

    // Openings — door leaf + swing arc, window glass lines.
    for (const o of fl.openings) {
      const so = shiftOpening(o, yOff);
      if (o.type === 'window') { for (const L of LY('A-WINDOW')) drawWindowOn(so, emitLine, L); }
      else { for (const L of LY('A-DOOR')) drawDoorOn(so, emitLine, emitArc, L); }
      // Opening width dimension on exterior faces — geometry-derived, ticks + parallel dim.
      const host = fl.walls.find(w => w.id === o.wallId);
      if (host && host.kind === 'exterior' && o.width >= 0.6) {
        const half = o.width / 2;
        const ox = -so.normal.x, oy = -so.normal.y; // outward from the room
        const e1x = so.center.x + so.wallDir.x * half, e1y = so.center.y + so.wallDir.y * half;
        const e2x = so.center.x - so.wallDir.x * half, e2y = so.center.y - so.wallDir.y * half;
        const dOff = 0.32;
        lineB(e1x + ox * 0.05, e1y + oy * 0.05, e1x + ox * (dOff + 0.08), e1y + oy * (dOff + 0.08), 'A-DIMS');
        lineB(e2x + ox * 0.05, e2y + oy * 0.05, e2x + ox * (dOff + 0.08), e2y + oy * (dOff + 0.08), 'A-DIMS');
        lineB(e1x + ox * dOff, e1y + oy * dOff, e2x + ox * dOff, e2y + oy * dOff, 'A-DIMS');
        drawTickAt(lineB, e1x + ox * dOff, e1y + oy * dOff, so.wallDir.x, so.wallDir.y);
        drawTickAt(lineB, e2x + ox * dOff, e2y + oy * dOff, so.wallDir.x, so.wallDir.y);
        textB(so.center.x + ox * (dOff + 0.06), so.center.y + oy * (dOff + 0.06), `${o.width.toFixed(2)} m`, 0.1, 'A-DIMS', 1);
      }
    }

    // Stairs — outline, landings, treads, direction arrows, build annotation.
    for (const st of fl.stairs) {
      drawStairOn(shiftStair(st, yOff), lineB, textB, polyB);
    }

    // Parking — real stalls + aisle on A-PARKING.
    for (const stall of fl.parkingStalls) {
      const r = shiftRect(stall.rect, yOff);
      const [sw, se, ne, nw] = rCorners(r);
      lineB(sw.x, sw.y, se.x, se.y, 'A-PARKING');
      lineB(se.x, se.y, ne.x, ne.y, 'A-PARKING');
      lineB(ne.x, ne.y, nw.x, nw.y, 'A-PARKING');
      lineB(nw.x, nw.y, sw.x, sw.y, 'A-PARKING');
      textB((sw.x + ne.x) / 2, (sw.y + ne.y) / 2 - 0.2, `P${stall.index} F${fi}`, 0.25, 'A-PARKING', 1);
    }
    if (fl.parkingArea) {
      const a = shiftRect(fl.parkingArea.aisleRect, yOff);
      polyB([{ x: a.x, y: a.y }, { x: a.x + a.w, y: a.y }, { x: a.x + a.w, y: a.y + a.h }, { x: a.x, y: a.y + a.h }], 'A-PARKING', true);
      textB(a.x + a.w / 2, a.y + a.h / 2, 'AISLE', 0.25, 'A-PARKING', 1);
    }

    // Furniture/sanitary glyphs — P16-D-C, the established deferred path: the
    // Phase-11 generator already places Furniture footprints on every floor for
    // clearance QA (model/furniture.ts documents the A-FURN drawing intent), and
    // both layers exist since the original layer set. Each footprint is drawn as
    // a plain rectangle outline — footprints only, no invented symbols, no labels.
    for (const fu of fl.furniture ?? []) {
      const base = fu.type === 'toilet' || fu.type === 'sink' || fu.type === 'shower' || fu.type === 'bathtub' ? 'A-SANITARY' : 'A-FURN';
      const r = shiftRect(fu.rect, yOff);
      const [fa, fb, fc, fd] = rCorners(r);
      lineB(fa.x, fa.y, fb.x, fb.y, base);
      lineB(fb.x, fb.y, fc.x, fc.y, base);
      lineB(fc.x, fc.y, fd.x, fd.y, base);
      lineB(fd.x, fd.y, fa.x, fa.y, base);
    }

    // Room polygon geometry — canonical polygon (not the bounding rect).
    for (const s of fl.spaces) {
      const poly = s.polygon;
      if (poly && poly.length >= 3) {
        polyB(poly.map(p => ({ x: p.x, y: p.y + yOff })), 'A-ROOM', true);
      }
    }

    // Room labels + areas — area derived from the canonical POLYGON (never stale metadata).
    // P16-D-C professional annotation: the anchor is the deepest interior point of the
    // ACTUAL room polygon (guaranteed inside — a concave-room centroid can fall outside),
    // the text height is fitted to the room's inscribed chord through that anchor so the
    // label stays within the room, and tall-narrow rooms rotate the block 90° to run
    // along the long axis. All deterministic, geometry-derived placement.
    for (const s of fl.spaces) {
      const poly = s.polygon && s.polygon.length >= 3 ? s.polygon : null;
      const anchor = roomLabelAnchor(poly, s.rect);
      const area = polyArea(s.polygon, s.rect);
      totalNetArea += area;
      const lbl = candidate.floors.length > 1 ? `${s.label} · F${fi}` : s.label;
      const areaTxt = `${area.toFixed(1)} m²`;
      const { h, rot } = fitRoomText(lbl, areaTxt, poly, s.rect, anchor);
      const cx = anchor.x, cy = anchor.y + yOff;
      if (rot === 90) {
        // rotated block: lines stack ACROSS the text run — name on the +x side
        textB(cx + h * 0.62, cy, lbl, h, 'A-ROOM', 1, 90);
        textB(cx - h * 0.62, cy, areaTxt, h * 0.7, 'A-ROOM', 1, 90);
      } else {
        textB(cx, cy + h * 0.62, lbl, h, 'A-ROOM', 1);
        textB(cx, cy - h * 0.62, areaTxt, h * 0.7, 'A-ROOM', 1);
      }
    }

    // Annotation infrastructure — grid, dimension chains.
    if (fi === 0) emitGridShifted(candidate.buildableArea, emitLine, emitText, yOff);
    emitOuterDims(fl.footprint, yOff, fi, lineB, textB);
    emitRoomDims(fl.spaces, yOff, lineB, textB);
    if (fi === 0 && siteBox) emitSiteDims(siteBox, lineB, textB);

    if (fi === 0) drawNorthArrow(fl.footprint.x + fl.footprint.w - 1.2, fl.footprint.y + fl.footprint.h - 0.3 + yOff, emitLine, emitText);
  }

  if (candidate.floors[0]) {
    // Legend swatches sit ON the discipline layer they document (floor-0
    // routed so the 'none' scheme never leaves stray generic references).
    const floorScoped = new Set(baseForFloorLayers);
    const lineSw = (x1: number, y1: number, x2: number, y2: number, base: string) => {
      const ls = floorScoped.has(base) ? layersFor(0, base) : [base];
      for (const L of ls) emitLine(x1, y1, x2, y2, L);
    };
    drawTitleBlockV2(candidate, projectName, emitLine, emitText, siteBox, polyArea, totalNetArea, lineSw);
  }

  // Whole-building vertical markers (connect stairs across floors)
  if (candidate.floors.length > 1) {
    const firstStairs = candidate.floors[0].stairs;
    for (const st0 of firstStairs) {
      const r0 = st0.footprint ?? st0.rect;
      if (!r0) continue;
      const cx0 = r0.x + r0.w / 2;
      const cy0Bottom = r0.y + floorOffset(0);
      const cyTop = (candidate.floors[candidate.floors.length - 1].footprint.y + candidate.floors[candidate.floors.length - 1].footprint.h) + floorOffset(candidate.floors.length - 1);
      emitLine(cx0, cy0Bottom, cx0, cyTop, 'A-STAIR');
      emitText(cx0 + 0.2, cyTop + 0.2, `STAIR STACK — ${candidate.floors.length} FLOORS — Whole-Building`, 0.25, 'A-TEXT', 0);
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

// ---- P16-D presentation helpers (single source, scheme-routed via base-layer emitters) ----

// ---- P16-D-C room annotation helpers (deterministic, geometry-derived) ----

/** Average advance width of a txt.shx character as a fraction of its height. */
const ROOM_TXT_CHAR_W = 0.72;
/** Clear margin kept between a room label run and the room boundary (m). */
const ROOM_TXT_PAD = 0.15;
/** Readable room text height bounds (m at the documented 1:100 plot scale). */
const ROOM_TXT_MIN_H = 0.12;
const ROOM_TXT_MAX_H = 0.35;
/** The vertical run must beat horizontal by this factor before the label rotates. */
const ROOM_TXT_ROT_ADVANTAGE = 1.15;

/** Squared distance from point p to segment ab. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Distance from p to the nearest edge of the ring. */
function ringEdgeDist(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], bpt = poly[(i + 1) % n];
    best = Math.min(best, segDist2(p.x, p.y, a.x, a.y, bpt.x, bpt.y));
  }
  return Math.sqrt(best);
}

/**
 * Deterministic interior anchor for a room label — the deepest interior point
 * (pole of inaccessibility) of the actual polygon, found by a fixed grid scan
 * plus local refinement (no randomness). Unlike a concave room's centroid, the
 * result is guaranteed inside the polygon. Rect fallback: rect centre.
 */
function roomLabelAnchor(poly: Vec2[] | null, rect: Rect): Vec2 {
  if (!poly) return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const ring: Vec2[] = poly;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestD = -1;
  // P16-D-C tie-break: on a rectangular room every centreline point reaches the
  // same maximal depth — prefer the tie closest to the polygon centroid so labels
  // centre themselves. (Purely geometric comparator: deterministic, no randomness.)
  const cen = polygonCentroid(ring);
  let bestC2 = Infinity;
  const TOL = 1e-6;
  const consider = (p: Vec2) => {
    if (!pointInPolygon(p, ring)) return;
    const d = ringEdgeDist(p, ring);
    const c2 = (p.x - cen.x) * (p.x - cen.x) + (p.y - cen.y) * (p.y - cen.y);
    if (d > bestD + TOL || (d >= bestD - TOL && c2 < bestC2)) {
      if (d > bestD) bestD = d;
      bestC2 = c2;
      best = p;
    }
  };
  // coarse pass over the whole bbox …
  const span = Math.max(maxX - minX, maxY - minY);
  const cols = Math.max(1, Math.round((maxX - minX) / span * 24));
  const rows = Math.max(1, Math.round((maxY - minY) / span * 24));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      consider({ x: minX + (c / cols) * (maxX - minX), y: minY + (r / rows) * (maxY - minY) });
    }
  }
  // … then refine around the winner on a shrinking local grid.
  let step = span / 48;
  for (let k = 0; k < 6 && step > 1e-4; k++) {
    for (let gy = -2; gy <= 2; gy++) {
      for (let gx = -2; gx <= 2; gx++) {
        consider({ x: best.x + gx * step, y: best.y + gy * step });
      }
    }
    step /= 2;
  }
  return best;
}

/**
 * Length of the straight run inside the room through p, along X and along Y
 * (the chord of the polygon containing p). Rect fallback: rect w/h.
 */
function roomChords(poly: Vec2[] | null, rect: Rect, p: Vec2): { h: number; v: number } {
  const chord = (axis: 'x' | 'y'): number => {
    if (!poly) return axis === 'x' ? rect.w : rect.h;
    const pC = axis === 'x' ? p.y : p.x;
    const crossings: number[] = [];
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], bpt = poly[(i + 1) % n];
      const aC = axis === 'x' ? a.y : a.x, bC = axis === 'x' ? bpt.y : bpt.x;
      if ((aC <= pC) === (bC <= pC)) continue;
      const t = (pC - aC) / (bC - aC);
      crossings.push(axis === 'x' ? a.x + t * (bpt.x - a.x) : a.y + t * (bpt.y - a.y));
    }
    crossings.sort((u, w) => u - w);
    const pc = axis === 'x' ? p.x : p.y;
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      if (crossings[i] - 1e-9 <= pc && pc <= crossings[i + 1] + 1e-9) return crossings[i + 1] - crossings[i];
    }
    return axis === 'x' ? rect.w : rect.h; // numeric fallback
  };
  return { h: chord('x'), v: chord('y') };
}

/**
 * Fit the room name/area text block deterministically: the largest height at
 * which the wider line still fits the room chord through the anchor, compared
 * horizontally vs rotated 90°. The orientation only flips when the vertical
 * run wins by a clear margin, so near-square rooms keep horizontal labels.
 */
function fitRoomText(lbl: string, areaTxt: string, poly: Vec2[] | null, rect: Rect, anchor: Vec2): { h: number; rot: 0 | 90 } {
  const c = roomChords(poly, rect, anchor);
  const fitH = (chord: number, txt: string, factor: number) =>
    Math.max(ROOM_TXT_MIN_H, Math.min(ROOM_TXT_MAX_H, (chord - 2 * ROOM_TXT_PAD) / (txt.length * ROOM_TXT_CHAR_W * factor)));
  // the name line governs; the area line (0.7× the name height) must fit too
  const hFit = (chord: number) => Math.min(fitH(chord, lbl, 1), fitH(chord, areaTxt, 0.7));
  const hh = hFit(c.h);
  const hv = hFit(c.v);
  return hv > hh * ROOM_TXT_ROT_ADVANTAGE ? { h: hv, rot: 90 } : { h: hh, rot: 0 };
}

/** 45° architectural tick at a dimension endpoint, oriented along (dirX, dirY). */
function drawTickAt(
  line: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
  x: number, y: number, dirX: number, dirY: number, base = 'A-DIMS',
) {
  const t = 0.05;
  // tick = short slash rotated 45° from the dimension line direction
  const px = -dirY, py = dirX;
  line(x - dirX * t - px * t, y - dirY * t - py * t, x + dirX * t + px * t, y + dirY * t + py * t, base);
}

/** Window: two wall-face lines + two glass lines inside the opening (classic double-line symbol). */
function drawWindowOn(
  o: Opening,
  line: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  layer: string,
) {
  const perp: Vec2 = { x: -o.wallDir.y, y: o.wallDir.x };
  const half = o.width / 2;
  const center = o.center;
  const along = o.wallDir;
  const depth = 0.04;
  for (const sign of [-1.5, -0.5, 0.5, 1.5]) {
    const cx = center.x + perp.x * depth * sign;
    const cy = center.y + perp.y * depth * sign;
    line(cx - along.x * half, cy - along.y * half, cx + along.x * half, cy + along.y * half, layer);
  }
}

/** Door: leaf line, quarter-circle swing arc, leaf-end thickness tick. */
function drawDoorOn(
  o: Opening,
  line: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  arc: (cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer: string) => void,
  layer: string,
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
    hinge = { x: o.center.x + along.x * (o.width / 2) * hingeSign, y: o.center.y + along.y * (o.width / 2) * hingeSign };
    closedEnd = { x: o.center.x - along.x * (o.width / 2) * hingeSign, y: o.center.y - along.y * (o.width / 2) * hingeSign };
    openEnd = { x: hinge.x + n.x * o.width, y: hinge.y + n.y * o.width };
  }
  line(hinge.x, hinge.y, closedEnd.x, closedEnd.y, layer);
  const a1 = Math.atan2(closedEnd.y - hinge.y, closedEnd.x - hinge.x) * 180 / Math.PI;
  const a2 = Math.atan2(openEnd.y - hinge.y, openEnd.x - hinge.x) * 180 / Math.PI;
  let start = a1, end = a2;
  let diff = end - start;
  while (diff < 0) diff += 360;
  while (diff > 360) diff -= 360;
  if (diff > 180) { const t = start; start = end; end = t; }
  if (end < start) end += 360;
  arc(hinge.x, hinge.y, o.width, start, end, layer);
  if (o.leafThickness) {
    const perpOpen: Vec2 = { x: -n.y, y: n.x };
    const thk = o.leafThickness;
    line(openEnd.x, openEnd.y, openEnd.x + perpOpen.x * thk, openEnd.y + perpOpen.y * thk, layer);
  }
}

/** Stair: outline, landings with labels, per-flight treads, direction arrows, build note. */
function drawStairOn(
  st: any,
  line: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
  text: (x: number, y: number, txt: string, h: number, base: string, horiz?: number) => void,
  poly: (pts: Vec2[], base: string, closed?: boolean) => void,
) {
  const rect: Rect = st.footprint ?? st.rect;
  const [sw, se, ne, nw] = rCorners(rect);
  // Stair well envelope: explicit edges (easily selectable in any tool).
  const env = [sw, se, ne, nw];
  for (let j = 0; j < env.length; j++) {
    const q = env[(j + 1) % env.length];
    line(env[j].x, env[j].y, q.x, q.y, 'A-STAIR');
  }

  const flights: any[] = st.flights ?? [];
  const landings: any[] = st.landings ?? [];

  if (flights.length === 0) {
    const t = Math.max(0.25, st.tread ?? 0.28);
    const x0 = rect.x + 0.1;
    const x1 = rect.x + rect.w - 0.1;
    let y = rect.y + 0.3;
    while (y < rect.y + rect.h - 0.3) {
      line(x0, y, x1, y, 'A-STAIR-TREAD');
      y += t;
    }
    text(rect.x + rect.w - 0.6, rect.y + rect.h - 0.3, 'UP', 0.2, 'A-STAIR-DIR');
    return;
  }

  for (const l of landings) {
    const lr = l.footprint as Rect;
    const [a, b, c, d] = rCorners(lr);
    poly([a, b, c, d], 'A-STAIR', true);
    text(lr.x + lr.w / 2, lr.y + lr.h / 2, `LDNG ${l.depth?.toFixed(2) ?? Math.max(lr.w, lr.h).toFixed(2)}`, 0.18, 'A-STAIR', 1);
  }

  for (const fl of flights) {
    const fr = fl.footprint as Rect;
    const dir: string = fl.direction;
    const [a, b, c, d] = rCorners(fr);
    poly([a, b, c, d], 'A-STAIR', false);
    const t = fl.treadDepth ?? st.tread ?? 0.28;
    if (dir === 'north' || dir === 'south') {
      const x0 = fr.x; const x1 = fr.x + fr.w;
      const yStart = fl.startPoint.y; const yEnd = fl.endPoint.y;
      const step = yEnd > yStart ? t : -t;
      for (let y = yStart + step; Math.abs(y - yEnd) > 0.005; y += step) {
        if (y < fr.y - 0.005 || y > fr.y + fr.h + 0.005) break;
        line(x0, y, x1, y, 'A-STAIR-TREAD');
      }
    } else {
      const y0 = fr.y; const y1 = fr.y + fr.h;
      const xStart = fl.startPoint.x; const xEnd = fl.endPoint.x;
      const step = xEnd > xStart ? t : -t;
      for (let x = xStart + step; Math.abs(x - xEnd) > 0.005; x += step) {
        if (x < fr.x - 0.005 || x > fr.x + fr.w + 0.005) break;
        line(x, y0, x, y1, 'A-STAIR-TREAD');
      }
    }
    const cx = (fl.startPoint.x + fl.endPoint.x) / 2;
    const cy = (fl.startPoint.y + fl.endPoint.y) / 2;
    drawDirArrowOn(cx, cy, dir, line, 0.35);
  }

  const bottom = flights.reduce((p: any, c: any) => (c.startPoint.y < p.startPoint.y ? c : p), flights[0]);
  text(bottom.startPoint.x - 0.25, bottom.startPoint.y - 0.05, 'UP', 0.18, 'A-STAIR-DIR');
  // Annotate the ACTUAL generated geometry (per-flight going and riser).
  // Routed to A-TEXT (P16-D-B): a build note, kept off the direction-arrow layer.
  const actRiser = flights[0]?.riserHeight ?? st.riserHeight ?? st.riser ?? 0;
  const actTread = Math.min(...flights.map((f: any) => f.treadDepth ?? st.tread ?? st.treadDepth ?? 0.28));
  const lvl = st.floor ?? 0;
  const label = `${flights.length}F · ${st.totalRisers}R @ ${(actRiser*100).toFixed(0)}×${(actTread*100).toFixed(0)} · F${lvl}→F${lvl + 1} ${st.type}${st.entrySide ? ' ent.' + st.entrySide : ''}`;
  text(rect.x + 0.1, rect.y + rect.h - 0.15, label, 0.15, 'A-TEXT');
}

/** Up/down direction arrow with open V head. */
function drawDirArrowOn(
  cx: number, cy: number, dir: string,
  line: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
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
  line(bx, by, tipX, tipY, 'A-STAIR-DIR');
  if (dir === 'north' || dir === 'south') {
    const s = dir === 'north' ? -1 : 1;
    line(tipX, tipY, tipX - 0.08, tipY + s * 0.12, 'A-STAIR-DIR');
    line(tipX, tipY, tipX + 0.08, tipY + s * 0.12, 'A-STAIR-DIR');
  } else {
    const s = dir === 'east' ? -1 : 1;
    line(tipX, tipY, tipX + s * 0.12, tipY - 0.08, 'A-STAIR-DIR');
    line(tipX, tipY, tipX + s * 0.12, tipY + 0.08, 'A-STAIR-DIR');
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
  // A CIRCLE entity isn't used here to keep this helper line-only.
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a1 = (i / n) * Math.PI * 2;
    const a2 = ((i + 1) / n) * Math.PI * 2;
    emitLine(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, 'A-NORTH');
  }
}

/**
 * P16-D title block: professional drawing information + layer legend, model space,
 * A-TITLE. Deterministic — no wall-clock dates (byte determinism is a hard contract).
 */
function drawTitleBlockV2(
  cand: LayoutCandidate,
  projectName: string,
  emitLine: (x1: number, y1: number, x2: number, y2: number, layer: string) => void,
  emitText: (x: number, y: number, text: string, h: number, layer: string, horiz?: number) => void,
  siteBox: { x: number; y: number; w: number; h: number } | null,
  polyArea: (poly: Vec2[] | undefined, fallback: Rect) => number,
  totalNetArea: number,
  swLine?: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
): void {
  const fr = cand.floors[0].footprint;
  const pad = 1.5;
  const bx0 = fr.x - pad;
  const by0 = fr.y - pad - 4.6;
  const bx1 = fr.x + fr.w + pad;
  const by1 = fr.y + fr.h + pad;
  // outer border around the full drawing
  emitLine(bx0, by0, bx1, by0, 'A-TITLE');
  emitLine(bx1, by0, bx1, by1, 'A-TITLE');
  emitLine(bx1, by1, bx0, by1, 'A-TITLE');
  emitLine(bx0, by1, bx0, by0, 'A-TITLE');
  // title box, bottom-right
  const tw = Math.min(11, Math.max(6, fr.w)), th = 2.4;
  const tx0 = bx1 - tw, ty0 = by0 + 0.15;
  emitLine(tx0, ty0, bx1 - 0.15, ty0, 'A-TITLE');
  emitLine(bx1 - 0.15, ty0, bx1 - 0.15, ty0 + th, 'A-TITLE');
  emitLine(bx1 - 0.15, ty0 + th, tx0, ty0 + th, 'A-TITLE');
  emitLine(tx0, ty0 + th, tx0, ty0, 'A-TITLE');
  emitLine(tx0 + 0.25, ty0 + th - 0.75, bx1 - 0.4, ty0 + th - 0.75, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + th - 0.55, projectName, 0.32, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + th - 1.1, `FLOOR PLANS — ${cand.floors.length} FLOOR(S) | STRATEGY ${cand.metadata.strategy}`, 0.18, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + th - 1.5, 'UNITS: MILLIMETRES | MODEL SPACE 1:1 | PLOT SCALE 1:100 @ A1', 0.16, 'A-TITLE');
  const siteTxt = siteBox ? ` | SITE ${siteBox.w.toFixed(1)}x${siteBox.h.toFixed(1)} m` : '';
  emitText(tx0 + 0.3, ty0 + th - 1.9, `NET FLOOR AREA (SUM OF ROOMS, ALL FLOORS): ${totalNetArea.toFixed(1)} m²${siteTxt}`, 0.16, 'A-TITLE');
  emitText(tx0 + 0.3, ty0 + 0.12, 'ARCHGENIUS — AUTOMATED CAD DRAFT — PROFESSIONAL REVIEW REQUIRED', 0.14, 'A-TITLE');
  // layer legend — swatch on the discipline layer + name on A-TITLE
  const LEG: Array<[string, string]> = [
    ['A-WALL-EXT', 'WALL, EXTERIOR'], ['A-WALL-INT', 'WALL, INTERIOR'], ['A-WALL-CORE', 'WALL, CORE'],
    ['A-DOOR', 'DOOR + SWING'], ['A-WINDOW', 'WINDOW'], ['A-STAIR', 'STAIR / LANDING'],
    ['A-PARKING', 'PARKING STALL'],
    ['A-DIMS', 'DIMENSIONS (m)'], ['A-TEXT', 'GENERAL NOTES'], ['A-SITE', 'SITE BOUNDARY'], ['A-GRID', 'GRID / AXIS'],
  ];
  const lx = tx0 - 3.6, lyTop = ty0 + 0.35;
  emitText(lx, lyTop + 0.35, 'LEGEND', 0.2, 'A-TITLE');
  const sw = swLine ?? emitLine;
  for (let i = 0; i < LEG.length; i++) {
    const y = lyTop + i * 0.3;
    sw(lx, y, lx + 0.9, y, LEG[i][0]);
    emitText(lx + 1.15, y - 0.06, `${LEG[i][0]} — ${LEG[i][1]}`, 0.14, 'A-TITLE');
  }
  emitLine(lx - 0.2, ty0, lx - 0.2, ty0 + th + 1.3, 'A-TITLE');
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

/** Room chain dimensions: dim line + 45° ticks + value, bottom and left of each room. */
function emitRoomDims(
  spaces: Space[],
  yOff: number,
  line: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
  text: (x: number, y: number, txt: string, h: number, base: string, horiz?: number) => void,
) {
  for (const s of spaces) {
    if (s.type === 'parking' || s.type === 'yard') continue;
    if (s.rect.w < 2 || s.rect.h < 2) continue;
    const r = { x: s.rect.x, y: s.rect.y + yOff, w: s.rect.w, h: s.rect.h };
    const off = 0.18;
    line(r.x, r.y - off, r.x + r.w, r.y - off, 'A-DIMS');
    drawTickAt(line, r.x, r.y - off, 1, 0);
    drawTickAt(line, r.x + r.w, r.y - off, 1, 0);
    text(r.x + r.w / 2, r.y - off - 0.16, `${r.w.toFixed(2)} m`, 0.12, 'A-DIMS', 1);
    line(r.x - off, r.y, r.x - off, r.y + r.h, 'A-DIMS');
    drawTickAt(line, r.x - off, r.y, 0, 1);
    drawTickAt(line, r.x - off, r.y + r.h, 0, 1);
    text(r.x - off - 0.2, r.y + r.h / 2, `${r.h.toFixed(2)} m`, 0.12, 'A-DIMS', 2);
  }
}

/** Building overall dimensions per floor, outboard with witness lines + ticks. */
function emitOuterDims(
  fr: Rect,
  yOff: number,
  fi: number,
  line: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
  text: (x: number, y: number, txt: string, h: number, base: string, horiz?: number) => void,
) {
  const r = shiftRect(fr, yOff);
  const off = 1.0;
  line(r.x, r.y - 0.1, r.x, r.y - off - 0.15, 'A-DIMS');
  line(r.x + r.w, r.y - 0.1, r.x + r.w, r.y - off - 0.15, 'A-DIMS');
  line(r.x, r.y - off, r.x + r.w, r.y - off, 'A-DIMS');
  drawTickAt(line, r.x, r.y - off, 1, 0);
  drawTickAt(line, r.x + r.w, r.y - off, 1, 0);
  text((r.x + r.x + r.w) / 2, r.y - off - 0.32, `${r.w.toFixed(2)} m F${fi}`, 0.2, 'A-DIMS', 1);
  line(r.x - 0.1, r.y, r.x - off - 0.15, r.y, 'A-DIMS');
  line(r.x - 0.1, r.y + r.h, r.x - off - 0.15, r.y + r.h, 'A-DIMS');
  line(r.x - off, r.y, r.x - off, r.y + r.h, 'A-DIMS');
  drawTickAt(line, r.x - off, r.y, 0, 1);
  drawTickAt(line, r.x - off, r.y + r.h, 0, 1);
  text(r.x - off - 0.3, (r.y + r.y + r.h) / 2, `${r.h.toFixed(2)} m`, 0.2, 'A-DIMS', 2);
}

/** Site overall dimensions on the ground-floor context band. */
function emitSiteDims(
  site: { x: number; y: number; w: number; h: number },
  line: (x1: number, y1: number, x2: number, y2: number, base: string) => void,
  text: (x: number, y: number, txt: string, h: number, base: string, horiz?: number) => void,
) {
  const off = 1.9;
  line(site.x, site.y - 0.6, site.x, site.y - off - 0.15, 'A-DIMS');
  line(site.x + site.w, site.y - 0.6, site.x + site.w, site.y - off - 0.15, 'A-DIMS');
  line(site.x, site.y - off, site.x + site.w, site.y - off, 'A-DIMS');
  drawTickAt(line, site.x, site.y - off, 1, 0);
  drawTickAt(line, site.x + site.w, site.y - off, 1, 0);
  text(site.x + site.w / 2, site.y - off - 0.34, `SITE ${site.w.toFixed(2)} m`, 0.22, 'A-DIMS', 1);
  line(site.x - 0.6, site.y, site.x - 2.5, site.y, 'A-DIMS');
  line(site.x - 0.6, site.y + site.h, site.x - 2.5, site.y + site.h, 'A-DIMS');
  line(site.x - off, site.y, site.x - off, site.y + site.h, 'A-DIMS');
  drawTickAt(line, site.x - off, site.y, 0, 1);
  drawTickAt(line, site.x - off, site.y + site.h, 0, 1);
  text(site.x - off - 0.34, site.y + site.h / 2, `SITE ${site.h.toFixed(2)} m`, 0.22, 'A-DIMS', 2);
}

// legacy no-op aliases removed in P16-D (single implementation per concern)

function writeLtype(b: string[], name: string, desc: string, pattern: number[]) {
  // Minimal R12 fix: 49/74 dash pattern elements cause AutoCAD to open empty (W1 PASS without 49, W2 FAIL with 49 31.75)
  // Keep names (CONTINUOUS/CENTER/DASHED) for layer references, but emit no dash elements — solid linetype, AutoCAD-compatible.
  // Deterministic: 73 0, 40 0 for all, no 49/74.
  b.push('0', 'LTYPE');
  b.push('2', name);
  b.push('70', '0');
  b.push('3', desc);
  b.push('72', '65'); // R12-required alignment code ('A')
  b.push('73', '0');
  b.push('40', '0');
}

/**
 * P16-D DXF quality gate — structural + presentation sanity, deterministic and
 * line-oriented (no external parser). Beyond the R12 profile checks this audits:
 * NaN/Infinity coordinates, zero-length segments, exact same-layer duplicate
 * entities, undefined layer references, invalid text (empty string / zero height),
 * invalid ARC radius, under-vertexed polylines, absurd coordinate magnitudes and
 * dangling linetype references. Coincident geometry across DIFFERENT layers stays
 * legal — shared building faces are legitimate representation, not an error.
 */
export function validateDXFStructure(dxf: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = dxf.split(/\r?\n/);
  if (!lines.includes('SECTION')) errors.push('Missing SECTION');
  if (!lines.includes('ENTITIES')) errors.push('Missing ENTITIES section');
  if (!lines.includes('EOF')) errors.push('Missing EOF');
  if (!lines.includes('LAYER')) errors.push('Missing LAYER table');
  for (const name of ['A-WALL-EXT', 'A-WALL-INT', 'A-DOOR', 'A-WINDOW', 'A-ROOM', 'A-DIMS', 'A-TEXT', 'A-STAIR', 'A-STAIR-TREAD', 'A-STAIR-DIR', 'A-GRID', 'A-AXIS', 'A-AXIS-TEXT', 'A-NORTH', 'A-TITLE', 'A-PARKING', 'A-FURN', 'A-SANITARY', 'A-SITE', 'A-SETBACK', 'A-BLDG-OUT']) {
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

  // ---- entity-level audit ----
  let entStart = -1;
  for (let i = 0; i + 3 < lines.length; i++) {
    if (lines[i].trim() === '0' && lines[i + 1] === 'SECTION' && lines[i + 2].trim() === '2' && lines[i + 3].trim() === 'ENTITIES') { entStart = i + 4; break; }
  }
  if (entStart >= 0) {
    // Defined layer names + linetypes from TABLES.
    const definedLayers = new Set<string>();
    const definedLtypes = new Set<string>(['ByLayer', 'ByBlock', 'CONTINUOUS']);
    for (let i = 0; i + 1 < lines.length; i++) {
      if (lines[i].trim() !== '0') continue;
      const t = lines[i + 1].trim();
      if (t !== 'LAYER' && t !== 'LTYPE') continue;
      // record layout: (0,TYPE) (2,NAME) ... — NAME is the first code-2 pair of the record
      for (let j = i + 2; j + 1 < lines.length && j < i + 14; j += 2) {
        const c = lines[j].trim();
        if (c === '0') break;
        if (c === '2') { if (t === 'LAYER') definedLayers.add(lines[j + 1].trim()); else definedLtypes.add(lines[j + 1].trim()); break; }
      }
    }
    // Walk ENTITIES records; validate per record + collect signatures.
    const sig = new Map<string, number>();
    let nonFinite = 0, zeroLen = 0, badText = 0, badArc = 0, thinPoly = 0, huge = 0, dup = 0;
    let curType = '';
    let codes: Record<string, string> = {};
    let verts = 0;
    let polyPts = '';
    const numericCodes = new Set(['10', '20', '30', '11', '21', '31', '40', '50', '51', '42']);
    const finishRecord = () => {
      if (!curType) return;
      if (curType === 'LINE' && codes['10'] === codes['11'] && codes['20'] === codes['21']) zeroLen++;
      if (curType === 'ARC' && !(Number(codes['40']) > 0)) badArc++;
      if (curType === 'TEXT' && (codes['1'] === undefined || codes['1'] === '' || !(Number(codes['40']) > 0))) badText++;
      if (curType === 'POLYLINE' && verts < 2) thinPoly++;
      if (curType === 'LINE' || curType === 'ARC' || curType === 'TEXT' || curType === 'POLYLINE') {
        const key = `${curType}|${codes['8'] ?? ''}|` + ['10', '20', '11', '21', '40', '50', '51', '1'].map(c => codes[c] ?? '').join(',') + (curType === 'POLYLINE' ? `|${verts}:${polyPts}` : '');
        const n = (sig.get(key) ?? 0) + 1;
        if (n > 1) dup++;
        sig.set(key, n);
      }
      curType = ''; codes = {};
    };
    for (let i = entStart; i + 1 < lines.length; i++) {
      const code = lines[i].trim();
      const value = lines[i + 1];
      if (code === '0') {
        const t = value.trim();
        if (t === 'ENDSEC' || t === 'EOF') { finishRecord(); break; }
        if (t === 'VERTEX' && curType === 'POLYLINE') { verts++; i++; continue; } // vertex codes fold into polyPts below
        if (t === 'SEQEND') { i++; continue; } // finalizes when the outer loop hits the next 0 record
        finishRecord();
        i++; // consume the entity type line
        if (t === 'POLYLINE') { verts = 0; polyPts = ''; }
        curType = t; codes = {};
        continue;
      }
      if (!curType) continue;
      if (numericCodes.has(code)) {
        const n = Number(value.trim());
        if (!Number.isFinite(n)) nonFinite++;
        else if (Math.abs(n) > 1e9) huge++;
      }
      if (code === '8') {
        const layer = value.trim();
        if (layer && !definedLayers.has(layer)) errors.push(`Entity references undefined layer: ${layer}`);
      }
      if (code === '6') {
        const lt = value.trim();
        if (lt && !definedLtypes.has(lt)) errors.push(`Invalid linetype reference: ${lt}`);
      }
      if (curType === 'POLYLINE' && (code === '10' || code === '20')) polyPts += value.trim() + ',';
      if (curType === 'LINE' || curType === 'TEXT' || curType === 'ARC' || curType === 'POLYLINE') {
        codes[code] = value.trim();
      }
      i++; // consumed the value line
    }
    finishRecord();
    const uniq: string[] = [];
    for (const e of errors) if (!uniq.includes(e)) uniq.push(e);
    errors.length = 0;
    for (const e of uniq) errors.push(e);
    if (nonFinite) errors.push(`Non-finite (NaN/Infinity) coordinates in ${nonFinite} group values`);
    if (zeroLen) errors.push(`Zero-length LINE segments: ${zeroLen}`);
    if (dup) errors.push(`Exact duplicate entities on the same layer: ${dup}`);
    if (badText) errors.push(`Invalid TEXT (empty string or zero/negative height): ${badText}`);
    if (badArc) errors.push(`Invalid ARC radius (<= 0): ${badArc}`);
    if (thinPoly) errors.push(`POLYLINE with fewer than 2 vertices: ${thinPoly}`);
    if (huge) errors.push(`Coordinate magnitude beyond sane drawing bounds (|v| > 1e9 mm): ${huge}`);
  }
  return { ok: errors.length === 0, errors };
}

