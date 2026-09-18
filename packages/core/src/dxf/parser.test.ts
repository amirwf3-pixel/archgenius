import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF } from '../pipeline.js';

/** Minimal DXF parser that groups entities per layer, just for tests. */
function parseDxf(dxf: string) {
  const lines = dxf.split(/\r?\n/);
  const sections = new Set<string>();
  let currentSection = '';
  let inEntities = false;
  const entitiesByLayer: Record<string, number> = {};
  let i = 0;
  while (i < lines.length) {
    const code = lines[i].trim();
    const val = (lines[i + 1] ?? '').trim();
    if (code === '0' && val === 'SECTION') {
      const n2 = lines[i + 2]?.trim(); const n3 = lines[i + 3]?.trim();
      if (n2 === '2') { currentSection = n3; sections.add(n3); inEntities = n3 === 'ENTITIES'; }
    } else if (code === '0' && val === 'ENDSEC') {
      inEntities = false; currentSection = '';
    } else if (inEntities && code === '0') {
      // val is entity type, next pair (8, layer) tells us layer
      let j = i + 2;
      let layer = '?';
      while (j < lines.length && lines[j - 1] !== '8') {
        if (lines[j] === '8' && j + 1 < lines.length) { layer = lines[j + 1].trim(); break; }
        j += 2;
      }
      entitiesByLayer[layer] = (entitiesByLayer[layer] ?? 0) + 1;
    }
    i += 2;
  }
  return { sections, entitiesByLayer };
}

describe('DXF parser sanity', () => {
  it('contains HEADER, TABLES, ENTITIES sections and required layers', () => {
    const inp = {
      name: 'P',
      site: { shape: 'rectangle' as const, width: 15, length: 20, accessSide: 'south' as const, streetWidth: 8 },
      building: { type: 'villa' as const, floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed' as const, parkingSpaces: 1, hasStorage: true },
      deterministic: true, seed: 1,
    };
    const { candidates } = generate(createProject(inp));
    const { dxf } = exportDXF(candidates[0]);
    const parsed = parseDxf(dxf);
    expect(parsed.sections.has('HEADER')).toBe(true);
    expect(parsed.sections.has('TABLES')).toBe(true);
    expect(parsed.sections.has('BLOCKS')).toBe(true);
    expect(parsed.sections.has('ENTITIES')).toBe(true);
    // Expect entities on key layers
    expect(parsed.entitiesByLayer['A-WALL-EXT']).toBeGreaterThan(0);
    expect(parsed.entitiesByLayer['A-WALL-INT']).toBeGreaterThan(0);
    expect(parsed.entitiesByLayer['A-DOOR']).toBeGreaterThan(0);
    expect(parsed.entitiesByLayer['A-WINDOW']).toBeGreaterThan(0);
    expect(parsed.entitiesByLayer['A-ROOM']).toBeGreaterThan(0);
    expect(parsed.entitiesByLayer['A-DIMS']).toBeGreaterThan(0);
  });
});
