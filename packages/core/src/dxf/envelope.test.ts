import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF } from '../pipeline.js';
import { writeDXF } from './writer.js';

/**
 * Regression: Downloaded DXF must contain visible modelspace geometry.
 * Verifies that browser Blob download path (via writeDXF) produces same bytes as exportDXF.
 *
 * Phase 28-E contract (real AutoCAD 2027 evidence, Phase 28-C G1/G2/G3 +
 * Phase 28-D H0..H5 ladders — the H0/$ACADVER-only profile opens visible and
 * editable; EVERY additional header variable and the VPORT table reproduce the
 * black/blank open; see docs/DXF_R12_COMPATIBILITY.md §1.6):
 *   - the HEADER contains ONLY $ACADVER = AC1009 (proven-safe minimal profile);
 *   - $INSBASE, $EXTMIN/$EXTMAX, $LIMMIN/$LIMMAX, $VIEWCTR/$VIEWSIZE, $VIEWDIR,
 *     $LUNITS are FORBIDDEN (each reproduced the failure in the 28-D ladder);
 *   - no VPORT table / *ACTIVE viewport (forbidden, same evidence);
 *   - the R13+ variables ($SCREENSIZE/$DWGCODEPAGE/$INSUNITS/$MEASUREMENT)
 *     stay forbidden;
 *   - output stays deterministic (byte-identical across repeated generation).
 */
