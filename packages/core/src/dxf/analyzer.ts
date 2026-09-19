/**
 * DXF R12 analyzer — evidence-based isolation diagnostics.
 * Reports: entity counts, min/max X/Y/Z, non-finite, zero-length,
 * invalid POLYLINE/VERTEX/SEQEND, group-code ordering, malformed strings,
 * control chars, large/small coords, handles, section termination/order,
 * byte encoding / CRLF.
 *
 * Used for the 15.5×22 isolation experiment (reference vs failing).
 */

export interface DXFAnalysis {
  file: string;
  bytes: number;
  lines: number;
  crlf: number;
  strayLF: boolean;
  strayCR: boolean;
  hasNonAscii: boolean;
  controlChars: number[];
  evenLines: boolean;
  endsWithCRLF: boolean;
  pairs: number;
  malformedCodes: number;
  sections: string[];
  hasEof: boolean;
  openSections: number;
  entitiesTotal: number;
  byType: Record<string, number>;
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  nonFinite: Array<{type:string, code:number, val:string}>;
  zeroLengthLine: number;
  largeCoords: Array<{code:number, val:string}>;
  polyCount: number; vertexCount: number; seqendCount: number;
  vertexOutside: number;
  missingSeqend: number;
  invalidPolyFlags: Array<{idx:number, reason:string}>;
  outOfOrder: number;
  handles: number;
  dupHandles: number;
  hasHeader: boolean; hasTables: boolean; hasBlocks: boolean; hasEntities: boolean;
  ltype40: string[];
  hasFloatingLtype: boolean;
  arcNegative: number;
  definedLayers: number;
  entityLayers: number;
  undefinedLayers: string[];
  definedLtypes: string[];
  undefinedLtypes: string[];
  textHeights: {min:number, max:number, count:number};
  has1e20: boolean;
  ctrlInText: number;
}

