import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF } from '../pipeline.js';
import { writeDXF } from './writer.js';

/**
 * Regression: Downloaded DXF must contain visible modelspace geometry inside sane envelope.
 * Verifies that browser Blob download path (via writeDXF) produces same bytes as exportDXF.
 *
 * P22-B contract (restores what commit 00a6b57 wrongly removed — the 2026-09-19
 * black-screen fix profile, see docs/DXF_R12_COMPATIBILITY.md):
 *   - required initial-view HEADER variables exist: $INSBASE, $EXTMIN/$EXTMAX,
 *     $LIMMIN/$LIMMAX, $VIEWCTR/$VIEWSIZE, $VIEWDIR (0,0,1), $LUNITS (2, decimal);
 *   - the view values are derived from the actual emitted-geometry envelope;
 *   - the VPORT table exists, is the FIRST table, and carries a *ACTIVE viewport;
 *   - $VIEWSIZE covers the generated envelope (both axes);
 *   - output stays deterministic (byte-identical across repeated generation);
 *   - the genuinely invalid R13+ variables stay forbidden.
 * Rationale: AutoCAD opens a DXF at $VIEWCTR/$VIEWSIZE (+ *ACTIVE VPORT). Without
 * them a millimetre-scale drawing (~50,000 units from the origin) opens as a
 * black/empty default view near the origin — even though structural validation passes.
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

    // Structural checks — R12 AC1009 with the initial-view profile
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
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

    // --- Required view variables exist with envelope-derived values ---
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
    for (const v of ['$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$VIEWCTR', '$VIEWSIZE', '$VIEWDIR', '$LUNITS']) {
      expect(header[v], `missing HEADER variable ${v}`).toBeDefined();
    }
    const g10 = (v: string) => Number(header[v].find(x => x.code === 10)?.value);
    const g20 = (v: string) => Number(header[v].find(x => x.code === 20)?.value);
    const g30 = (v: string) => Number(header[v].find(x => x.code === 30)?.value);
    expect(g10('$INSBASE')).toBe(0);
    expect(g20('$INSBASE')).toBe(0);
    expect(g30('$INSBASE')).toBe(0);
    expect(Number(header['$VIEWDIR'].find(x => x.code === 10)?.value)).toBe(0);
    expect(Number(header['$VIEWDIR'].find(x => x.code === 20)?.value)).toBe(0);
    expect(Number(header['$VIEWDIR'].find(x => x.code === 30)?.value)).toBe(1);
    expect(header['$LUNITS'].find(x => x.code === 70)?.value).toBe('2');
    // $EXTMIN < $EXTMAX on both axes (sane envelope)
    const extMinX = g10('$EXTMIN'), extMinY = g20('$EXTMIN'), extMaxX = g10('$EXTMAX'), extMaxY = g20('$EXTMAX');
    expect(extMinX).toBeLessThan(extMaxX);
    expect(extMinY).toBeLessThan(extMaxY);
    // $LIMMIN/$LIMMAX mirror the extents
    expect(g10('$LIMMIN')).toBe(extMinX);
    expect(g20('$LIMMIN')).toBe(extMinY);
    expect(g10('$LIMMAX')).toBe(extMaxX);
    expect(g20('$LIMMAX')).toBe(extMaxY);
    // $VIEWCTR is the envelope centre
    expect(g10('$VIEWCTR')).toBeCloseTo((extMinX + extMaxX) / 2, 1);
    expect(g20('$VIEWCTR')).toBeCloseTo((extMinY + extMaxY) / 2, 1);
    const viewSize = Number(header['$VIEWSIZE'].find(x => x.code === 40)?.value);
    expect(viewSize).toBeGreaterThan(0);

    // --- VPORT table: exists, FIRST table, *ACTIVE present ---
    let firstTable: string | null = null;
    const tablePos: Record<string, number> = {};
    for (let i = 0; i + 3 < pairs.length; i++) {
      if (pairs[i].code === 0 && pairs[i].value.trim() === 'TABLE' && pairs[i + 1].code === 2) {
        const name = pairs[i + 1].value.trim();
        if (tablePos[name] === undefined) tablePos[name] = i;
        if (firstTable === null) firstTable = name;
      }
    }
    expect(firstTable).toBe('VPORT');
    expect(tablePos['LTYPE']).toBeGreaterThan(tablePos['VPORT']);
    expect(tablePos['LAYER']).toBeGreaterThan(tablePos['VPORT']);
    expect(tablePos['STYLE']).toBeGreaterThan(tablePos['VPORT']);
    const hasActiveVport = pairs.some((p, i) => p.code === 0 && p.value.trim() === 'VPORT' && pairs[i + 1].code === 2 && pairs[i + 1].value.trim() === '*ACTIVE');
    expect(hasActiveVport).toBe(true);
    // VPORT view height must match $VIEWSIZE (the initial view is the *ACTIVE viewport)
    const activeIdx = pairs.findIndex((p, i) => p.code === 0 && p.value.trim() === 'VPORT' && pairs[i + 1].code === 2 && pairs[i + 1].value.trim() === '*ACTIVE');
    const vportPairs = pairs.slice(activeIdx, activeIdx + 30);
    const vportH = Number(vportPairs.find(p => p.code === 40)?.value);
    expect(vportH).toBe(viewSize);

    // --- Entity envelope: every collected coordinate inside the DECLARED envelope ---
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

    // --- $VIEWSIZE covers the generated envelope on BOTH axes ---
    expect(viewSize).toBeGreaterThanOrEqual(extMaxY - extMinY);
    // Width must fit through the viewport aspect (VPORT 41 = width/height ratio)
    const aspect = Number(vportPairs.find(p => p.code === 41)?.value) || (1024 / 768);
    expect(viewSize * aspect).toBeGreaterThanOrEqual(extMaxX - extMinX);
    // AutoCAD display verification unavailable in CI — this test proves the initial-view
    // profile is present, envelope-derived and covering, not application rendering.
  });
});
