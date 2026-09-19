import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF } from '../pipeline.js';
import { writeDXF } from './writer.js';

/**
 * Regression: Downloaded DXF must contain visible modelspace geometry inside sane envelope.
 * Verifies that browser Blob download path (via writeDXF) produces same bytes as exportDXF,
 * and that all LINE entities lie inside header envelope and VIEWCTR/VIEWSIZE covers it.
 * Also verifies that header contains conservative R12 variables and VPORT *ACTIVE.
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

    // Structural checks
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('$INSBASE');
    expect(dxf).toContain('$EXTMIN');
    expect(dxf).toContain('$EXTMAX');
    expect(dxf).toContain('$LIMMIN');
    expect(dxf).toContain('$LIMMAX');
    expect(dxf).toContain('$VIEWCTR');
    expect(dxf).toContain('$VIEWSIZE');
    expect(dxf).toContain('$VIEWDIR');
    expect(dxf).not.toContain('$SCREENSIZE');
    expect(dxf).not.toContain('$DWGCODEPAGE');
    expect(dxf).toContain('*ACTIVE');
    expect(dxf).toContain('VPORT');

    // Parse header envelope
    const lines = dxf.split('\r\n');
    const getHeader = (key: string) => {
      const idx = lines.indexOf(key);
      if (idx === -1) return null;
      let x=NaN,y=NaN;
      for(let i=idx+1;i<Math.min(lines.length,idx+10);i++){
        if(lines[i]==='10') x=Number(lines[i+1]);
        if(lines[i]==='20') y=Number(lines[i+1]);
        if(lines[i]==='0' || lines[i]==='9') break;
      }
      return {x,y};
    };
    const extmin = getHeader('$EXTMIN')!;
    const extmax = getHeader('$EXTMAX')!;
    const viewctr = getHeader('$VIEWCTR')!;
    const viewsize = (() => {
      const idx=lines.indexOf('$VIEWSIZE');
      if(idx===-1) return NaN;
      for(let i=idx+1;i<idx+10;i++) if(lines[i]==='40') return Number(lines[i+1]);
      return NaN;
    })();
    expect(extmax.x).toBeGreaterThan(extmin.x);
    expect(extmax.y).toBeGreaterThan(extmin.y);
    expect(viewsize).toBeGreaterThan(0);
    // VIEWCTR inside envelope
    expect(viewctr.x).toBeGreaterThanOrEqual(extmin.x);
    expect(viewctr.x).toBeLessThanOrEqual(extmax.x);
    expect(viewctr.y).toBeGreaterThanOrEqual(extmin.y);
    expect(viewctr.y).toBeLessThanOrEqual(extmax.y);
    // VIEWSIZE covers envelope
    const viewH = viewsize;
    // Aspect from VPORT 41
    const vportIdx = lines.indexOf('*ACTIVE');
    let aspect=1.33;
    if(vportIdx!==-1){
      for(let i=vportIdx;i<Math.min(lines.length,vportIdx+40);i++) if(lines[i]==='41') { aspect=Number(lines[i+1]); break; }
    }
    const viewW = viewH * aspect;
    expect(viewH).toBeGreaterThanOrEqual(extmax.y - extmin.y);
    expect(viewW).toBeGreaterThanOrEqual(extmax.x - extmin.x);

    // All LINE entities inside envelope
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
    for(const e of linesEnt){
      const x1=Number(e.codes[10]), y1=Number(e.codes[20]), x2=Number(e.codes[11]), y2=Number(e.codes[21]);
      expect(x1).toBeGreaterThanOrEqual(extmin.x - 1e-6);
      expect(x1).toBeLessThanOrEqual(extmax.x + 1e-6);
      expect(y1).toBeGreaterThanOrEqual(extmin.y - 1e-6);
      expect(y1).toBeLessThanOrEqual(extmax.y + 1e-6);
      expect(x2).toBeGreaterThanOrEqual(extmin.x - 1e-6);
      expect(x2).toBeLessThanOrEqual(extmax.x + 1e-6);
      expect(y2).toBeGreaterThanOrEqual(extmin.y - 1e-6);
      expect(y2).toBeLessThanOrEqual(extmax.y + 1e-6);
    }
    // AutoCAD display verification unavailable in CI — this test proves structural visibility, not application rendering
  });
});