export function analyzeDXF(text: string, file = '<string>'): DXFAnalysis {
  const rawBytes = Buffer.byteLength(text, 'utf-8');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length;
  const cr = (text.match(/\r/g) || []).length;
  const strayLF = lf !== crlf;
  const strayCR = cr !== crlf;
  const hasNonAscii = [...text].some(ch => ch.charCodeAt(0) > 0x7e);
  const controlChars = [...new Set([...text].filter(ch => {
    const c = ch.charCodeAt(0);
    return c < 32 && c !== 13 && c !== 10;
  }).map(ch => ch.charCodeAt(0)))];
  const lines = text.split('\r\n');
  const endsWithCRLF = text.endsWith('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const evenLines = lines.length % 2 === 0;
  const pairs: Array<{code:number,value:string,idx:number}> = [];
  let malformedCodes = 0;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = Number(lines[i]);
    if (!Number.isInteger(c) || !Number.isFinite(c)) malformedCodes++;
    pairs.push({code: c, value: lines[i + 1], idx: i});
  }
  // sections
  const sections: string[] = [];
  let hasEof = false;
  let openSections = 0;
  const sectionStack: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const {code,value} = pairs[i];
    const v = value.trim();
    if (code === 0 && v === 'SECTION') {
      const nxt = pairs[i + 1];
      if (nxt && nxt.code === 2) {
        const name = nxt.value.trim();
        sections.push(name);
        sectionStack.push(name);
        openSections = sectionStack.length;
        i++;
      }
    } else if (code === 0 && v === 'ENDSEC') {
      sectionStack.pop();
      openSections = sectionStack.length;
    } else if (code === 0 && v === 'EOF') {
      hasEof = true;
    }
  }
  // entities
  const entities: Array<{type:string,codes:Record<number,string>, idx:number}> = [];
  let curSec = '';
  let curEnt: any = null;
  for (let i = 0; i < pairs.length; i++) {
    const {code,value} = pairs[i];
    const v = value.trim();
    if (code === 0) {
      if (curEnt) entities.push(curEnt);
      curEnt = null;
      if (v === 'SECTION') {
        const nxt = pairs[i + 1];
        if (nxt && nxt.code === 2) { curSec = nxt.value.trim(); i++; }
      } else if (v === 'ENDSEC') curSec = '';
      else if (curSec === 'ENTITIES') curEnt = {type: v, codes: {}, idx: i};
    } else if (curEnt) curEnt.codes[code] = value;
  }
  if (curEnt) entities.push(curEnt);
  const byType: Record<string,number> = {};
  for (const e of entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const nonFinite: DXFAnalysis['nonFinite'] = [];
  let zeroLengthLine = 0;
  const largeCoords: DXFAnalysis['largeCoords'] = [];
  for (const e of entities) {
    const c = e.codes;
    for (const k of [10,11,20,21,30,31,40] as const) {
      const v = c[k];
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) nonFinite.push({type:e.type, code:k, val:v});
      else {
        if (k===10||k===11) { minX=Math.min(minX,n); maxX=Math.max(maxX,n); }
        if (k===20||k===21) { minY=Math.min(minY,n); maxY=Math.max(maxY,n); }
        if (k===30||k===31) { minZ=Math.min(minZ,n); maxZ=Math.max(maxZ,n); }
        if (Math.abs(n) > 1e5) largeCoords.push({code:k, val:v});
      }
    }
    if (e.type==='LINE') {
      const x1=Number(c[10]), y1=Number(c[20]), x2=Number(c[11]), y2=Number(c[21]);
      if (x1===x2 && y1===y2) zeroLengthLine++;
    }
  }
  if (!Number.isFinite(minX)) { minX=0; maxX=0; minY=0; maxY=0; minZ=0; maxZ=0; }
  // POLYLINE/VERTEX/SEQEND
  let polyCount=0, vertexCount=0, seqendCount=0, vertexOutside=0, missingSeqend=0;
  const invalidPolyFlags: DXFAnalysis['invalidPolyFlags'] = [];
  const stack:any[]=[];
  for (const e of entities) {
    if (e.type==='POLYLINE') {
      polyCount++;
      stack.push(e);
      if (e.codes[10]===undefined) invalidPolyFlags.push({idx:e.idx, reason:'missing 10'});
      if (e.codes[70]===undefined) invalidPolyFlags.push({idx:e.idx, reason:'missing 70'});
      if (e.codes[66]===undefined) invalidPolyFlags.push({idx:e.idx, reason:'missing 66'});
    } else if (e.type==='VERTEX') {
      vertexCount++;
      if (stack.length===0) vertexOutside++;
      if (e.codes[42]===undefined) invalidPolyFlags.push({idx:e.idx, reason:'missing 42'});
    } else if (e.type==='SEQEND') {
      seqendCount++;
      if (stack.length===0) invalidPolyFlags.push({idx:e.idx, reason:'SEQEND without POLYLINE'});
      else stack.pop();
    }
  }
  missingSeqend = stack.length;
  // outOfOrder: count entities where code decreases (e.g., 40->1)
  let outOfOrder=0;
  let lastCode=-1;
  let inEnt=false;
  let sec2='';
  for (const p of pairs) {
    const v=p.value.trim();
    if (p.code===0) {
      if (v==='SECTION') {
        const idx=pairs.indexOf(p);
        const nxt=pairs[idx+1];
        if (nxt) sec2=nxt.value.trim();
      } else if (v==='ENDSEC') sec2='';
      else if (sec2==='ENTITIES') { inEnt=true; lastCode=0; }
      else inEnt=false;
    } else if (inEnt) {
      if (p.code < lastCode) outOfOrder++;
      lastCode=p.code;
    }
  }
  // handles
  const handleMap=new Map<string,number>();
  let dupHandles=0;
  for (const p of pairs) if (p.code===5) {
    if (handleMap.has(p.value)) dupHandles++;
    else handleMap.set(p.value,1);
  }
  const hasHeader=sections.includes('HEADER');
  const hasTables=sections.includes('TABLES');
  const hasBlocks=sections.includes('BLOCKS');
  const hasEntities=sections.includes('ENTITIES');
  // LTYPE 40
  const ltype40:string[]=[];
  for (let i=0;i<pairs.length;i++) if (pairs[i].code===0 && pairs[i].value==='LTYPE') {
    for (let j=i+1;j<Math.min(i+15,pairs.length);j++) if (pairs[j].code===40) { ltype40.push(pairs[j].value); break; }
  }
  const hasFloatingLtype=ltype40.some(v=> v.includes('000000000') || v.includes('999999'));
  // ARC negative
  let arcNegative=0;
  for (let i=0;i<pairs.length;i++) if (pairs[i].code===0 && pairs[i].value==='ARC') {
    let a50=null,a51=null;
    for (let j=i+1;j<Math.min(i+15,pairs.length);j++) {
      if (pairs[j].code===50) a50=pairs[j].value;
      if (pairs[j].code===51) a51=pairs[j].value;
      if (a50!==null && a51!==null) break;
    }
    if (a50!==null && Number(a50)<0) arcNegative++;
    if (a51!==null && Number(a51)<0) arcNegative++;
  }
  // defined layers
  const definedLayersSet=new Set<string>();
  let inLayerTable=false;
  for (let i=0;i<pairs.length;i++) {
    const p=pairs[i];
    if (p.code===0 && p.value==='TABLE') {
      const nxt=pairs[i+1];
      inLayerTable = !!(nxt && nxt.value==='LAYER');
      i++;
    } else if (p.code===0 && p.value==='ENDTAB') inLayerTable=false;
    else if (inLayerTable && p.code===0 && p.value==='LAYER') {
      for (let j=i+1;j<Math.min(i+10,pairs.length);j++) if (pairs[j].code===2) { definedLayersSet.add(pairs[j].value); break; }
    }
  }
  // entity layers
  const entityLayersSet=new Set<string>();
  let curSec3='';
  for (let i=0;i<pairs.length;i++) {
    const p=pairs[i];
    const v=p.value.trim();
    if (p.code===0) {
      if (v==='SECTION') {
        const nxt=pairs[i+1];
        if (nxt && nxt.code===2) { curSec3=nxt.value.trim(); i++; }
      } else if (v==='ENDSEC') curSec3='';
      else if (curSec3==='ENTITIES') {
        for (let j=i+1;j<Math.min(i+10,pairs.length);j++) {
          if (pairs[j].code===8) { entityLayersSet.add(pairs[j].value); break; }
          if (pairs[j].code===0) break;
        }
      }
    }
  }
  const undefinedLayers=[...entityLayersSet].filter(l=> !definedLayersSet.has(l));
  // defined ltypes
  const definedLtypesSet=new Set<string>();
  for (let i=0;i<pairs.length;i++) if (pairs[i].code===0 && pairs[i].value==='LTYPE') {
    for (let j=i+1;j<Math.min(i+10,pairs.length);j++) if (pairs[j].code===2) { definedLtypesSet.add(pairs[j].value); break; }
  }
  const usedLtypesSet=new Set<string>();
  for (let i=0;i<pairs.length;i++) if (pairs[i].code===0 && pairs[i].value==='LAYER') {
    for (let j=i+1;j<Math.min(i+10,pairs.length);j++) {
      if (pairs[j].code===6) { usedLtypesSet.add(pairs[j].value); break; }
      if (pairs[j].code===0) break;
    }
  }
  const undefinedLtypes=[...usedLtypesSet].filter(l=> !definedLtypesSet.has(l));
  // text heights
  const textHeights:number[]=[];
  for (let i=0;i<pairs.length;i++) if (pairs[i].code===0 && pairs[i].value==='TEXT') {
    for (let j=i+1;j<Math.min(i+15,pairs.length);j++) {
      if (pairs[j].code===40) { textHeights.push(Number(pairs[j].value)); break; }
      if (pairs[j].code===0) break;
    }
  }
  const has1e20=pairs.some(p=> p.value.includes('1e20') || p.value.includes('1E20'));
  let ctrlInText=0;
  for (const p of pairs) if (p.code===1) {
    if ([...p.value].some(c=> c.charCodeAt(0)<32 && c!=='\t' && c!=='\n' && c!=='\r')) ctrlInText++;
  }
  return {
    file, bytes: rawBytes, lines: lines.length, crlf, strayLF, strayCR, hasNonAscii, controlChars,
    evenLines, endsWithCRLF, pairs: pairs.length, malformedCodes, sections, hasEof, openSections,
    entitiesTotal: entities.length, byType, minX, maxX, minY, maxY, minZ, maxZ,
    nonFinite, zeroLengthLine, largeCoords, polyCount, vertexCount, seqendCount,
    vertexOutside, missingSeqend, invalidPolyFlags, outOfOrder, handles: handleMap.size, dupHandles,
    hasHeader, hasTables, hasBlocks, hasEntities,
    ltype40, hasFloatingLtype, arcNegative,
    definedLayers: definedLayersSet.size, entityLayers: entityLayersSet.size, undefinedLayers,
    definedLtypes: [...definedLtypesSet], undefinedLtypes,
    textHeights: {min: textHeights.length? Math.min(...textHeights):0, max: textHeights.length? Math.max(...textHeights):0, count: textHeights.length},
    has1e20, ctrlInText
  };
}

