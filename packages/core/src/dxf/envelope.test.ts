import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF } from '../pipeline.js';
import { writeDXF } from './writer.js';

/**
 * Regression: Downloaded DXF must contain visible modelspace geometry inside sane envelope.
 * Verifies that browser Blob download path (via writeDXF) produces same bytes as exportDXF.
 * Also verifies strict minimal R12 AC1009: ONLY $ACADVER, no R13+ headers, no VPORT dependency,
 * and that all LINE entities lie within sane world coordinates.
 * Minimal R12 was chosen because real AutoCAD 2024 opens minimal AC1009 but shows black/empty
 * and Enter prompts when $EXTMIN/$EXTMAX/$VIEWCTR/$VIEWSIZE/$VIEWDIR/$LIMMIN/$LIMMAX/$INSBASE/$LUNITS/VPORT are malformed.
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

    // Structural checks — minimal R12 AC1009: ONLY $ACADVER, no R13+ headers
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    // All non-minimal HEADER vars must be absent (they trigger Real AutoCAD Enter prompts / black views)
    expect(dxf).not.toContain('$INSBASE');
    expect(dxf).not.toContain('$EXTMIN');
    expect(dxf).not.toContain('$EXTMAX');
    expect(dxf).not.toContain('$LIMMIN');
    expect(dxf).not.toContain('$LIMMAX');
    expect(dxf).not.toContain('$VIEWCTR');
    expect(dxf).not.toContain('$VIEWSIZE');
    expect(dxf).not.toContain('$VIEWDIR');
    expect(dxf).not.toContain('$LUNITS');
    expect(dxf).not.toContain('$SCREENSIZE');
    expect(dxf).not.toContain('$DWGCODEPAGE');
    expect(dxf).not.toContain('$INSUNITS');
    expect(dxf).not.toContain('$MEASUREMENT');
    // Minimal TABLES: LTYPE/LAYER/STYLE only, no VPORT dependency
    expect(dxf).toContain('LTYPE');
    expect(dxf).toContain('LAYER');
    expect(dxf).toContain('STYLE');
    // VPORT is NOT required for minimal R12 — AutoCAD opens minimal file with default view
    // Do not assert presence of *ACTIVE or VPORT; they are intentionally absent in minimal
    expect(dxf.split('\r\n').join('')).not.toMatch(/[\r\n]/); // pure CRLF

    // Parse and check LINE entities are within sane world coordinates (no extents header to compare)
    const lines = dxf.split('\r\n');
    const pairs: Array<{code:number,value:string}> = [];
    for(let i=0;i+1<lines.length;i+=2) pairs.push({code:Number(lines[i]), value:lines[i+1]});
    let section='';
    let curEnt:any=null;
    const entities:any[]=[];
    for(let i=0;i<pairs.length;i++){
      const {code,value}=pairs[i];
      const v=value.trim();
      if(code===0){
        if(curEnt) entities.push(curEnt);
        curEnt=null;
        if(v==='SECTION'){ const nxt=pairs[i+1]; if(nxt&&nxt.code===2){ section=nxt.value.trim(); i++; } }
        else if(v==='ENTITIES') curEnt=null;
        else if(section==='ENTITIES') curEnt={type:v,codes:{}};
      } else if(section==='ENTITIES' && curEnt){
        curEnt.codes[code]=value;
      }
    }
    if(curEnt) entities.push(curEnt);
    const linesEnt = entities.filter(e=>e.type==='LINE');
    expect(linesEnt.length).toBeGreaterThan(100);
    // All LINEs must have finite coordinates within sane mm range (site 15.5x22m => 0..~25000 mm, with offset)
    for(const e of linesEnt){
      const x1=Number(e.codes[10]), y1=Number(e.codes[20]), x2=Number(e.codes[11]), y2=Number(e.codes[21]);
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
    }
    // AutoCAD display verification unavailable in CI — this test proves structural minimal R12, not application rendering
  });
});