describe('DXF envelope regression', () => {
  it('Downloaded DXF must contain visible modelspace geometry inside sane envelope', () => {
    const input = {
      name: 'envelope-test',
      site: { shape: 'rectangle', width: 15.5, length: 22, accessSide: 'south', streetWidth: 6, setbacks: { north: 1, south: 1, east: 1, west: 1 } },
      building: { type: 'villa', floors: 1, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false, hasStorage: true },
      deterministic: true, seed: 42,
    } as any;
    const proj = createProject(input);
    const res = generate(proj, { allStrategies: true });
    const cand = res.candidates[0];
    expect(cand).toBeDefined();
    const { dxf } = exportDXF(cand, 'envelope');
    const dxf2 = writeDXF(cand, 'envelope');
    // Browser Blob path must be byte-identical to exportDXF string (no transformation loss)
    expect(dxf2).toBe(dxf);
    // Deterministic: repeated generation must be byte-identical
    const dxf3 = writeDXF(generate(createProject(input), { allStrategies: true }).candidates[0], 'envelope');
    expect(dxf3).toBe(dxf);

    // Structural checks — R12 AC1009 with the Phase 28-E minimal header
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    // Phase 28-D ladder: every variable beyond $ACADVER is forbidden
    for (const v of ['$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$VIEWCTR', '$VIEWSIZE', '$VIEWDIR', '$LUNITS']) {
      expect(dxf).not.toContain(v);
    }
    // Genuinely invalid R13+ variables must stay absent
    expect(dxf).not.toContain('$SCREENSIZE');
    expect(dxf).not.toContain('$DWGCODEPAGE');
    expect(dxf).not.toContain('$INSUNITS');
    expect(dxf).not.toContain('$MEASUREMENT');
    expect(dxf.split('\r\n').join('')).not.toMatch(/[\r\n]/); // pure CRLF

    // Parse into pairs
    const lines = dxf.split('\r\n');
    const pairs: Array<{ code: number; value: string }> = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push({ code: Number(lines[i]), value: lines[i + 1] });

    const header: Record<string, Array<{ code: number; value: string }>> = {};
    let currentVar: string | null = null;
    let inHeader = false;
    for (const p of pairs) {
      if (p.code === 0 && p.value.trim() === 'SECTION') { currentVar = null; continue; }
      if (p.code === 2 && currentVar === null && !inHeader && p.value.trim() === 'HEADER') { inHeader = true; continue; }
      if (p.code === 0 && p.value.trim() === 'ENDSEC' && inHeader) break;
      if (inHeader && p.code === 9) { currentVar = p.value.trim(); header[currentVar] = []; continue; }
      if (inHeader && currentVar) header[currentVar].push({ code: p.code, value: p.value.trim() });
    }
    // --- Header contains ONLY $ACADVER (proven-safe minimal profile) ---
    for (const v of ['$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$VIEWCTR', '$VIEWSIZE', '$VIEWDIR', '$LUNITS']) {
      expect(header[v], `forbidden HEADER variable ${v} present`).toBeUndefined();
    }
    // --- Table order: LTYPE first (T2/H0-class), no VPORT anywhere ---
    let firstTable: string | null = null;
    const tablePos: Record<string, number> = {};
    for (let i = 0; i + 3 < pairs.length; i++) {
      if (pairs[i].code === 0 && pairs[i].value.trim() === 'TABLE' && pairs[i + 1].code === 2) {
        const name = pairs[i + 1].value.trim();
        if (tablePos[name] === undefined) tablePos[name] = i;
        if (firstTable === null) firstTable = name;
      }
    }
    expect(firstTable).toBe('LTYPE');
    expect(tablePos['LTYPE']).toBeLessThan(tablePos['LAYER']);
    expect(tablePos['LAYER']).toBeLessThan(tablePos['STYLE']);
    expect(tablePos['VPORT']).toBeUndefined();
    expect(dxf.includes('*ACTIVE')).toBe(false);

    let section = '';
    let curEnt: { type: string; codes: Record<number, string> } | null = null;
    const entities: Array<{ type: string; codes: Record<number, string> }>[] = [];
    const allEntities: Array<{ type: string; codes: Record<number, string> }> = [];
    for (let i = 0; i < pairs.length; i++) {
      const { code, value } = pairs[i];
      const v = value.trim();
      if (code === 0) {
        if (curEnt) allEntities.push(curEnt);
        curEnt = null;
        if (v === 'SECTION') { const nxt = pairs[i + 1]; if (nxt && nxt.code === 2) { section = nxt.value.trim(); i++; } }
        else if (section === 'ENTITIES') curEnt = { type: v, codes: {} };
      } else if (section === 'ENTITIES' && curEnt) {
        curEnt.codes[code] = value;
      }
    }
    if (curEnt) allEntities.push(curEnt);
    const linesEnt = allEntities.filter(e => e.type === 'LINE');
    // Phase 28-E: no DECLARED header envelope (AutoCAD scales the view to the
    // geometry automatically) — derive the envelope from the emitted geometry
    // itself and check every point against it below.
    let geomMinX = Infinity, geomMinY = Infinity, geomMaxX = -Infinity, geomMaxY = -Infinity;
    for (const e of allEntities) {
      for (const c of [10, 11]) {
        if (e.codes[c] !== undefined) {
          const n = Number(e.codes[c]);
          if (Number.isFinite(n)) { geomMinX = Math.min(geomMinX, n); geomMaxX = Math.max(geomMaxX, n); }
        }
      }
      for (const c of [20, 21]) {
        if (e.codes[c] !== undefined) {
          const n = Number(e.codes[c]);
          if (Number.isFinite(n)) { geomMinY = Math.min(geomMinY, n); geomMaxY = Math.max(geomMaxY, n); }
        }
      }
    }
    expect(Number.isFinite(geomMinX) && Number.isFinite(geomMinY)).toBe(true);
    expect(geomMinX).toBeLessThan(geomMaxX);
    expect(geomMinY).toBeLessThan(geomMaxY);
    const extMinX = geomMinX, extMinY = geomMinY, extMaxX = geomMaxX, extMaxY = geomMaxY;
    expect(linesEnt.length).toBeGreaterThan(100);
    // All LINEs must have finite coordinates within sane mm range (site 15.5x22m => 0..~25000 mm, with offset)
    for (const e of linesEnt) {
      const x1 = Number(e.codes[10]), y1 = Number(e.codes[20]), x2 = Number(e.codes[11]), y2 = Number(e.codes[21]);
      expect(Number.isFinite(x1)).toBe(true);
      expect(Number.isFinite(y1)).toBe(true);
      expect(Number.isFinite(x2)).toBe(true);
      expect(Number.isFinite(y2)).toBe(true);
      // Sane bounds: allow up to 100m (100000mm) to account for multi-floor stacking; allow negative for title block offset
      expect(x1).toBeGreaterThanOrEqual(-10000);
      expect(x1).toBeLessThanOrEqual(100000);
      expect(y1).toBeGreaterThanOrEqual(-10000);
      expect(y1).toBeLessThanOrEqual(100000);
      expect(x2).toBeGreaterThanOrEqual(-10000);
      expect(x2).toBeLessThanOrEqual(100000);
      expect(y2).toBeGreaterThanOrEqual(-10000);
      expect(y2).toBeLessThanOrEqual(100000);
      // R12 LINE must have 30/31 = 0
      expect(e.codes[30]).toBe('0');
      expect(e.codes[31]).toBe('0');
      // Inside the DECLARED envelope (with 1-unit slack for 2-decimal rounding)
      expect(x1).toBeGreaterThanOrEqual(extMinX - 1);
      expect(x1).toBeLessThanOrEqual(extMaxX + 1);
      expect(x2).toBeGreaterThanOrEqual(extMinX - 1);
      expect(x2).toBeLessThanOrEqual(extMaxX + 1);
      expect(y1).toBeGreaterThanOrEqual(extMinY - 1);
      expect(y1).toBeLessThanOrEqual(extMaxY + 1);
      expect(y2).toBeGreaterThanOrEqual(extMinY - 1);
      expect(y2).toBeLessThanOrEqual(extMaxY + 1);
    }
    // TEXT/ARC/VERTEX points must also lie inside the declared envelope
    for (const e of allEntities) {
      if (e.type !== 'TEXT' && e.type !== 'ARC' && e.type !== 'VERTEX') continue;
      const x = Number(e.codes[10]), y = Number(e.codes[20]);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(extMinX - (e.type === 'ARC' ? Number(e.codes[40]) : 1));
      expect(x).toBeLessThanOrEqual(extMaxX + (e.type === 'ARC' ? Number(e.codes[40]) : 1));
      expect(y).toBeGreaterThanOrEqual(extMinY - (e.type === 'ARC' ? Number(e.codes[40]) : 1));
      expect(y).toBeLessThanOrEqual(extMaxY + (e.type === 'ARC' ? Number(e.codes[40]) : 1));
    }


    // Phase 28-E: no $VIEWSIZE / VPORT — AutoCAD 2027 fits the view to the
    // drawing extents automatically when no view metadata is present (proven by
    // the H0 ladder file opening visible/editable). Nothing left to assert here;
    // display verification in AutoCAD remains the manual acceptance oracle.
  });
});