export function formatAnalysis(a: DXFAnalysis): string {
  return [
    `File: ${a.file} (${a.bytes} bytes, ${a.lines} lines, ${a.pairs} pairs)`,
    `CRLF: ${a.crlf} strayLF:${a.strayLF} strayCR:${a.strayCR} nonAscii:${a.hasNonAscii} ctrl:${a.controlChars.join(',')} even:${a.evenLines} EOF:${a.endsWithCRLF} hasEof:${a.hasEof}`,
    `Sections: ${a.sections.join(' -> ')} (open:${a.openSections}) HEADER:${a.hasHeader} TABLES:${a.hasTables} BLOCKS:${a.hasBlocks} ENTITIES:${a.hasEntities}`,
    `Entities: ${a.entitiesTotal} ${JSON.stringify(a.byType)}`,
    `Bounds: X[${a.minX},${a.maxX}] Y[${a.minY},${a.maxY}] Z[${a.minZ},${a.maxZ}]`,
    `Non-finite:${a.nonFinite.length} ZeroLine:${a.zeroLengthLine} Large(>1e5):${a.largeCoords.length} Handles:${a.handles} dup:${a.dupHandles}`,
    `POLYLINE:${a.polyCount} VERTEX:${a.vertexCount} SEQEND:${a.seqendCount} vertexOutside:${a.vertexOutside} missingSeqend:${a.missingSeqend} invalidPoly:${a.invalidPolyFlags.length}`,
    `LTYPE 40:${a.ltype40.join(',')} floating:${a.hasFloatingLtype} ARC negative:${a.arcNegative}`,
    `Layers: defined ${a.definedLayers} entity ${a.entityLayers} undefined [${a.undefinedLayers.join(',')}]`,
    `Ltypes: defined [${a.definedLtypes.join(',')}] undefined [${a.undefinedLtypes.join(',')}]`,
    `TEXT heights: min ${a.textHeights.min} max ${a.textHeights.max} count ${a.textHeights.count} ctrlInText:${a.ctrlInText} has1e20:${a.has1e20} outOfOrder:${a.outOfOrder}`,
  ].join('\n');
}
